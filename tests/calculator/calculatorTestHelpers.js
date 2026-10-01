import assert from 'node:assert/strict';
import fs from 'node:fs';

import { getPurchasePriceValue, sumPurchasePrices } from '../../src/data/price/priceMapper.js';

// Shared fixtures and assertions for the calculator*.test.js files. The
// calculator tests are split by topic so the test runner can run them in
// parallel; a single file ran its slow real-fixture cases one after another.

const modsFixture = JSON.parse(fs.readFileSync(new URL('../fixtures/mods.json', import.meta.url), 'utf8'));
const weaponFixture = JSON.parse(fs.readFileSync(new URL('../fixtures/weapon.json', import.meta.url), 'utf8'));

export const mods = modsFixture.data.items;
export const weapon = weaponFixture.data.item;
export const modMap = Object.fromEntries(mods.map(mod => [mod.id, mod]));

export function hasCategory(item, categoryName) {
  return item.categories?.some(category => category.name === categoryName) || false;
}

export function getExpectedItemPrice(item, priceMode) {
  return getPurchasePriceValue(
    item,
    { priceMode, includeTraderPrices: true },
    Number.MAX_SAFE_INTEGER,
  );
}

export function assertNoDuplicateParts(result) {
  const ids = result.build.map(part => part.item.id);
  assert.equal(new Set(ids).size, ids.length, 'build must not install the same item twice');
}

export function assertNoInstalledConflicts(result) {
  const installedIds = new Set([weapon.id, ...result.build.map(part => part.item.id)]);

  for (const part of result.build) {
    for (const conflict of part.item.conflictingItems || []) {
      assert.equal(
        installedIds.has(conflict.id),
        false,
        `${part.item.shortName} conflicts with another installed item ${conflict.id}`,
      );
    }
  }
}

export function assertStatsMatchParts(result) {
  const totalErgo = weapon.properties.ergonomics
    + result.build.reduce((sum, part) => sum + (part.item.ergonomicsModifier || 0), 0);
  const totalRecoilMod = result.build.reduce((sum, part) => sum + (part.item.recoilModifier || 0), 0);
  const totalWeight = weapon.weight + result.build.reduce((sum, part) => sum + (part.item.weight || 0), 0);
  const totalPrice = sumPurchasePrices(
    [weapon, ...result.build.map(part => part.item)],
    { includeTraderPrices: true },
  ).value;

  assert.equal(result.stats.ergonomics, Math.min(100, Math.round(totalErgo)));
  assert.equal(result.stats.recoilModifier, totalRecoilMod);
  assert.equal(result.stats.recoilVertical, Math.round(weapon.properties.recoilVertical * (1 + totalRecoilMod / 100)));
  assert.equal(result.stats.recoilHorizontal, Math.round(weapon.properties.recoilHorizontal * (1 + totalRecoilMod / 100)));
  assert.equal(result.stats.weight, totalWeight.toFixed(2));
  assert.equal(result.stats.price, totalPrice == null ? null : Math.round(totalPrice));
}

export function getWeightedPartScore(item, {
  currentErgo,
  ergoWeight,
  recoilWeight,
  priceWeight = 0,
  weightWeight = 0.001,
  overflowErgoWeight = 0,
  ergoCap = 100,
}) {
  const currentUsableErgo = Math.min(ergoCap, currentErgo);
  const newUsableErgo = Math.min(ergoCap, currentErgo + (item.ergonomicsModifier || 0));
  const cappedErgoMod = newUsableErgo - currentUsableErgo;
  const currentOverflowErgo = Math.max(0, currentErgo - ergoCap);
  const newOverflowErgo = Math.max(0, currentErgo + (item.ergonomicsModifier || 0) - ergoCap);
  const overflowErgoMod = newOverflowErgo - currentOverflowErgo;
  const effectiveErgoMod = cappedErgoMod + (overflowErgoMod * overflowErgoWeight);

  return (effectiveErgoMod * ergoWeight)
    - ((item.recoilModifier || 0) * recoilWeight)
    - (getExpectedItemPrice(item) * priceWeight)
    - ((item.weight || 0) * weightWeight);
}

export function createCategories(categoryNames) {
  return categoryNames.map(name => ({ name }));
}

export function createSlot(
  name,
  allowedItemIds,
  nameId = name.toLowerCase().replace(/\s+/g, '_'),
  required = false,
) {
  return {
    name,
    nameId,
    required,
    filters: {
      allowedItems: allowedItemIds.map(id => ({ id })),
    },
  };
}

export function createTestWeapon(overrides = {}) {
  return {
    id: overrides.id ?? 'test-weapon',
    name: overrides.name ?? 'Test Weapon',
    shortName: overrides.shortName ?? 'TW',
    weight: overrides.weight ?? 1,
    basePrice: overrides.basePrice ?? 1000,
    avg24hPrice: overrides.avg24hPrice ?? 1000,
    buyFor: overrides.buyFor,
    categories: overrides.categories ?? createCategories(['Weapon']),
    conflictingItems: overrides.conflictingItems ?? [],
    properties: {
      ergonomics: overrides.ergonomics ?? 50,
      recoilVertical: overrides.recoilVertical ?? 100,
      recoilHorizontal: overrides.recoilHorizontal ?? 100,
      slots: overrides.slots ?? [],
      ...(overrides.properties ?? {}),
    },
  };
}

export function createTestMod(overrides = {}) {
  const id = overrides.id;

  return {
    id,
    name: overrides.name ?? id,
    shortName: overrides.shortName ?? id,
    weight: overrides.weight ?? 0.1,
    basePrice: overrides.basePrice ?? 1000,
    avg24hPrice: overrides.avg24hPrice ?? 1000,
    buyFor: overrides.buyFor,
    categories: overrides.categories ?? [],
    accuracyModifier: overrides.accuracyModifier ?? 0,
    recoilModifier: overrides.recoilModifier ?? 0,
    ergonomicsModifier: overrides.ergonomicsModifier ?? 0,
    conflictingItems: overrides.conflictingItemIds?.map(conflictId => ({ id: conflictId })) ?? overrides.conflictingItems ?? [],
    properties: {
      slots: overrides.slots ?? [],
      ...(overrides.properties ?? {}),
    },
  };
}

export function createModMap(...items) {
  return Object.fromEntries(items.map(item => [item.id, item]));
}

export function getInstalledItemIds(result) {
  return result.build.map(part => part.item.id);
}

export function hasInstalledCategory(result, categoryName) {
  return result.build.some(part => hasCategory(part.item, categoryName));
}

export function assertInstalled(result, itemId) {
  assert.equal(getInstalledItemIds(result).includes(itemId), true, `${itemId} should be installed`);
}

export function assertNotInstalled(result, itemId) {
  assert.equal(getInstalledItemIds(result).includes(itemId), false, `${itemId} should not be installed`);
}

export function assertNoDuplicatePartsForResult(result) {
  const ids = getInstalledItemIds(result);
  assert.equal(new Set(ids).size, ids.length, 'build must not install the same item twice');
}

export function assertNoInstalledConflictsForWeapon(baseWeapon, result) {
  const installedItems = [baseWeapon, ...result.build.map(part => part.item)];
  const installedIds = new Set(installedItems.map(item => item.id));

  for (const item of installedItems) {
    for (const conflict of item.conflictingItems || []) {
      assert.equal(
        installedIds.has(conflict.id),
        false,
        `${item.shortName} conflicts with another installed item ${conflict.id}`,
      );
    }
  }
}

export function assertStatsMatchPartsForWeapon(baseWeapon, result, options = {}) {
  const totalErgo = baseWeapon.properties.ergonomics
    + result.build.reduce((sum, part) => sum + (part.item.ergonomicsModifier || 0), 0);
  const totalRecoilMod = result.build.reduce((sum, part) => sum + (part.item.recoilModifier || 0), 0);
  const totalWeight = baseWeapon.weight + result.build.reduce((sum, part) => sum + (part.item.weight || 0), 0);
  const totalPrice = sumPurchasePrices(
    [baseWeapon, ...result.build.map(part => part.item)],
    { priceMode: options.priceMode, includeTraderPrices: true },
  ).value;

  assert.equal(result.stats.ergonomics, Math.min(100, Math.round(totalErgo)));
  assert.equal(result.stats.recoilVertical, Math.round(baseWeapon.properties.recoilVertical * (1 + totalRecoilMod / 100)));
  assert.equal(result.stats.recoilHorizontal, Math.round(baseWeapon.properties.recoilHorizontal * (1 + totalRecoilMod / 100)));
  assert.equal(result.stats.weight, totalWeight.toFixed(2));
  assert.equal(result.stats.price, totalPrice == null ? null : Math.round(totalPrice));
}

export const defaultOptions = {
  forbidSuppressor: false,
  requireSuppressor: false,
  maxWeight: 0,
};

