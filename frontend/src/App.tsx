import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Config = { provider: string; maxPromptChars: number };
type ErrInfo = { message: string; code?: string; status?: number; details?: string; time: string };

function useTheme() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);
  return [dark, setDark] as const;
}

export default function App() {
  const [dark, setDark] = useTheme();
  const [config, setConfig] = useState<Config | null>(null);
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [error, setErrorState] = useState<ErrInfo | null>(null);
  const setError = (message: string, extra: Partial<ErrInfo> = {}) =>
    setErrorState(message ? { message, ...extra, time: new Date().toLocaleString() } : null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const inFlight = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setConfig)
      .catch((e) => setError('Could not reach the server. Please check that it is running.', { code: 'NO_SERVER', details: `GET /api/config failed: ${e?.message || e || 'bad response'}` }));
  }, []);

  const max = config?.maxPromptChars ?? 8000;
  const count = prompt.length;
  const tooLong = count > max;
  const canSend = !loading && prompt.trim().length > 0 && !tooLong;

  const send = useCallback(async () => {
    if (inFlight.current || !canSend) return;
    inFlight.current = true;
    setLoading(true);
    setError('');
    setResponse('');
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const r = await fetch('/api/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt: prompt.trim() }),
        signal: controller.signal,
      });
      let data: { success?: boolean; response?: string; error?: string; code?: string; details?: string } = {};
      const raw = await r.text();
      try { data = JSON.parse(raw); } catch { /* non-JSON, e.g. proxy error page */ }
      if (r.ok && data.success && typeof data.response === 'string') {
        setResponse(data.response);
      } else {
        setError(data.error || (r.status === 504 || r.status === 502 ? 'The server did not respond in time.' : `Request failed (${r.status}).`), {
          code: data.code || (data.error ? undefined : 'BAD_RESPONSE'),
          status: r.status,
          details: data.details || (data.error ? undefined : `HTTP ${r.status} ${r.statusText}\n${raw.slice(0, 2000)}`),
        });
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError('Network error. Please check your connection and try again.', { code: 'NETWORK', details: `${(e as Error).name}: ${(e as Error).message}` });
    } finally {
      inFlight.current = false;
      abortRef.current = null;
      setLoading(false);
    }
  }, [canSend, prompt]);

  const clear = () => {
    abortRef.current?.abort();
    setPrompt(''); setResponse(''); setError(''); setCopied(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(response);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { setError('Copy failed. Please select the text and copy it manually.'); }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 24 24" className="size-6 text-brand-600 dark:text-brand-500" aria-hidden>
            <path fill="currentColor" d="M12 0c1 6.6 5.4 11 12 12-6.6 1-11 5.4-12 12-1-6.6-5.4-11-12-12C6.6 11 11 6.6 12 0z" />
          </svg>
          <h1 className="text-lg font-semibold tracking-tight">Gemini Prompt</h1>
          {config && (
            <span className="rounded-full border border-stone-200 px-2 py-0.5 text-xs text-stone-500 dark:border-stone-800 dark:text-stone-400">
              {config.provider}
            </span>
          )}
        </div>
        <button
          onClick={() => setDark(!dark)}
          className="rounded-lg p-2 text-stone-500 transition hover:bg-stone-200/60 dark:text-stone-400 dark:hover:bg-stone-800"
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {dark ? '☀︎' : '☾'}
        </button>
      </header>

      <main className="flex flex-1 flex-col gap-5">
        <div className="rounded-2xl border border-stone-200 bg-white shadow-sm transition focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15 dark:border-stone-800 dark:bg-stone-900">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
            rows={7}
            disabled={loading}
            aria-label="Prompt"
            placeholder="Ask anything — e.g. “Explain how HTTPS works in simple terms.”"
            className="block w-full resize-y rounded-t-2xl bg-transparent px-4 pt-4 pb-2 text-base leading-relaxed outline-none placeholder:text-stone-400 disabled:opacity-60 dark:placeholder:text-stone-500"
          />
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 px-3 py-2.5 dark:border-stone-800">
            <span className={`text-xs tabular-nums ${tooLong ? 'font-medium text-red-600 dark:text-red-400' : 'text-stone-400'}`}>
              {count.toLocaleString()} / {max.toLocaleString()}
              <span className="ml-2 hidden sm:inline">· Ctrl+Enter to send</span>
            </span>
            <div className="flex gap-2">
              <button
                onClick={clear}
                disabled={!prompt && !response && !error}
                className="rounded-lg px-3.5 py-2 text-sm font-medium text-stone-600 transition hover:bg-stone-100 disabled:opacity-40 dark:text-stone-300 dark:hover:bg-stone-800"
              >
                Clear
              </button>
              <button
                onClick={send}
                disabled={!canSend}
                className="inline-flex min-w-24 items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-brand-500 dark:text-stone-950 dark:hover:bg-brand-600"
              >
                {loading && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
                {loading ? 'Thinking' : 'Send'}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            <p className="font-medium">{error.message}</p>
            <p className="mt-1 text-xs opacity-80">
              {[error.code && `Code: ${error.code}`, error.status && `HTTP ${error.status}`, error.time].filter(Boolean).join(' · ')}
            </p>
            {error.details && (
              <details className="mt-2" open>
                <summary className="cursor-pointer text-xs font-medium">Technical details</summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-red-100/70 p-3 font-mono text-xs dark:bg-red-950/60">{error.details}</pre>
                <button
                  onClick={() => navigator.clipboard?.writeText(`${error.message}\n${error.code ?? ''} ${error.status ?? ''}\n${error.details}`)}
                  className="mt-2 text-xs font-medium underline"
                >Copy error</button>
              </details>
            )}
          </div>
        )}

        {loading && (
          <div className="space-y-3 rounded-2xl border border-stone-200 p-5 dark:border-stone-800" aria-live="polite">
            <p className="text-sm text-stone-500">Generating a response…</p>
            {[90, 75, 82].map((w) => (
              <div key={w} className="shimmer h-3 rounded bg-stone-100 dark:bg-stone-800/60" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}

        {response && !loading && (
          <section className="rounded-2xl border border-stone-200 bg-white shadow-sm dark:border-stone-800 dark:bg-stone-900">
            <div className="flex items-center justify-between border-b border-stone-100 px-4 py-2.5 dark:border-stone-800">
              <h2 className="text-sm font-medium text-stone-500 dark:text-stone-400">Response</h2>
              <button
                onClick={copy}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-brand-700 transition hover:bg-brand-50 dark:text-brand-500 dark:hover:bg-stone-800"
              >
                {copied ? 'Copied ✓' : 'Copy response'}
              </button>
            </div>
            <article className="prose prose-stone max-w-none px-5 py-4 dark:prose-invert prose-pre:bg-stone-900 prose-pre:text-stone-100">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{response}</ReactMarkdown>
            </article>
          </section>
        )}
      </main>

      <footer className="mt-10 text-center text-xs text-stone-400">One prompt, one answer. Nothing is stored.</footer>
    </div>
  );
}
