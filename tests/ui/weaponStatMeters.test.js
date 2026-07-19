import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WEAPON_STAT_UI_RANGES,
  normalizeStatPercent,
  toFiniteStatNumber,
  withBaseStatMaximum,
} from '../../src/ui/weaponStatMeters.js';

test('normalizes the minimum to an empty meter', () => {
  assert.equal(normalizeStatPercent(40, 40, 700), 0);
});

test('normalizes the maximum to a full meter', () => {
  assert.equal(normalizeStatPercent(700, 40, 700), 100);
});

test('normalizes the midpoint to half of the meter', () => {
  assert.equal(normalizeStatPercent(370, 40, 700), 50);
});

test('clamps values below and above the visualization range', () => {
  assert.equal(normalizeStatPercent(-10, 0, 100), 0);
  assert.equal(normalizeStatPercent(110, 0, 100), 100);
});

test('returns an empty meter for invalid stat values', () => {
  assert.equal(normalizeStatPercent('N/A', 0, 100), 0);
  assert.equal(normalizeStatPercent(null, 0, 100), 0);
  assert.equal(normalizeStatPercent(undefined, 0, 100), 0);
  assert.equal(normalizeStatPercent(Number.NaN, 0, 100), 0);
});

test('returns an empty meter when the range has no span', () => {
  assert.equal(normalizeStatPercent(50, 50, 50), 0);
});

test('converts calculator weight strings into meter values', () => {
  const weight = toFiniteStatNumber('2.93');

  assert.equal(weight, 2.93);
  assert.ok(Math.abs(normalizeStatPercent(weight, 0, 15) - 19.53333333333333) < 1e-10);
  assert.ok(Number.isNaN(toFiniteStatNumber('N/A')));
});

test('uses the unmodified weapon recoil as the meter maximum', () => {
  const range = withBaseStatMaximum(WEAPON_STAT_UI_RANGES.verticalRecoil, 119);

  assert.equal(range.min, 0);
  assert.equal(range.max, 119);
  assert.equal(normalizeStatPercent(119, range.min, range.max), 100);
  assert.equal(normalizeStatPercent(59.5, range.min, range.max), 50);
});

test('keeps the fallback maximum when base recoil is unavailable', () => {
  assert.equal(
    withBaseStatMaximum(WEAPON_STAT_UI_RANGES.horizontalRecoil, 'N/A'),
    WEAPON_STAT_UI_RANGES.horizontalRecoil,
  );
});

test('uses explicit stable visualization ranges for every weapon stat', () => {
  assert.deepEqual(WEAPON_STAT_UI_RANGES.weight, {
    min: 0,
    max: 15,
    direction: 'lower-is-better',
  });
  assert.deepEqual(WEAPON_STAT_UI_RANGES.ergonomics, {
    min: 0,
    max: 100,
    direction: 'higher-is-better',
  });
  assert.deepEqual(WEAPON_STAT_UI_RANGES.verticalRecoil, {
    min: 0,
    max: 350,
    direction: 'lower-is-better',
  });
  assert.deepEqual(WEAPON_STAT_UI_RANGES.horizontalRecoil, {
    min: 0,
    max: 600,
    direction: 'lower-is-better',
  });
  assert.deepEqual(WEAPON_STAT_UI_RANGES.price, {
    min: 0,
    max: 2_000_000,
    direction: 'lower-is-better',
  });
});
