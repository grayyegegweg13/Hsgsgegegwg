import { PublicError } from './errors.js';

/** Bounded concurrency limiter with a bounded FIFO wait queue. */
export function createLimiter(maxConcurrent, maxQueue) {
  let active = 0;
  const waiting = [];
  const next = () => {
    if (active >= maxConcurrent || waiting.length === 0) return;
    active++;
    const { task, resolve, reject } = waiting.shift();
    Promise.resolve()
      .then(task)
      .then(resolve, reject)
      .finally(() => { active--; next(); });
  };
  return {
    run(task) {
      if (active >= maxConcurrent && waiting.length >= maxQueue)
        return Promise.reject(new PublicError(503, 'BUSY', 'The server is busy. Please try again in a moment.'));
      return new Promise((resolve, reject) => { waiting.push({ task, resolve, reject }); next(); });
    },
    stats: () => ({ active, queued: waiting.length, maxConcurrent, maxQueue }),
  };
}
