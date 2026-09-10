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
      recoilModifier: 0,
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
        customExactTargets: { ergonomics: true },
        priorityAttributes: ['ergonomics', 'ergonomics', 'price', 'weight', 'verticalRecoil'],
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
        customExactTargets: { ergonomics: true },
        priorityAttributes: ['ergonomics'],
        characteristicMode: 'priorities',
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

    assert.equal(messages[0].requestId, 1);
    assert.equal(messages[0].result.errorCode, 'CUSTOM_EXACT_TARGETS_UNMET');
    assert.equal(messages[1].requestId, 3);
    assert.equal(messages[1].result.error, undefined);
    assert.equal(messages[2].requestId, 2);
    assert.equal(messages[2].result.error, undefined);
    assert.equal(messages[2].result.stats.accuracyMoa, 0.34);
  } finally {
    globalThis.self = previousSelf;
  }
});
