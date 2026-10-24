import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, chmodSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { createCliProvider, parseCliJson } from '../src/providers/cli.js';

const quiet = { info() {}, warn() {}, error() {} };
const base = {
  trustProxy: 'loopback', corsOrigins: [], maxBodyBytes: '64kb', maxPromptChars: 50,
  maxConcurrent: 1, maxQueue: 1, rateLimitWindowMs: 60000, rateLimitMax: 100,
  timeoutMs: 3000, staticDir: '',
};

async function withServer(cfg, provider, fn) {
  const server = createApp(cfg, provider, quiet).listen(0);
  const url = `http://127.0.0.1:${server.address().port}`;
  try { await fn(url); } finally { server.close(); }
}
const post = (url, body) => fetch(url + '/api/generate', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('parses Gemini CLI JSON with leading noise', () => {
  assert.equal(parseCliJson('Loaded cached credentials.\n{"response":"Hi","stats":{}}'), 'Hi');
  assert.throws(() => parseCliJson('not json'));
  assert.throws(() => parseCliJson('{"error":{"type":"x","message":"Quota exceeded"}}'), /quota/i);
});

test('no access code needed, validation and length limit', async () => {
  const provider = { name: 't', label: 'T', generate: async (p) => `echo:${p}` };
  await withServer(base, provider, async (url) => {
    assert.equal((await fetch(url + '/health')).status, 200);
    assert.equal((await post(url, { prompt: 'hi' })).status, 200);
    assert.equal((await post(url, { prompt: '   ' })).status, 400);
    assert.equal((await post(url, { prompt: 'x'.repeat(51) })).status, 413);
    const ok = await (await post(url, { prompt: 'hi' })).json();
    assert.deepEqual(ok, { success: true, response: 'echo:hi' });
  });
});

test('queue limits concurrency and rejects overflow', async () => {
  let running = 0, peak = 0;
  const provider = { name: 't', label: 'T', generate: async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 150)); running--; return 'ok'; } };
  await withServer(base, provider, async (url) => {
    const codes = await Promise.all(['a', 'b', 'c'].map((p) => post(url, { prompt: p }).then((r) => r.status)));
    assert.equal(peak, 1);
    assert.deepEqual(codes.sort(), [200, 200, 503]);
  });
});

test('CLI provider: real spawn, timeout kill, missing binary', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fakegem-'));
  const ok = path.join(dir, 'ok.sh');
  writeFileSync(ok, '#!/bin/sh\n[ "$1" = "-p" ] && printf \'{"response":"%s"}\' "$2"\n');
  const slow = path.join(dir, 'slow.sh');
  writeFileSync(slow, '#!/bin/sh\nsleep 10\n');
  chmodSync(ok, 0o755); chmodSync(slow, 0o755);

  const p = createCliProvider({ ...base, geminiCommand: ok }, quiet);
  assert.equal(await p.generate('hello; rm -rf /'), 'hello; rm -rf /');

  const s = createCliProvider({ ...base, geminiCommand: slow, timeoutMs: 1000 }, quiet);
  await assert.rejects(s.generate('x'), /too long/);

  const m = createCliProvider({ ...base, geminiCommand: '/nonexistent/gemini' }, quiet);
  await assert.rejects(m.generate('x'), /not installed/);
});
