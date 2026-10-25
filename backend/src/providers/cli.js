import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PublicError, classifyProviderError, cleanDetails } from '../errors.js';

const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

/**
 * Parse `gemini -p ... --output-format json` output.
 * Shape (Gemini CLI >= 0.5): { "response": "...", "stats": {...}, "error"?: { "type", "message" } }
 * Some versions print warnings before the JSON, so we locate the outermost object.
 */
export function parseCliJson(stdout) {
  const text = String(stdout || '').trim();
  if (!text) throw new PublicError(502, 'MALFORMED', 'Gemini returned an empty response.');
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) throw new PublicError(502, 'MALFORMED', 'Gemini returned output that could not be read.');
    try {
      obj = JSON.parse(text.slice(start, end + 1));
    } catch {
      throw new PublicError(502, 'MALFORMED', 'Gemini returned output that could not be read.');
    }
  }
  if (obj && obj.error) throw classifyProviderError(`${obj.error.type || ''} ${obj.error.message || ''} ${obj.error.code || ''}`);
  if (!obj || typeof obj.response !== 'string' || !obj.response.trim())
    throw new PublicError(502, 'MALFORMED', 'Gemini returned no answer.');
  return obj.response;
}

export function createCliProvider(cfg, log) {
  return {
    name: 'cli',
    label: 'Gemini CLI',
    async generate(prompt) {
      // Empty scratch directory so the CLI never reads or writes app files.
      const workdir = cfg.geminiWorkdir || mkdtempSync(path.join(tmpdir(), 'gemini-run-'));
      const args = ['-p', prompt, '--output-format', 'json'];
      if (cfg.geminiModel) args.push('--model', cfg.geminiModel);
      if (cfg.geminiApprovalMode) args.push('--approval-mode', cfg.geminiApprovalMode);

      return await new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        let size = 0;
        let settled = false;
        let killTimer;

        // No shell: the prompt is passed as a single argv entry and is never interpreted.
        const child = spawn(cfg.geminiCommand, args, {
          cwd: workdir,
          shell: false,
          detached: true, // own process group so we can kill sub-processes too
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            NO_COLOR: '1', CI: '1', TERM: 'dumb',
            // Reuse the saved "Login with Google" session in non-interactive mode
            // instead of asking for an API key every time.
            ...(process.env.GEMINI_API_KEY ? {} : { GOOGLE_GENAI_USE_GCA: process.env.GOOGLE_GENAI_USE_GCA || 'true' }),
            GEMINI_FORCE_FILE_STORAGE: process.env.GEMINI_FORCE_FILE_STORAGE || 'true',
          },
        });

        const finish = (err, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          clearTimeout(killTimer);
          if (!cfg.geminiWorkdir) rmSync(workdir, { recursive: true, force: true });
          err ? reject(err) : resolve(value);
        };
        const killTree = (sig) => {
          try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* gone */ } }
        };

        const timer = setTimeout(() => {
          log.warn({ event: 'cli_timeout', timeoutMs: cfg.timeoutMs });
          killTree('SIGTERM');
          killTimer = setTimeout(() => killTree('SIGKILL'), 5000);
          finish(new PublicError(504, 'TIMEOUT', 'Gemini took too long to respond. Please try a shorter prompt or retry.', `No answer after ${cfg.timeoutMs} ms (GEMINI_TIMEOUT_MS). Output so far:\n${cleanDetails(stderr + stdout) || '(none)'}`));
        }, cfg.timeoutMs);

        const onData = (which) => (chunk) => {
          size += chunk.length;
          if (size > MAX_OUTPUT_BYTES) {
            killTree('SIGKILL');
            return finish(new PublicError(502, 'MALFORMED', 'Gemini produced too much output.', `Output exceeded ${MAX_OUTPUT_BYTES} bytes.`));
          }
          if (which === 'out') stdout += chunk; else stderr += chunk;
        };
        child.stdout.on('data', onData('out'));
        child.stderr.on('data', onData('err'));

        child.on('error', (err) => {
          if (err.code === 'ENOENT') {
            log.error({ event: 'cli_missing' });
            return finish(new PublicError(503, 'CLI_UNAVAILABLE', 'Gemini CLI is not installed or not available on the server.', `Command not found: ${cfg.geminiCommand} (check GEMINI_COMMAND and PATH).`));
          }
          log.error({ event: 'cli_spawn_error', code: err.code });
          finish(new PublicError(503, 'CLI_UNAVAILABLE', 'Gemini CLI could not be started.', `${err.code || ''} ${err.message || ''}`.trim()));
        });

        child.on('close', (code, signal) => {
          if (settled) return;
          if (code === 0) {
            try { return finish(null, parseCliJson(stdout)); } catch (e) {
              if (e instanceof PublicError && !e.details) e.details = cleanDetails(`Raw output:\n${stdout}\n${stderr}`);
              return finish(e);
            }
          }
          // Non-zero exit: JSON may still contain a structured error.
          let err;
          try { parseCliJson(stdout); } catch (e) { err = e; }
          const head = `Exit code: ${code}${signal ? `, signal: ${signal}` : ''}`;
          if (!err || err.code === 'MALFORMED') err = classifyProviderError(stderr + '\n' + stdout, head);
          else err.details = cleanDetails(`${head}\n${err.details || ''}\n${stderr}`);
          if (signal) err = new PublicError(502, 'CRASH', 'Gemini CLI stopped unexpectedly.', cleanDetails(`${head}\n${stderr}`));
          log.error({ event: 'cli_failed', exitCode: code, signal, kind: err.code });
          finish(err);
        });
      });
    },
  };
}
