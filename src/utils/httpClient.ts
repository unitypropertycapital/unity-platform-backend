import { config } from './config';
import { logger } from './logger';

export interface HttpResponse<T> {
  data: T;
  status: number;
  ok: boolean;
}

export interface HttpError {
  message: string;
  status?: number;
  code: 'TIMEOUT' | 'NETWORK' | 'HTTP_ERROR' | 'PARSE_ERROR' | 'UNKNOWN';
}

export type HttpResult<T> =
  | { success: true; response: HttpResponse<T> }
  | { success: false; error: HttpError };

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  retries?: number;
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeout: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function attemptRequest<T>(
  url: string,
  options: RequestOptions
): Promise<HttpResult<T>> {
  const timeout = options.timeout ?? config.http.timeout;
  const method = options.method ?? 'GET';

  const fetchOptions: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };

  if (options.body && method !== 'GET') {
    fetchOptions.body = JSON.stringify(options.body);
  }

  try {
    const response = await fetchWithTimeout(url, fetchOptions, timeout);

    if (!response.ok) {
      return {
        success: false,
        error: {
          message: `HTTP ${response.status}: ${response.statusText}`,
          status: response.status,
          code: 'HTTP_ERROR',
        },
      };
    }

    const data = (await response.json()) as T;

    return {
      success: true,
      response: {
        data,
        status: response.status,
        ok: true,
      },
    };
  } catch (err) {
    const error = err as Error;

    if (error.name === 'AbortError') {
      return {
        success: false,
        error: {
          message: `Request timeout after ${timeout}ms`,
          code: 'TIMEOUT',
        },
      };
    }

    if (error.message?.includes('fetch')) {
      return {
        success: false,
        error: {
          message: `Network error: ${error.message}`,
          code: 'NETWORK',
        },
      };
    }

    return {
      success: false,
      error: {
        message: error.message || 'Unknown error',
        code: 'UNKNOWN',
      },
    };
  }
}

export async function httpRequest<T>(
  url: string,
  options: RequestOptions = {}
): Promise<HttpResult<T>> {
  const maxRetries = options.retries ?? config.http.retries;
  const method = options.method ?? 'GET';

  let lastResult: HttpResult<T> | null = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const isRetry = attempt > 1;

    logger.info(`HTTP ${method} ${url}`, {
      attempt,
      maxRetries: maxRetries + 1,
      isRetry,
    });

    const result = await attemptRequest<T>(url, options);
    lastResult = result;

    if (result.success) {
      logger.info(`HTTP ${method} ${url} succeeded`, {
        attempt,
        status: result.response.status,
      });
      return result;
    }

    // Don't retry on HTTP 4xx errors (client errors)
    if (result.error.status && result.error.status >= 400 && result.error.status < 500) {
      logger.warn(`HTTP ${method} ${url} failed with client error, not retrying`, {
        attempt,
        error: result.error,
      });
      return result;
    }

    if (attempt <= maxRetries) {
      logger.warn(`HTTP ${method} ${url} failed, retrying...`, {
        attempt,
        error: result.error,
        nextAttempt: attempt + 1,
      });
      // Small delay before retry
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }

  logger.error(`HTTP ${method} ${url} failed after all retries`, {
    totalAttempts: maxRetries + 1,
    error: lastResult?.success === false ? lastResult.error : 'Unknown',
  });

  return lastResult!;
}

