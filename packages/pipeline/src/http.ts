export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = "HttpError";
  }
}

export interface HttpClient {
  getJson<T>(url: string): Promise<T>;
  getText(url: string): Promise<string>;
}

export interface HttpClientOptions {
  minIntervalMs?: number;
  retries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  userAgent?: string;
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
  headers?: Record<string, string>;
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createHttpClient(options: HttpClientOptions = {}): HttpClient {
  const minIntervalMs = options.minIntervalMs ?? 250;
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const userAgent = options.userAgent ?? "scout-job-finder/0.1 (personal job search)";
  const doFetch = options.fetchImpl ?? ((url: string, init: RequestInit) => fetch(url, init));

  let nextAllowedAt = 0;

  async function throttle(): Promise<void> {
    const now = Date.now();
    const wait = nextAllowedAt - now;
    if (wait > 0) await sleep(wait);
    nextAllowedAt = Math.max(now, nextAllowedAt) + minIntervalMs;
  }

  async function request(url: string): Promise<Response> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < retries; attempt += 1) {
      await throttle();
      try {
        const response = await doFetch(url, {
          headers: {
            accept: "application/json, text/plain, */*",
            "user-agent": userAgent,
            ...options.headers,
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok) return response;
        const body = await response.text();
        const error = new HttpError(response.status, url, body.slice(0, 500));
        if (!RETRYABLE_STATUSES.has(response.status)) throw error;
        lastError = error;
      } catch (error) {
        if (error instanceof HttpError && !RETRYABLE_STATUSES.has(error.status)) throw error;
        lastError = error;
      }
      if (attempt < retries - 1) await sleep(baseDelayMs * 2 ** attempt);
    }
    throw lastError instanceof Error ? lastError : new Error(`request failed for ${url}`);
  }

  return {
    async getJson<T>(url: string): Promise<T> {
      const response = await request(url);
      return (await response.json()) as T;
    },
    async getText(url: string): Promise<string> {
      const response = await request(url);
      return await response.text();
    },
  };
}
