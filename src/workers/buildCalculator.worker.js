import { calculateBestBuild } from '../domain/calculator.js';

let modMap = null;
let modMapVersion = null;
const cancelledRequestIds = new Set();

self.onmessage = ({ data }) => {
  if (data.type === 'initialize') {
    modMap = data.modMap;
    modMapVersion = data.modMapVersion;
    return;
  }

  if (data.type === 'cancel') {
    cancelledRequestIds.add(data.requestId);
    return;
  }

  if (data.type !== 'calculate') return;

  const { requestId } = data;

  if (cancelledRequestIds.has(requestId)) {
    cancelledRequestIds.delete(requestId);
    return;
  }

  if (!modMap || modMapVersion !== data.modMapVersion) {
    self.postMessage({
      type: 'error',
      requestId,
      error: {
        name: 'CalculatorWorkerStateError',
        message: 'The calculator data is not initialized for this request.',
      },
    });
    return;
  }

  try {
    const result = calculateBestBuild(
      data.weapon,
      data.targetType,
      data.customErgo,
      data.customRecoil,
      modMap,
      data.options,
    );

    if (!cancelledRequestIds.has(requestId)) {
      self.postMessage({ type: 'result', requestId, result });
    }

    cancelledRequestIds.delete(requestId);
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      error: {
        name: error?.name ?? 'Error',
        message: error?.message ?? 'Build calculation failed in the worker.',
      },
    });
  }
};
