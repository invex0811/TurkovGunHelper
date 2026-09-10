export function createCancelledCalculationError() {
  const error = new Error('A newer build calculation replaced this request.');
  error.name = 'AbortError';
  return error;
}

function createWorkerUnavailableError(cause) {
  const error = new Error('Build calculation worker is not ready yet. Please try again.');
  error.name = 'CalculatorWorkerUnavailableError';
  if (cause) error.cause = cause;
  return error;
}

function createWorkerError(event) {
  const error = new Error(event?.message || 'Build calculation worker failed to start.');
  error.name = 'CalculatorWorkerError';
  return error;
}

export function createBuildCalculationWorkerLifecycle({
  createWorker,
  onRequestStarted,
  onWorkerChanged,
}) {
  let activeWorker = null;
  let destroyed = false;
  let nextRequestId = 0;
  let workerData = { initialized: false, modMap: null, version: 0 };
  const pendingCalculations = new Map();

  const rejectPending = (error, exceptRequestId = null) => {
    pendingCalculations.forEach((pendingCalculation, requestId) => {
      if (requestId === exceptRequestId) return;
      pendingCalculations.delete(requestId);
      pendingCalculation.reject(error);
    });
  };

  const terminateActiveWorker = () => {
    const worker = activeWorker;
    if (!worker) return;

    activeWorker = null;
    worker.terminate();
    onWorkerChanged?.(null);
  };

  const createActiveWorker = () => {
    if (destroyed || activeWorker) return activeWorker;

    let worker;
    try {
      worker = createWorker();
    } catch {
      return null;
    }

    activeWorker = worker;
    onWorkerChanged?.(worker);
    workerData = {
      initialized: false,
      modMap: null,
      version: workerData.version + 1,
    };

    worker.onmessage = ({ data }) => {
      if (activeWorker !== worker) return;

      const pendingCalculation = pendingCalculations.get(data.requestId);
      if (!pendingCalculation) return;

      pendingCalculations.delete(data.requestId);
      if (data.type === 'result') {
        pendingCalculation.resolve(data.result);
        return;
      }

      const error = new Error(data.error?.message ?? 'Build calculation failed in the worker.');
      error.name = data.error?.name ?? 'CalculatorWorkerError';
      pendingCalculation.reject(error);
    };

    worker.onerror = event => {
      if (activeWorker !== worker) return;

      terminateActiveWorker();
      rejectPending(createWorkerError(event));
    };

    return worker;
  };

  const initializeWorker = (worker, allMods) => {
    if (workerData.initialized && workerData.modMap === allMods) return;

    workerData = {
      initialized: true,
      modMap: allMods,
      version: workerData.version + 1,
    };
    worker.postMessage({
      type: 'initialize',
      modMap: allMods,
      modMapVersion: workerData.version,
    });
  };

  const cancelPendingCalculations = (exceptRequestId = null) => {
    let cancelled = false;
    pendingCalculations.forEach((pendingCalculation, requestId) => {
      if (requestId === exceptRequestId) return;
      cancelled = true;
      pendingCalculations.delete(requestId);
      pendingCalculation.reject(createCancelledCalculationError());
    });

    if (cancelled) terminateActiveWorker();
  };

  const runBuildCalculation = calculationInput => {
    const requestId = nextRequestId + 1;
    nextRequestId = requestId;
    onRequestStarted?.(requestId);

    cancelPendingCalculations(requestId);
    const worker = createActiveWorker();
    if (!worker) {
      return {
        requestId,
        promise: Promise.reject(createWorkerUnavailableError()),
      };
    }

    try {
      initializeWorker(worker, calculationInput.allMods);
    } catch (error) {
      terminateActiveWorker();
      return {
        requestId,
        promise: Promise.reject(createWorkerUnavailableError(error)),
      };
    }

    const promise = new Promise((resolve, reject) => {
      pendingCalculations.set(requestId, { resolve, reject });
    });

    try {
      worker.postMessage({
        type: 'calculate',
        requestId,
        modMapVersion: workerData.version,
        weapon: calculationInput.weapon,
        targetType: calculationInput.targetType,
        customProfile: calculationInput.customProfile,
        customExactTargets: calculationInput.customExactTargets,
        priorityAttributes: calculationInput.priorityAttributes,
        characteristicMode: calculationInput.characteristicMode,
        options: calculationInput.options,
      });
    } catch (error) {
      pendingCalculations.delete(requestId);
      terminateActiveWorker();
      return {
        requestId,
        promise: Promise.reject(createWorkerUnavailableError(error)),
      };
    }

    return { requestId, promise };
  };

  return {
    cancelPendingCalculations,
    destroy() {
      destroyed = true;
      rejectPending(createCancelledCalculationError());
      terminateActiveWorker();
    },
    runBuildCalculation,
    start() {
      createActiveWorker();
    },
  };
}
