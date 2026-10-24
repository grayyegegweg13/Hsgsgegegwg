// Errors returned to the browser. `details` carries the raw technical reason (exit code, CLI output, etc.).
export class PublicError extends Error {
  constructor(status, code, message, details = '') {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const MAX_DETAILS = 4000;
/** Trim raw provider output for display; strips ANSI codes and obvious secrets. */
export function cleanDetails(text = '') {
  let t = String(text).replace(/\u001b\[[0-9;]*m/g, '').trim();
  t = t.replace(/(AIza[0-9A-Za-z_-]{20,})/g, '[redacted-key]').replace(/(ya29\.[0-9A-Za-z._-]+)/g, '[redacted-token]');
  return t.length > MAX_DETAILS ? '…' + t.slice(-MAX_DETAILS) : t;
}

/** Map raw provider text (stderr / API error) to an error, keeping the raw text as details. */
export function classifyProviderError(text = '', extra = '') {
  const t = String(text).toLowerCase();
  const details = cleanDetails([extra, text].filter(Boolean).join('\n'));
  if (/(resource_exhausted|quota|rate limit|ratelimit|\b429\b|too many requests)/.test(t))
    return new PublicError(429, 'QUOTA', 'The Gemini quota or rate limit was reached. Please try again later.', details);
  if (/(unauthenticated|not authenticated|login required|auth(entication)? (failed|required|error)|invalid api key|api key not valid|permission_denied|\b401\b|\b403\b|credentials|oauth|please set an auth method)/.test(t))
    return new PublicError(503, 'AUTH', 'Gemini authentication failed on the server. The owner needs to re-authenticate.', details);
  if (/(safety|blocked)/.test(t))
    return new PublicError(422, 'BLOCKED', 'The request was blocked by Gemini safety filters.', details);
  return new PublicError(502, 'PROVIDER', 'Gemini failed to generate a response.', details || 'Gemini returned no error text.');
}
