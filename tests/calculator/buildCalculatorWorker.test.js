import test from 'node:test';
import assert from 'node:assert/strict';

test('calculator worker forwards characteristic mode and the shared maxPrice option', async () => {
  const messages = [];
  const previousSelf = globalThis.self;
  globalThis.self = {
    postMessage(message) {
      messages.push(message);
    },
  };

  try {
    await import(`../../src/workers/buildCalculator.worker.js?test=${Date.now()}`);

    const part = {
      id: 'worker-part',
      name: 'Worker part',
      shortName: 'Worker part',
      weight: 0.1,
      avg24hPrice: 1_000,
      ergonomicsModifier: 10,
      recoilModifier: -12.5,
      categories: [],
      conflictingItems: [],
      properties: { slots: [] },
    };
    const weapon = {
      id: 'worker-weapon',
      name: 'Worker weapon',
      shortName: 'Worker weapon',
      weight: 1,
      avg24hPrice: 1_000,
      categories: [{ name: 'Weapon' }],
      conflictingItems: [],
      properties: {
        ergonomics: 50,
        recoilVertical: 100,
        recoilHorizontal: 100,
        centerOfImpact: 0.01,
        deviationCurve: 1.35,
        deviationMax: 23,
        slots: [{
          name: 'Stock',
          nameId: 'mod_stock',
          required: true,
          filters: { allowedItems: [{ id: part.id }] },
        }],
      },
    };
    const customProfile = {
      ergonomics: 80,
      verticalRecoil: 100,
      horizontalRecoil: 100,
      weight: 0,
      price: 0,
    };

    globalThis.self.onmessage({
      data: { type: 'initialize', modMap: { [part.id]: part }, modMapVersion: 1 },
    });
    globalThis.self.onmessage({
      data: {
        type: 'calculate',
        requestId: 1,
        modMapVersion: 1,
        weapon,
        targetType: 'custom',
        customProfile,
        priorityAttributes: ['ergonomics', 'recoil', 'weight'],
        options: {},
      },
    });
    globalThis.self.onmessage({
      data: {
        type: 'calculate',
        requestId: 3,
        modMapVersion: 1,
        weapon,
        targetType: 'custom',
        customProfile,
        priorityAttributes: ['recoil', 'ergonomics', 'weight'],
        characteristicMode: 'priorities',
        prioritySelectionMode: 'weighted',
        priorityWeights: { recoil: 80, ergonomics: 10, weight: 10 },
        options: { maxPrice: 0 },
      },
    });
    globalThis.self.onmessage({
      data: {
        type: 'calculate',
        requestId: 2,
        modMapVersion: 1,
        weapon,
        targetType: 'custom',
        customProfile: { ...customProfile, ergonomics: 60 },
        options: {},
      },
    });
    globalThis.self.onmessage({
      data: {
        type: 'calculate',
        requestId: 4,
        modMapVersion: 1,
        weapon,
        targetType: 'meta',
        customProfile,
        options: {},
      },
    });

    assert.equal(messages[0].requestId, 1);
    // Ergonomics 80 is unreachable (max 60): the worker still returns the
    // closest build with a soft-limit warning instead of an error.
    assert.equal(messages[0].result.error, undefined);
    assert.deepEqual(messages[0].result.build.map(entry => entry.item.id), [part.id]);
    assert.equal(messages[0].result.constraintEvaluation.satisfied, false);
    assert.equal(messages[0].result.warningCode, 'REQUIREMENTS_UNMET_CLOSEST_BUILD');
    assert.equal(messages[1].requestId, 3);
    assert.equal(messages[1].result.error, undefined);
    assert.equal(messages[1].result.stats.recoilModifier, -12.5);
    assert.equal(messages[2].requestId, 2);
    assert.equal(messages[2].result.error, undefined);
    assert.equal(messages[2].result.stats.accuracyMoa, 0.34);
    assert.equal(messages[2].result.constraintEvaluation.satisfied, true);
    assert.equal(messages[3].requestId, 4);
    assert.equal(messages[3].result.error, undefined);
    assert.equal(messages[3].result.stats.ergonomics, 60);
    assert.equal(messages[3].result.stats.recoilModifier, -12.5);
  } finally {
    globalThis.self = previousSelf;
  }
});
