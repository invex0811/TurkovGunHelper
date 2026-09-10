import test from 'node:test';
import assert from 'node:assert/strict';

import {
  migrateSharedMaxPriceSettings,
  normalizeBuildMaxPrice,
  resolveSharedMaxPrice,
} from '../../src/domain/buildMaxPrice.js';

test('maximum price normalization treats invalid and non-positive values as unlimited', () => {
  assert.equal(normalizeBuildMaxPrice(), 0);
  assert.equal(normalizeBuildMaxPrice(''), 0);
  assert.equal(normalizeBuildMaxPrice(-100), 0);
  assert.equal(normalizeBuildMaxPrice(Number.POSITIVE_INFINITY), 0);
  assert.equal(normalizeBuildMaxPrice('250000'), 250000);
});

test('legacy price limits migrate to the strictest positive value', () => {
  assert.equal(resolveSharedMaxPrice({
    customProfile: { price: 180_000 },
    maxPrice: 180_000,
    priorityMaxPrice: 250_000,
  }), 180_000);
  assert.equal(resolveSharedMaxPrice({
    customProfile: { price: 0 },
    priorityMaxPrice: 250_000,
  }), 250_000);
});

test('canonical shared price wins and legacy fields become compatibility mirrors', () => {
  const migrated = migrateSharedMaxPriceSettings({
    sharedMaxPrice: 0,
    maxPrice: 180_000,
    priorityMaxPrice: 250_000,
    customProfile: { ergonomics: 50, price: 180_000 },
  });

  assert.equal(migrated.sharedMaxPrice, 0);
  assert.equal(migrated.maxPrice, 0);
  assert.equal(migrated.customMaxPrice, 0);
  assert.equal(migrated.priorityMaxPrice, 0);
  assert.equal(migrated.customProfile.price, 0);
});
