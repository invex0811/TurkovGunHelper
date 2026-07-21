import test from 'node:test';
import assert from 'node:assert/strict';

import { getSlotOptionComparison } from '../../src/ui/weaponBuildSlotStats.js';

function createItem(overrides = {}) {
  return {
    ergonomicsModifier: 0,
    recoilModifier: 0,
    weight: 0,
    price: { value: 1000 },
    ...overrides,
  };
}

test('slot replacement colors improvements and regressions like Replace', () => {
  const comparison = getSlotOptionComparison({
    item: createItem({
      ergonomicsModifier: -1,
      recoilModifier: 2,
      weight: 0.087,
      price: { value: 7590 },
    }),
    currentItem: createItem({
      ergonomicsModifier: 0.5,
      recoilModifier: 0,
      weight: 0.1,
      price: { value: 7770 },
    }),
    weapon: { properties: { recoilVertical: 100, recoilHorizontal: 350 } },
  });

  assert.deepEqual(comparison.stats, [
    { key: 'ergonomics', label: 'Ergo', text: '-1.5', tone: 'negative' },
    { key: 'recoil', label: 'Recoil', text: '+2 / +7 (+2%)', tone: 'negative' },
    { key: 'weight', label: 'Weight', text: '-0.013 kg', tone: 'positive' },
  ]);
  assert.equal(comparison.priceDiffText, '-180 ₽');
  assert.equal(comparison.priceTone, 'positive');
});

test('current module comparison is neutral', () => {
  const item = createItem({
    ergonomicsModifier: 3,
    recoilModifier: -4,
    weight: 0.2,
    price: { value: 5000 },
  });
  const comparison = getSlotOptionComparison({ item, currentItem: item, weapon: null });

  assert.deepEqual(comparison.stats.map(stat => stat.tone), ['neutral', 'neutral', 'neutral']);
  assert.deepEqual(comparison.stats.map(stat => stat.text), ['0', '0 (0%)', '0 kg']);
  assert.equal(comparison.priceDiffText, '0 ₽');
  assert.equal(comparison.priceTone, 'neutral');
});
