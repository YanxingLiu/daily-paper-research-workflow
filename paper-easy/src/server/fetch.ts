export type FetchRetryOptions = {
  timeoutMs: number;
  retries: number;
  retryBaseDelayMs: number;
  userAgent?: string;
};

const DEFAULT_FETCH_RETRY_OPTIONS: FetchRetryOptions = {
  timeoutMs: 20_000,
  retries: 2,
  retryBaseDelayMs: 500
};

export async function fetchWithRetry(
  input: URL | RequestInfo,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
  options: Partial<FetchRetryOptions> = {}
): Promise<Response> {
  const resolvedOptions = { ...DEFAULT_FETCH_RETRY_OPTIONS, ...options };
  const retries = Math.max(Math.trunc(resolvedOptions.retries), 0);
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchOnceWithTimeout(input, init, fetchImpl, resolvedOptions);
      if (!isTransientStatus(response.status)) {
        return response;
      }
      if (attempt === retries) {
        throw new Error(`Request failed with ${response.status} after ${retries} retries`);
      }
      lastError = new Error(`Request failed with ${response.status}`);
    } catch (error) {
      lastError = normalizeFetchError(error, resolvedOptions.timeoutMs);
      if (attempt === retries || !isRetriableError(lastError)) {
        throw lastError;
      }
    }

    await delay(backoffMs(resolvedOptions.retryBaseDelayMs, attempt));
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed");
}

async function fetchOnceWithTimeout(
  input: URL | RequestInfo,
  init: RequestInit,
  fetchImpl: typeof fetch,
  options: FetchRetryOptions
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Request timed out after ${options.timeoutMs}ms`)), options.timeoutMs);

  try {
    return await fetchImpl(input, {
      ...init,
      headers: withUserAgent(init.headers, options.userAgent),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function withUserAgent(headers: HeadersInit | undefined, userAgent: string | undefined): HeadersInit | undefined {
  if (!userAgent) {
    return headers;
  }

  const resolvedHeaders = new Headers(headers);
  if (!resolvedHeaders.has("User-Agent")) {
    resolvedHeaders.set("User-Agent", userAgent);
  }
  return resolvedHeaders;
}

function normalizeFetchError(error: unknown, timeoutMs: number): Error {
  if (error instanceof Error && (error.name === "AbortError" || error.message === "aborted")) {
    return new Error(`Request timed out after ${timeoutMs}ms`);
  }
  return error instanceof Error ? error : new Error("Request failed");
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRetriableError(error: unknown): boolean {
  return error instanceof Error;
}

function backoffMs(baseDelayMs: number, attempt: number): number {
  return Math.max(Math.trunc(baseDelayMs), 0) * 2 ** attempt;
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}
