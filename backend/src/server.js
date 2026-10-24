import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createCliProvider } from './providers/cli.js';
import { createApiProvider } from './providers/api.js';

// Structured JSON logs. Prompts and secrets are never logged unless LOG_PROMPTS=true.
const write = (level) => (obj) => console[level === 'info' ? 'log' : level](JSON.stringify({ t: new Date().toISOString(), level, ...obj }));
const log = { info: write('info'), warn: write('warn'), error: write('error') };

let cfg;
try {
  cfg = loadConfig();
} catch (e) {
  log.error({ event: 'config_error', message: e.message });
  process.exit(1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
cfg.staticDir = cfg.staticDir ? path.resolve(cfg.staticDir) : path.resolve(here, '../../frontend/dist');

const provider = cfg.provider === 'api' ? createApiProvider(cfg, log) : createCliProvider(cfg, log);
if (cfg.provider === 'api' && !cfg.geminiApiKey) log.warn({ event: 'config_warning', message: 'GEMINI_API_KEY is not set' });

const app = createApp(cfg, provider, log);
const server = app.listen(cfg.port, cfg.host, () => {
  log.info({ event: 'started', host: cfg.host, port: cfg.port, provider: provider.name, auth: cfg.authMode });
});
server.requestTimeout = cfg.timeoutMs + 30000;

const shutdown = (sig) => {
  log.info({ event: 'shutdown', signal: sig });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
