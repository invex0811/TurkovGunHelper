import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getBuildGameMode,
  getLocalizedBuildWeapon,
} from '../../src/pages/buildsLocalizedWeapons.js';

const regularBuild = {
  weapon: { id: 'm4a1', name: 'M4A1 assault rifle', shortName: 'M4A1' },
  settings: { priceMode: 'pvp' },
};

test('saved builds use the catalog for their game mode when resolving localized weapon names', () => {
  const localizedWeapon = { id: 'm4a1', name: 'Штурмовая винтовка Colt M4A1', shortName: 'M4A1' };
  const catalogsByMode = new Map([
    ['regular', { itemsById: { m4a1: localizedWeapon } }],
  ]);

  assert.equal(getBuildGameMode(regularBuild), 'regular');
  assert.equal(getLocalizedBuildWeapon(regularBuild, catalogsByMode), localizedWeapon);
});

test('localized weapon resolution preserves the saved snapshot as a safe fallback', () => {
  const pveBuild = { ...regularBuild, settings: { priceMode: 'pve' } };

  assert.equal(getBuildGameMode(pveBuild), 'pve');
  assert.equal(getLocalizedBuildWeapon(pveBuild, new Map()), pveBuild.weapon);
  assert.equal(getLocalizedBuildWeapon(regularBuild, null), regularBuild.weapon);
});
