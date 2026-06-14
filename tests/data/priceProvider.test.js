import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PRICE_MODE,
  PRICE_MODES,
} from '../../src/data/price/priceModes.js';
import {
  getEffectivePriceMode,
  getTarkovDevGameMode,
  TARKOV_DEV_GAME_MODES,
} from '../../src/data/price/priceProvider.js';

test('getEffectivePriceMode keeps supported price modes', () => {
  assert.equal(getEffectivePriceMode(PRICE_MODES.PVP), PRICE_MODES.PVP);
  assert.equal(getEffectivePriceMode(PRICE_MODES.PVE), PRICE_MODES.PVE);
});

test('getEffectivePriceMode falls back to default mode for unsupported values', () => {
  assert.equal(getEffectivePriceMode(undefined), DEFAULT_PRICE_MODE);
  assert.equal(getEffectivePriceMode(null), DEFAULT_PRICE_MODE);
  assert.equal(getEffectivePriceMode('invalid'), DEFAULT_PRICE_MODE);
});

test('getTarkovDevGameMode maps PvP price mode to regular tarkov.dev game mode', () => {
  assert.equal(getTarkovDevGameMode(PRICE_MODES.PVP), TARKOV_DEV_GAME_MODES.REGULAR);
});

test('getTarkovDevGameMode maps PvE price mode to pve tarkov.dev game mode', () => {
  assert.equal(getTarkovDevGameMode(PRICE_MODES.PVE), TARKOV_DEV_GAME_MODES.PVE);
});

test('getTarkovDevGameMode falls back to regular tarkov.dev game mode for unsupported values', () => {
  assert.equal(getTarkovDevGameMode(undefined), TARKOV_DEV_GAME_MODES.REGULAR);
  assert.equal(getTarkovDevGameMode('invalid'), TARKOV_DEV_GAME_MODES.REGULAR);
});