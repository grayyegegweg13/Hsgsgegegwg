import { GoogleGenAI } from '@google/genai';
import { PublicError, classifyProviderError } from '../errors.js';

export function createApiProvider(cfg, log) {
  const ai = cfg.geminiApiKey ? new GoogleGenAI({ apiKey: cfg.geminiApiKey }) : null;
  return {
    name: 'api',
    label: 'Gemini API',
    async generate(prompt) {
      if (!ai) throw new PublicError(503, 'CONFIG', 'The Gemini API provider is not configured on the server.');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
      try {
        const res = await ai.models.generateContent({
          model: cfg.geminiApiModel,
          contents: prompt,
          config: { abortSignal: controller.signal },
        });
        const text = res.text;
        if (!text || !text.trim()) throw new PublicError(502, 'MALFORMED', 'Gemini returned no answer.');
        return text;
      } catch (e) {
        if (e instanceof PublicError) throw e;
        if (controller.signal.aborted)
          throw new PublicError(504, 'TIMEOUT', 'Gemini took too long to respond. Please retry.', `No answer after ${cfg.timeoutMs} ms.`);
        const err = classifyProviderError(`${e?.status || ''} ${e?.message || ''}`);
        log.error({ event: 'api_failed', kind: err.code, status: e?.status });
        throw err;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
