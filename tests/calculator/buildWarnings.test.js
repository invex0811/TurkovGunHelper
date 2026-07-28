import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateBestBuild } from '../../src/domain/calculator.js';
import { _calculateWeighted } from '../../src/domain/calculator/candidateSearch.js';
import { BUILD_WARNING_CODES } from '../../src/domain/calculator/buildResultMessages.js';

function createWeapon(overrides = {}) {
  return {
    id: 'warning-weapon',
    name: 'Warning Weapon',
    shortName: 'WW',
    weight: overrides.weight ?? 1,
    basePrice: overrides.basePrice ?? 25_800,
    avg24hPrice: overrides.avg24hPrice,
    conflictingItems: [],
    categories: [{ name: 'Weapon' }],
    properties: {
      ergonomics: overrides.ergonomics ?? 50,
      recoilVertical: overrides.recoilVertical ?? 100,
      recoilHorizontal: overrides.recoilHorizontal ?? 100,
      slots: overrides.slots ?? [],
    },
  };
}

function createMod(overrides = {}) {
  return {
    id: overrides.id ?? 'warning-mod',
    name: 'Warning Mod',
    shortName: 'WM',
    weight: 0.1,
    basePrice: overrides.basePrice ?? 0,
    avg24hPrice: overrides.avg24hPrice,
    conflictingItems: [],
    categories: [],
    recoilModifier: -1,
    ergonomicsModifier: 0,
    properties: { slots: [] },
  };
}

test('calculator emits a structured missing-price warning with count', () => {
  const mod = createMod();
  const weapon = createWeapon({
    slots: [{
      name: 'Required',
      nameId: 'required',
      required: true,
      filters: { allowedItems: [{ id: mod.id }] },
    }],
  });

  const result = _calculateWeighted(
    weapon,
    1,
    3,
    0,
    { [mod.id]: mod },
    { requiredItemIds: [mod.id] },
  );

  const priceWarning = result.warnings.find(
    warning => warning.code === BUILD_WARNING_CODES.PRICE_ITEMS_UNAVAILABLE,
  );
  assert.equal(priceWarning.params.count, 1);
  assert.equal(result.warningCode, BUILD_WARNING_CODES.PRICE_ITEMS_UNAVAILABLE);
  assert.match(result.warning, /active price policy/i);
});

test('weapon fallback price prevents a false missing-price warning', () => {
  const result = _calculateWeighted(
    createWeapon(),
    1,
    3,
    0,
    {},
  );

  assert.equal(result.stats.price, 25_800);
  assert.equal(
    result.warnings?.some(
      warning => warning.code === BUILD_WARNING_CODES.PRICE_ITEMS_UNAVAILABLE,
    ) ?? false,
    false,
  );
});

test('calculator keeps multiple structured warnings in their original order', () => {
  const result = _calculateWeighted(
    createWeapon({ weight: 5 }),
    1,
    3,
    0,
    {},
    { maxWeight: 1, maxPrice: 1 },
  );

  assert.deepEqual(result.warnings.map(warning => warning.code), [
    BUILD_WARNING_CODES.BASE_WEAPON_MAX_WEIGHT,
    BUILD_WARNING_CODES.BUILD_MAX_PRICE_EXCEEDED,
  ]);
  assert.equal(result.warningCode, BUILD_WARNING_CODES.BASE_WEAPON_MAX_WEIGHT);
});

test('closest balanced build uses a stable warning code', () => {
  const result = calculateBestBuild(
    createWeapon(),
    'custom',
    99,
    1,
    {},
  );

  assert.equal(
    result.warnings.at(-1).code,
    BUILD_WARNING_CODES.REQUIREMENTS_UNMET_CLOSEST_BUILD,
  );
});
