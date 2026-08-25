import { useCallback, useEffect, useRef, useState } from 'react';
import { createBuildCalculationWorkerLifecycle } from './buildCalculationWorkerLifecycle.js';

function createWorkerUnavailableError() {
  const error = new Error('Build calculation worker is not ready yet. Please try again.');
  error.name = 'CalculatorWorkerUnavailableError';
  return error;
}

export default function useBuildCalculation() {
  const calculatorWorkerRef = useRef(null);
  const latestCalculationRequestIdRef = useRef(0);
  const [lifecycle, setLifecycle] = useState(null);

  useEffect(() => {
    const nextLifecycle = createBuildCalculationWorkerLifecycle({
      createWorker() {
        return new Worker(
          new URL('../../../workers/buildCalculator.worker.js', import.meta.url),
          { type: 'module' },
        );
      },
      onRequestStarted(requestId) {
        latestCalculationRequestIdRef.current = requestId;
      },
      onWorkerChanged(worker) {
        calculatorWorkerRef.current = worker;
      },
    });
    setLifecycle(nextLifecycle);
    nextLifecycle.start();

    return () => {
      nextLifecycle.destroy();
      calculatorWorkerRef.current = null;
    };
  }, []);

  const cancelPendingCalculations = useCallback(
    exceptRequestId => lifecycle?.cancelPendingCalculations(exceptRequestId),
    [lifecycle],
  );

  const runBuildCalculation = useCallback(
    calculationInput => {
      if (lifecycle) return lifecycle.runBuildCalculation(calculationInput);
      return {
        requestId: latestCalculationRequestIdRef.current,
        promise: Promise.reject(createWorkerUnavailableError()),
      };
    },
    [lifecycle],
  );

  return { cancelPendingCalculations, latestCalculationRequestIdRef, runBuildCalculation };
}
