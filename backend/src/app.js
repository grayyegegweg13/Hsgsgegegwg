import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { PublicError } from './errors.js';
import { createLimiter } from './queue.js';

export function createApp(cfg, provider, log) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy);
  app.use(helmet());

  const limiter = createLimiter(cfg.maxConcurrent, cfg.maxQueue);
  const inFlight = new Set();

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', provider: provider.name, uptime: Math.round(process.uptime()), queue: limiter.stats() });
  });

  const api = express.Router();
  api.use(cors({
    origin: (origin, cb) => cb(null, !origin || cfg.corsOrigins.includes(origin)),
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type'],
    maxAge: 600,
  }));
  api.use(express.json({ limit: cfg.maxBodyBytes }));

  api.get('/config', (_req, res) => {
    res.json({ provider: provider.label, maxPromptChars: cfg.maxPromptChars });
  });


  const generateLimiter = rateLimit({
    windowMs: cfg.rateLimitWindowMs,
    limit: cfg.rateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ success: false, error: 'Too many requests. Please slow down.', code: 'RATE_LIMIT', status: 429, details: `Limit: ${cfg.rateLimitMax} requests per ${Math.round(cfg.rateLimitWindowMs / 1000)} s (RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS).` }),
  });

  api.post('/generate', generateLimiter, async (req, res, next) => {
    const started = Date.now();
    let key;
    try {
      const prompt = req.body?.prompt;
      if (typeof prompt !== 'string') throw new PublicError(400, 'INVALID', 'The prompt must be text.');
      const trimmed = prompt.trim();
      if (!trimmed) throw new PublicError(400, 'INVALID', 'Please enter a prompt.');
      if (trimmed.length > cfg.maxPromptChars)
        throw new PublicError(413, 'TOO_LONG', `The prompt is too long (max ${cfg.maxPromptChars} characters).`);
      // Reject control characters other than tab/newline.
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(trimmed))
        throw new PublicError(400, 'INVALID', 'The prompt contains invalid characters.');

      key = crypto.createHash('sha256').update(`${req.ip}\n${trimmed}`).digest('hex');
      if (inFlight.has(key)) throw new PublicError(409, 'DUPLICATE', 'This prompt is already being processed.');
      inFlight.add(key);

      if (cfg.logPrompts) log.info({ event: 'prompt', prompt: trimmed });
      const response = await limiter.run(() => provider.generate(trimmed));
      log.info({ event: 'generate_ok', ms: Date.now() - started, chars: trimmed.length });
      res.json({ success: true, response });
    } catch (e) {
      next(e);
    } finally {
      if (key) inFlight.delete(key);
    }
  });

  app.use('/api', api);
  app.use('/api', (_req, res) => res.status(404).json({ success: false, error: 'Not found.' }));

  // Serve the built frontend in production.
  if (cfg.staticDir && fs.existsSync(path.join(cfg.staticDir, 'index.html'))) {
    app.use(express.static(cfg.staticDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(cfg.staticDir, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof PublicError) {
      if (err.status >= 500) log.warn({ event: 'request_failed', kind: err.code, status: err.status });
      return res.status(err.status).json({ success: false, error: err.message, code: err.code, status: err.status, details: err.details || undefined });
    }
    if (err?.type === 'entity.too.large')
      return res.status(413).json({ success: false, error: 'The request is too large.' });
    if (err?.type === 'entity.parse.failed')
      return res.status(400).json({ success: false, error: 'The request body is not valid JSON.' });
    log.error({ event: 'unexpected_error', name: err?.name, message: err?.message });
    res.status(500).json({ success: false, error: 'An unexpected server error occurred.', code: 'INTERNAL', status: 500, details: `${err?.name || 'Error'}: ${err?.message || ''}` });
  });

  return app;
}
