import assert from 'node:assert/strict';
import test from 'node:test';

import { formatWeaponFireModes } from '../../src/domain/fireModes.js';

test('formats weapon fire modes in API order', () => {
  assert.equal(formatWeaponFireModes({
    properties: {
      propertiesType: 'ItemPropertiesWeapon',
      fireModes: ['Single fire', 'Full auto.', 'Burst'],
    },
  }), 'Single fire · Full auto · Burst');
});

test('returns an empty string for missing, invalid, and non-weapon fire modes', () => {
  for (const weapon of [
    {},
    { properties: null },
    { properties: { propertiesType: 'ItemPropertiesWeapon' } },
    { properties: { propertiesType: 'ItemPropertiesWeapon', fireModes: null } },
    { properties: { propertiesType: 'ItemPropertiesWeapon', fireModes: [] } },
    { properties: { propertiesType: 'ItemPropertiesWeapon', fireModes: [' ', null] } },
    { properties: { propertiesType: 'ItemPropertiesMagazine', fireModes: ['Single fire'] } },
  ]) {
    assert.equal(formatWeaponFireModes(weapon), '');
  }
});
