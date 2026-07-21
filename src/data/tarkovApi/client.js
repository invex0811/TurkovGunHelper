export const TARKOV_JSON_API_URL = 'https://json.tarkov.dev/';
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export class TarkovApiError extends Error {
  constructor(message, { code = 'UNKNOWN', status, cause } = {}) {
    super(message);
    this.name = 'TarkovApiError';
    this.code = code;

    if (Number.isInteger(status)) this.status = status;
    if (cause !== undefined) this.cause = cause;
  }
}

export function isAbortError(error) {
  return error?.code === 'ABORTED' || error?.name === 'AbortError';
}

function getTimeoutMs(timeoutMs) {
  if (timeoutMs === 0) return 0;
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

function createRequestScope(callerSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(callerSignal.reason);

  if (callerSignal) {
    if (callerSignal.aborted) abortFromCaller();
    else callerSignal.addEventListener('abort', abortFromCaller, { once: true });
  }

  const timeoutId = timeoutMs > 0
    ? setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs)
    : undefined;

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    wasAborted: () => controller.signal.aborted,
    cleanup: () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      callerSignal?.removeEventListener('abort', abortFromCaller);
    },
  };
}

function createApiUrl(path) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new TarkovApiError('A Tarkov.dev JSON endpoint is required.', {
      code: 'INVALID_RESPONSE',
    });
  }

  const url = new URL(path, TARKOV_JSON_API_URL);
  if (url.origin !== new URL(TARKOV_JSON_API_URL).origin) {
    throw new TarkovApiError('The Tarkov.dev JSON endpoint is invalid.', {
      code: 'INVALID_RESPONSE',
    });
  }
  return url.href;
}

/**
 * Fetches one JSON API envelope. Most endpoints expose an object in `data`;
 * array-backed endpoints (currently barters) must opt in explicitly.
 */
export async function fetchTarkovJson(path, options = {}) {
  const requestScope = createRequestScope(options.signal, getTimeoutMs(options.timeoutMs));

  try {
    if (requestScope.signal.aborted) {
      throw new TarkovApiError('The Tarkov.dev request was cancelled.', {
        code: 'ABORTED',
        cause: options.signal?.reason,
      });
    }

    const response = await fetch(createApiUrl(path), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: requestScope.signal,
    });

    if (!response.ok) {
      const statusText = response.statusText ? ` ${response.statusText}` : '';
      throw new TarkovApiError(
        `Tarkov.dev returned HTTP ${response.status}${statusText}.`,
        { code: 'HTTP_ERROR', status: response.status },
      );
    }

    let result;
    try {
      result = await response.json();
    } catch (error) {
      throw new TarkovApiError(
        'Tarkov.dev returned an unreadable JSON response.',
        { code: 'INVALID_RESPONSE', cause: error },
      );
    }

    const hasObjectData = result
      && typeof result === 'object'
      && !Array.isArray(result)
      && result.data
      && typeof result.data === 'object'
      && (options.allowArrayData || !Array.isArray(result.data));

    if (!hasObjectData) {
      throw new TarkovApiError(
        'Tarkov.dev returned an invalid JSON response.',
        { code: 'INVALID_RESPONSE' },
      );
    }

    return result;
  } catch (error) {
    if (requestScope.didTimeout()) {
      throw new TarkovApiError(
        'The Tarkov.dev request timed out. Please try again.',
        { code: 'TIMEOUT', cause: error },
      );
    }
    if (requestScope.wasAborted() || isAbortError(error)) {
      throw new TarkovApiError('The Tarkov.dev request was cancelled.', {
        code: 'ABORTED',
        cause: error,
      });
    }
    if (error instanceof TarkovApiError) throw error;

    throw new TarkovApiError(
      'Could not reach Tarkov.dev. Check your connection and try again.',
      { code: 'NETWORK_ERROR', cause: error },
    );
  } finally {
    requestScope.cleanup();
  }
}
