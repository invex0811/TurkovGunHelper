const API_URL = 'https://api.tarkov.dev/graphql';
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export class TarkovApiError extends Error {
  constructor(message, { code = 'UNKNOWN', status, cause } = {}) {
    super(message);
    this.name = 'TarkovApiError';
    this.code = code;

    if (Number.isInteger(status)) {
      this.status = status;
    }

    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

export function isAbortError(error) {
  return error?.code === 'ABORTED' || error?.name === 'AbortError';
}

function getTimeoutMs(timeoutMs) {
  if (timeoutMs === 0) {
    return 0;
  }

  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

function createRequestScope(callerSignal, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;

  const abortFromCaller = () => controller.abort(callerSignal.reason);

  if (callerSignal) {
    if (callerSignal.aborted) {
      abortFromCaller();
    } else {
      callerSignal.addEventListener('abort', abortFromCaller, { once: true });
    }
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
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }

      if (callerSignal) {
        callerSignal.removeEventListener('abort', abortFromCaller);
      }
    },
  };
}

function getGraphQLErrorMessage(errors) {
  return errors.find(error => typeof error?.message === 'string')?.message
    || 'Tarkov.dev could not complete the request.';
}

export async function fetchGraphQL(query, variables = {}, options = {}) {
  const requestScope = createRequestScope(options.signal, getTimeoutMs(options.timeoutMs));

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
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
        'Tarkov.dev returned an unreadable response.',
        { code: 'INVALID_RESPONSE', cause: error },
      );
    }

    if (!result || typeof result !== 'object') {
      throw new TarkovApiError(
        'Tarkov.dev returned an invalid response.',
        { code: 'INVALID_RESPONSE' },
      );
    }

    if (Array.isArray(result.errors) && result.errors.length > 0) {
      throw new TarkovApiError(getGraphQLErrorMessage(result.errors), {
        code: 'GRAPHQL_ERROR',
      });
    }

    if (!Object.hasOwn(result, 'data')) {
      throw new TarkovApiError(
        'Tarkov.dev returned an invalid response.',
        { code: 'INVALID_RESPONSE' },
      );
    }

    return result.data;
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

    if (error instanceof TarkovApiError) {
      throw error;
    }

    throw new TarkovApiError(
      'Could not reach Tarkov.dev. Check your connection and try again.',
      { code: 'NETWORK_ERROR', cause: error },
    );
  } finally {
    requestScope.cleanup();
  }
}
