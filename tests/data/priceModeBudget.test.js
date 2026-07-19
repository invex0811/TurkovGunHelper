import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { sumPurchasePrices } from '../../src/data/price/priceMapper.js';
import { PRICE_MODES } from '../../src/data/price/priceModes.js';
import { calculateBestBuild } from '../../src/domain/calculator.js';

const priceModeFixtures = JSON.parse(fs.readFileSync(new URL('../fixtures/priceModes.json', import.meta.url), 'utf8'));
const { budgetScenarios } = priceModeFixtures;

const defaultOptions = {
  forbidSuppressor: false,
  requireSuppressor: false,
  maxWeight: 0,
  maxPrice: 1_000_000,
};

function createSlot(name, allowedItemIds) {
  return {
    name,
    nameId: name.toLowerCase().replace(/\s+/g, '_'),
    filters: {
      allowedItems: allowedItemIds.map(id => ({ id })),
    },
  };
}

function createWeapon(scenario) {
  return {
    id: `${scenario.priceMode}-budget-weapon`,
    name: `${scenario.priceMode} Budget Weapon`,
    shortName: `${scenario.priceMode.toUpperCase()}BW`,
    weight: 1,
    avg24hPrice: 0,
    basePrice: 0,
    price: {
      value: 1_000,
      mode: scenario.priceMode,
    },
    categories: [{ name: 'Weapon' }],
    conflictingItems: [],
    properties: {
      ergonomics: 50,
      recoilVertical: 100,
      recoilHorizontal: 100,
      slots: scenario.slotGroups.map((allowedItemIds, index) => createSlot(`Test Slot ${index + 1}`, allowedItemIds)),
    },
  };
}

function createMod(fixture) {
  return {
    id: fixture.id,
    name: fixture.shortName,
    shortName: fixture.shortName,
    weight: 0.1,
    avg24hPrice: fixture.rawPrice,
    lastLowPrice: fixture.lastLowPrice,
    low24hPrice: fixture.low24hPrice,
    basePrice: fixture.basePrice ?? fixture.rawPrice,
    categories: [{ name: 'Test Mod' }],
    accuracyModifier: 0,
    recoilModifier: -1,
    ergonomicsModifier: 0,
    conflictingItems: [],
    properties: { slots: [] },
    price: {
      currency: 'RUB',
      source: 'tarkov.dev',
      updatedAt: '2026-06-01T10:00:00.000Z',
      ...fixture.price,
    },
  };
}

function createModMap(mods) {
  return Object.fromEntries(mods.map(mod => [mod.id, mod]));
}

function getInstalledItemIds(result) {
  return result.build.map(part => part.item.id);
}

function assertInstalled(result, itemId) {
  assert.equal(getInstalledItemIds(result).includes(itemId), true, `${itemId} should be installed`);
}

function assertNotInstalled(result, itemId) {
  assert.equal(getInstalledItemIds(result).includes(itemId), false, `${itemId} should not be installed`);
}

function assertStatsPriceMatchesParts(weapon, result, priceMode) {
  const expectedPrice = sumPurchasePrices(
    [weapon, ...result.build.map(part => part.item)],
    { priceMode, includeTraderPrices: true },
  ).value;

  assert.equal(result.stats.price, expectedPrice == null ? null : Math.round(expectedPrice));
}

function calculateBudgetScenario(scenario) {
  const weapon = createWeapon(scenario);
  const mods = scenario.mods.map(createMod);

  const result = calculateBestBuild(
    weapon,
    'meta',
    70,
    50,
    createModMap(mods),
    {
      ...defaultOptions,
      priceMode: scenario.priceMode,
    },
  );

  return { weapon, result };
}

test('price-constrained Meta uses PvP normalized prices for selected price mode', () => {
  const scenario = budgetScenarios.pvp;
  const { weapon, result } = calculateBudgetScenario(scenario);

  assert.equal(scenario.priceMode, PRICE_MODES.PVP);
  assert.equal(result.error, undefined);
  assertInstalled(result, scenario.expectedItemId);
  assertStatsPriceMatchesParts(weapon, result, scenario.priceMode);
});

test('price-constrained Meta uses PvE normalized prices for selected price mode', () => {
  const scenario = budgetScenarios.pve;
  const { weapon, result } = calculateBudgetScenario(scenario);

  assert.equal(scenario.priceMode, PRICE_MODES.PVE);
  assert.equal(result.error, undefined);
  assertInstalled(result, scenario.expectedItemId);
  assertStatsPriceMatchesParts(weapon, result, scenario.priceMode);
});

test('price-constrained Meta ignores normalized price from a different price mode', () => {
  const scenario = budgetScenarios.wrongMode;
  const { weapon, result } = calculateBudgetScenario(scenario);

  assert.equal(result.error, undefined);
  assertInstalled(result, scenario.expectedItemId);
  assertNotInstalled(result, scenario.rejectedItemId);
  assertStatsPriceMatchesParts(weapon, result, scenario.priceMode);
});

test('missing selected price safely falls back in price-constrained Meta', () => {
  const scenario = budgetScenarios.missingPrice;
  const { weapon, result } = calculateBudgetScenario(scenario);

  assert.equal(result.error, undefined);
  assertInstalled(result, scenario.expectedItemId);
  assertStatsPriceMatchesParts(weapon, result, scenario.priceMode);
});

test('mixed high-confidence fallback and missing prices remain valid calculator input', () => {
  const scenario = budgetScenarios.mixedSource;
  const { weapon, result } = calculateBudgetScenario(scenario);

  assert.equal(result.error, undefined);

  assertInstalled(result, scenario.expectedItemIds[0]);
  assertInstalled(result, scenario.expectedItemIds[1]);
  assertNotInstalled(result, scenario.expectedItemIds[2]);

  assertStatsPriceMatchesParts(weapon, result, scenario.priceMode);
});
