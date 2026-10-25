// Centralised, validated configuration read from environment variables.
const int = (name, def, min = 1) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min) throw new Error(`Invalid value for ${name}`);
  return n;
};
const bool = (name, def) => {
  const raw = (process.env[name] ?? '').toLowerCase();
  if (!raw) return def;
  return ['1', 'true', 'yes', 'on'].includes(raw);
};

export function loadConfig() {
  const provider = (process.env.GEMINI_PROVIDER || 'cli').toLowerCase();
  if (!['cli', 'api'].includes(provider)) throw new Error('GEMINI_PROVIDER must be "cli" or "api"');


  const cfg = {
    nodeEnv: process.env.NODE_ENV || 'development',
    host: process.env.HOST || '127.0.0.1',
    port: int('PORT', 3000),
    provider,
    geminiCommand: process.env.GEMINI_COMMAND || 'gemini',
    geminiModel: process.env.GEMINI_MODEL || '',
    geminiApprovalMode: process.env.GEMINI_APPROVAL_MODE || '',
    geminiWorkdir: process.env.GEMINI_WORKDIR || '',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiApiModel: process.env.GEMINI_API_MODEL || 'gemini-2.5-flash',
    timeoutMs: int('GEMINI_TIMEOUT_MS', 120000, 1000),
    maxPromptChars: int('MAX_PROMPT_CHARS', 8000),
    maxBodyBytes: process.env.MAX_BODY_SIZE || '64kb',
    maxConcurrent: int('MAX_CONCURRENT_REQUESTS', 2),
    maxQueue: int('MAX_QUEUE_SIZE', 10, 0),
    rateLimitWindowMs: int('RATE_LIMIT_WINDOW_MS', 60000, 1000),
    rateLimitMax: int('RATE_LIMIT_MAX', 10),
    corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: process.env.TRUST_PROXY || 'loopback',
    logPrompts: bool('LOG_PROMPTS', false),
    forceHttps: bool('FORCE_HTTPS', false),
    staticDir: process.env.STATIC_DIR || '',
  };

  return cfg;
}
