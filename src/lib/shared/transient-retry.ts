/**
 * PROD-3449: retry a request that failed for a reason that usually clears up by itself — a
 * gateway/service error (502/503/504), throttling (429), a request timeout (408) or a dropped
 * connection — with exponential backoff.
 *
 * On 2026-11-25 nine asset uploads got 503 "The service is unavailable" within six seconds and were
 * never retried; the content using them then synced without its images. A few seconds of backoff
 * rides out a blip like that.
 *
 * A 500 isn't retried: it usually means the request itself is the problem, and sending it again
 * gives the same answer. Neither is anything in the 4xx range besides 408/429.
 */

export const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 502, 503, 504]);

export const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
]);

/** Waits between attempts: 2s, 4s, 8s, 16s (five attempts, about 30s in all). */
export const DEFAULT_RETRY_DELAYS_MS = [2000, 4000, 8000, 16000];

export function httpStatusOf(error: any): number | undefined {
  const status = error?.response?.status ?? error?.status ?? error?.statusCode;
  return typeof status === "number" ? status : undefined;
}

export function isTransientError(error: any): boolean {
  const status = httpStatusOf(error);
  if (status !== undefined) return TRANSIENT_HTTP_STATUSES.has(status);
  const code = error?.code ?? error?.cause?.code;
  return typeof code === "string" && TRANSIENT_NETWORK_CODES.has(code);
}

export interface RetryOptions {
  delaysMs?: number[];
  /** Called before each retry, e.g. to log it. `attempt` is the retry number, from 1. */
  onRetry?: (error: any, attempt: number, delayMs: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn`, retrying it after each transient failure, up to `delaysMs.length` times. The last error
 * (or the first non-transient one) is rethrown unchanged.
 */
export async function withTransientRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const delays = options.delaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= delays.length || !isTransientError(error)) throw error;
      const delayMs = delays[attempt];
      options.onRetry?.(error, attempt + 1, delayMs);
      await sleep(delayMs);
    }
  }
}
