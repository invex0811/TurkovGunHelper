import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_INCLUDE_TRADER_PRICES,
  loadIncludeTraderPricesPreference,
  saveIncludeTraderPricesPreference,
} from '../../src/data/settings/buildPreferences.js';

function withWindow(localStorage, run) {
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage };

  try {
    return run();
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
}

function createStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('trader prices are enabled by default', () => {
  assert.equal(DEFAULT_INCLUDE_TRADER_PRICES, true);
  assert.equal(loadIncludeTraderPricesPreference(), true);
});

test('includeTraderPrices preference persists a safe serialized boolean', () => {
  const storage = createStorage();

  withWindow(storage, () => {
    saveIncludeTraderPricesPreference(false);
    assert.equal(loadIncludeTraderPricesPreference(), false);

    saveIncludeTraderPricesPreference(true);
    assert.equal(loadIncludeTraderPricesPreference(), true);
  });
});

test('includeTraderPrices preference safely handles unavailable storage', () => {
  const localStorage = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };

  withWindow(localStorage, () => {
    assert.equal(loadIncludeTraderPricesPreference(), true);
    assert.doesNotThrow(() => saveIncludeTraderPricesPreference(false));
  });
});
