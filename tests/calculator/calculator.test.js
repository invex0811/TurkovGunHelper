import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { calculateBestBuild } from '../../src/domain/calculator.js';

const modsFixture = JSON.parse(fs.readFileSync(new URL('../fixtures/mods.json', import.meta.url), 'utf8'));
const weaponFixture = JSON.parse(fs.readFileSync(new URL('../fixtures/weapon.json', import.meta.url), 'utf8'));

const mods = modsFixture.data.items;
const weapon = weaponFixture.data.item;
const modMap = Object.fromEntries(mods.map(mod => [mod.id, mod]));

function hasCategory(item, categoryName) {
  return item.categories?.some(category => category.name === categoryName) || false;
}

function assertNoDuplicateParts(result) {
  const ids = result.build.map(part => part.item.id);
  assert.equal(new Set(ids).size, ids.length, 'build must not install the same item twice');
}

function assertNoInstalledConflicts(result) {
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

function assertStatsMatchParts(result) {
  const totalErgo = weapon.properties.ergonomics
    + result.build.reduce((sum, part) => sum + (part.item.ergonomicsModifier || 0), 0);
  const totalRecoilMod = result.build.reduce((sum, part) => sum + (part.item.recoilModifier || 0), 0);
  const totalWeight = weapon.weight + result.build.reduce((sum, part) => sum + (part.item.weight || 0), 0);
  const totalPrice = (weapon.avg24hPrice || weapon.basePrice || 0)
    + result.build.reduce((sum, part) => sum + (part.item.avg24hPrice || part.item.basePrice || 0), 0);

  assert.equal(result.stats.ergonomics, Math.min(100, Math.round(totalErgo)));
  assert.equal(result.stats.recoilVertical, Math.round(weapon.properties.recoilVertical * (1 + totalRecoilMod / 100)));
  assert.equal(result.stats.recoilHorizontal, Math.round(weapon.properties.recoilHorizontal * (1 + totalRecoilMod / 100)));
  assert.equal(result.stats.weight, totalWeight.toFixed(2));
  assert.equal(result.stats.price, Math.round(totalPrice));
}

for (const targetType of ['meta', 'max_ergo', 'min_recoil', 'budget', 'custom']) {
  test(`${targetType} build has valid unique parts and consistent stats`, () => {
    const result = calculateBestBuild(weapon, targetType, 70, 50, modMap, {
      forbidSuppressor: false,
      requireSuppressor: false,
      maxWeight: 0,
    });

    assert.ok(result.build.length > 0, `${targetType} should return at least one part`);
    assertNoDuplicateParts(result);
    assertNoInstalledConflicts(result);
    assertStatsMatchParts(result);
  });
}

test('forbidSuppressor excludes silencer parts', () => {
  const result = calculateBestBuild(weapon, 'meta', 70, 50, modMap, {
    forbidSuppressor: true,
    requireSuppressor: false,
    maxWeight: 0,
  });

  assert.equal(result.build.some(part => hasCategory(part.item, 'Silencer')), false);
  assertNoDuplicateParts(result);
  assertStatsMatchParts(result);
});

test('requireSuppressor installs a compatible silencer', () => {
  const result = calculateBestBuild(weapon, 'meta', 70, 50, modMap, {
    forbidSuppressor: false,
    requireSuppressor: true,
    maxWeight: 0,
  });

  assert.equal(result.build.some(part => hasCategory(part.item, 'Silencer')), true);
  assertNoDuplicateParts(result);
  assertStatsMatchParts(result);
});

test('maxWeight is enforced as a hard limit when physically possible', () => {
  const maxWeight = 2;
  const result = calculateBestBuild(weapon, 'meta', 70, 50, modMap, {
    forbidSuppressor: false,
    requireSuppressor: false,
    maxWeight,
  });

  assert.ok(Number(result.stats.weight) <= maxWeight, `weight ${result.stats.weight} exceeds ${maxWeight}`);
  assertNoDuplicateParts(result);
  assertStatsMatchParts(result);
});
