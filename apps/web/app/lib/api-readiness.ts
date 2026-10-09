import { setTimeout as delay } from 'node:timers/promises';

type Timing = { budgetMs?: number; probeTimeoutMs?: number; retryDelayMs?: number };

// Only health GETs are retried. The caller sends its inquiry once after readiness.
export async function waitForApiReady(apiUrl: string, signal: AbortSignal, timing: Timing = {}): Promise<boolean> {
  const deadline = AbortSignal.timeout(timing.budgetMs ?? 75000);
  const readinessSignal = AbortSignal.any([signal, deadline]);
  const healthUrl = `${apiUrl.replace(/\/$/, '')}/v1/health`;
  while (!deadline.aborted) {
    signal.throwIfAborted();
    let response: Response | undefined;
    let ready = false;
    try {
      response = await fetch(healthUrl, {
        method: 'GET', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.any([readinessSignal, AbortSignal.timeout(timing.probeTimeoutMs ?? 8000)]),
      });
      if (response.ok && response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json') {
        const body: unknown = await response.json();
        ready = Boolean(body && typeof body === 'object' && 'status' in body && body.status === 'ok' && 'service' in body && body.service === 'ablest-api');
      }
    } catch {
      // Render can return HTML, a connection error, or a timeout while waking.
      // None of these safe probes contains the inquiry or sends an email.
    } finally {
      if (response?.body && !response.bodyUsed) await response.body.cancel().catch(() => {});
    }
    signal.throwIfAborted();
    if (deadline.aborted) return false;
    if (ready) return true;
    try {
      await delay(timing.retryDelayMs ?? 1500, undefined, { signal: readinessSignal });
    } catch {
      signal.throwIfAborted();
      return false;
    }
  }
  signal.throwIfAborted();
  return false;
}
