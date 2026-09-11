import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createBuildCalculationWorkerLifecycle,
} from '../../src/features/configurator/hooks/buildCalculationWorkerLifecycle.js';

class FakeWorker {
  constructor() {
    this.messages = [];
    this.terminated = false;
  }

  postMessage(message) {
    this.messages.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  emitMessage(data) {
    this.onmessage?.({ data });
  }

  emitError(message) {
    this.onerror?.({ message });
  }
}

function createFixture() {
  const workers = [];
  const latestRequestIds = [];
  const lifecycle = createBuildCalculationWorkerLifecycle({
    createWorker() {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    onRequestStarted(requestId) {
      latestRequestIds.push(requestId);
    },
  });

  return { lifecycle, latestRequestIds, workers };
}

function input(allMods = { part: { id: 'part' } }) {
  return {
    allMods,
    weapon: { id: 'weapon' },
    targetType: 'balanced',
    prioritySelectionMode: 'weighted',
    priorityWeights: { recoil: 80, ergonomics: 10, weight: 10 },
    options: {},
  };
}

function assertInitializeThenCalculate(worker, requestId) {
  assert.deepEqual(worker.messages.map(message => message.type), ['initialize', 'calculate']);
  assert.equal(worker.messages[1].requestId, requestId);
  assert.equal(worker.messages[0].modMapVersion, worker.messages[1].modMapVersion);
  assert.equal(worker.messages[1].prioritySelectionMode, 'weighted');
  assert.deepEqual(worker.messages[1].priorityWeights, { recoil: 80, ergonomics: 10, weight: 10 });
}

test('keeps a successful worker alive after initializing and calculating a normal request', async () => {
  const { lifecycle, latestRequestIds, workers } = createFixture();
  lifecycle.start();
  const worker = workers[0];

  const calculation = lifecycle.runBuildCalculation(input());
  assert.equal(calculation.requestId, 1);
  assert.deepEqual(latestRequestIds, [1]);
  assertInitializeThenCalculate(worker, 1);

  worker.emitMessage({ type: 'result', requestId: 1, result: { build: [] } });
  assert.deepEqual(await calculation.promise, { build: [] });
  assert.equal(worker.terminated, false);
});

test('superseding a request terminates its worker and initializes a replacement even with the same mods', async () => {
  const { lifecycle, workers } = createFixture();
  lifecycle.start();
  const firstWorker = workers[0];
  const allMods = { part: { id: 'part' } };
  const first = lifecycle.runBuildCalculation(input(allMods));
  first.promise.catch(() => {});

  const second = lifecycle.runBuildCalculation(input(allMods));
  const secondWorker = workers[1];

  assert.equal(firstWorker.terminated, true);
  await assert.rejects(first.promise, { name: 'AbortError' });
  assertInitializeThenCalculate(secondWorker, second.requestId);
  assert.notEqual(
    secondWorker.messages[0].modMapVersion,
    firstWorker.messages[0].modMapVersion,
  );

  firstWorker.emitMessage({ type: 'result', requestId: first.requestId, result: { stale: true } });
  firstWorker.emitError('stale worker failed');
  assert.equal(secondWorker.terminated, false);
  secondWorker.emitMessage({ type: 'result', requestId: second.requestId, result: { build: ['fresh'] } });
  assert.deepEqual(await second.promise, { build: ['fresh'] });
});

test('explicit cancellation terminates a busy worker and the next request uses a new initialized worker', async () => {
  const { lifecycle, workers } = createFixture();
  lifecycle.start();
  const firstWorker = workers[0];
  const first = lifecycle.runBuildCalculation(input());
  first.promise.catch(() => {});

  lifecycle.cancelPendingCalculations();
  assert.equal(firstWorker.terminated, true);
  await assert.rejects(first.promise, { name: 'AbortError' });

  const second = lifecycle.runBuildCalculation(input());
  const secondWorker = workers[1];
  assertInitializeThenCalculate(secondWorker, second.requestId);
  secondWorker.emitMessage({ type: 'result', requestId: second.requestId, result: { build: [] } });
  assert.deepEqual(await second.promise, { build: [] });
});

test('destroy cancels pending work, terminates the worker, and does not create a replacement', async () => {
  const { lifecycle, workers } = createFixture();
  lifecycle.start();
  const worker = workers[0];
  const calculation = lifecycle.runBuildCalculation(input());
  calculation.promise.catch(() => {});

  lifecycle.destroy();
  assert.equal(worker.terminated, true);
  await assert.rejects(calculation.promise, { name: 'AbortError' });
  assert.equal(workers.length, 1);
});

test('only an active worker error rejects its current request as a normal worker error', async () => {
  const { lifecycle, workers } = createFixture();
  lifecycle.start();
  const first = lifecycle.runBuildCalculation(input());
  first.promise.catch(() => {});
  const firstWorker = workers[0];
  const second = lifecycle.runBuildCalculation(input());
  second.promise.catch(() => {});
  const secondWorker = workers[1];

  firstWorker.emitError('stale worker failed');
  assert.equal(secondWorker.terminated, false);

  secondWorker.emitError('active worker failed');
  await assert.rejects(second.promise, error => (
    error.name === 'CalculatorWorkerError' && error.message === 'active worker failed'
  ));
  await assert.rejects(first.promise, { name: 'AbortError' });
  assert.equal(secondWorker.terminated, true);
});
