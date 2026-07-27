import { useCallback, useEffect, useRef } from 'react';

function createCancelledCalculationError() {
  const error = new Error('A newer build calculation replaced this request.');
  error.name = 'AbortError';
  return error;
}

export default function useBuildCalculation() {
  const calculatorWorkerRef = useRef(null);
  const calculatorDataRef = useRef({ modMap: null, version: 0 });
  const nextCalculationRequestIdRef = useRef(0);
  const latestCalculationRequestIdRef = useRef(0);
  const pendingCalculationsRef = useRef(new Map());

  const cancelPendingCalculations = useCallback((exceptRequestId = null) => {
    const worker = calculatorWorkerRef.current;

    pendingCalculationsRef.current.forEach((pendingCalculation, requestId) => {
      if (requestId === exceptRequestId) return;
      worker?.postMessage({ type: 'cancel', requestId });
      pendingCalculation.reject(createCancelledCalculationError());
      pendingCalculationsRef.current.delete(requestId);
    });
  }, []);

  useEffect(() => {
    const pendingCalculations = pendingCalculationsRef.current;
    const worker = new Worker(
      new URL('../../../workers/buildCalculator.worker.js', import.meta.url),
      { type: 'module' },
    );

    calculatorWorkerRef.current = worker;
    calculatorDataRef.current = {
      modMap: null,
      version: calculatorDataRef.current.version + 1,
    };

    worker.onmessage = ({ data }) => {
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
      const error = new Error(event.message || 'Build calculation worker failed to start.');
      pendingCalculations.forEach(pendingCalculation => pendingCalculation.reject(error));
      pendingCalculations.clear();
    };

    return () => {
      worker.terminate();
      if (calculatorWorkerRef.current === worker) {
        calculatorWorkerRef.current = null;
      }
      pendingCalculations.forEach(pendingCalculation => (
        pendingCalculation.reject(createCancelledCalculationError())
      ));
      pendingCalculations.clear();
    };
  }, []);

  const runBuildCalculation = useCallback((calculationInput) => {
    const worker = calculatorWorkerRef.current;
    if (!worker) {
      const error = new Error('Build calculation worker is not ready yet. Please try again.');
      error.name = 'CalculatorWorkerUnavailableError';
      return {
        requestId: latestCalculationRequestIdRef.current,
        promise: Promise.reject(error),
      };
    }

    const requestId = nextCalculationRequestIdRef.current + 1;
    nextCalculationRequestIdRef.current = requestId;
    latestCalculationRequestIdRef.current = requestId;
    cancelPendingCalculations(requestId);

    if (calculatorDataRef.current.modMap !== calculationInput.allMods) {
      calculatorDataRef.current = {
        modMap: calculationInput.allMods,
        version: calculatorDataRef.current.version + 1,
      };
      worker.postMessage({
        type: 'initialize',
        modMap: calculationInput.allMods,
        modMapVersion: calculatorDataRef.current.version,
      });
    }

    const promise = new Promise((resolve, reject) => {
      pendingCalculationsRef.current.set(requestId, { resolve, reject });
    });

    worker.postMessage({
      type: 'calculate',
      requestId,
      modMapVersion: calculatorDataRef.current.version,
      weapon: calculationInput.weapon,
      targetType: calculationInput.targetType,
      customProfile: calculationInput.customProfile,
      customExactTargets: calculationInput.customExactTargets,
      options: calculationInput.options,
    });

    return { requestId, promise };
  }, [cancelPendingCalculations]);

  return { latestCalculationRequestIdRef, runBuildCalculation };
}
