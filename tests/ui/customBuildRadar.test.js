import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CUSTOM_BUILD_DEFAULT_PROFILE,
  CUSTOM_RADAR_DEAD_ZONE,
  createCustomBuildProfileFromSettings,
  getCustomBuildRadarAxes,
  getRadarAxisVectors,
  getRadarPoint,
  normalizeCustomBuildProfile,
  projectPointerToAxis,
  requirementToValue,
  valueToRequirement,
} from '../../src/ui/customBuildRadar.js';

const weapon = {
  properties: {
    recoilVertical: 120,
    recoilHorizontal: 360,
  },
};

function getAxis(key) {
  return getCustomBuildRadarAxes(weapon).find(axis => axis.key === key);
}

test('creates five clockwise axes starting at the top', () => {
  const axes = getRadarAxisVectors();

  assert.equal(axes.length, 5);
  assert.ok(Math.abs(axes[0].x) < 1e-10);
  assert.ok(Math.abs(axes[0].y + 1) < 1e-10);
  assert.ok(axes[1].x > 0 && axes[1].y < 0);
  assert.ok(axes[2].x > 0 && axes[2].y > 0);
  assert.ok(axes[3].x < 0 && axes[3].y > 0);
  assert.ok(axes[4].x < 0 && axes[4].y < 0);
});

test('projects the pointer only onto its selected axis and clamps the result', () => {
  assert.equal(projectPointerToAxis({
    pointerX: 150,
    pointerY: 70,
    centerX: 100,
    centerY: 100,
    axisX: 1,
    axisY: 0,
    radius: 100,
  }), 0.5);
  assert.equal(projectPointerToAxis({
    pointerX: 250,
    pointerY: 100,
    centerX: 100,
    centerY: 100,
    axisX: 1,
    axisY: 0,
    radius: 100,
  }), 1);
  assert.equal(projectPointerToAxis({
    pointerX: 0,
    pointerY: 100,
    centerX: 100,
    centerY: 100,
    axisX: 1,
    axisY: 0,
    radius: 100,
  }), 0);
});

test('uses direct ergonomics and inverse recoil mappings', () => {
  assert.equal(requirementToValue(0.75, getAxis('ergonomics')), 75);
  assert.equal(requirementToValue(0.75, getAxis('verticalRecoil')), 30);
  assert.equal(requirementToValue(0.75, getAxis('horizontalRecoil')), 90);
  assert.equal(valueToRequirement(75, getAxis('ergonomics')), 0.75);
  assert.equal(valueToRequirement(30, getAxis('verticalRecoil')), 0.75);
});

test('weight and price use a no-limit dead zone and snap to practical steps', () => {
  const weightAxis = getAxis('weight');
  const priceAxis = getAxis('price');

  assert.equal(requirementToValue(CUSTOM_RADAR_DEAD_ZONE, weightAxis), 0);
  assert.equal(requirementToValue(CUSTOM_RADAR_DEAD_ZONE, priceAxis), 0);
  assert.equal(Number((requirementToValue(0.5, weightAxis) / 0.05).toFixed(8)) % 1, 0);
  assert.equal(requirementToValue(0.5, priceAxis) % 1_000, 0);
  assert.ok(requirementToValue(0.8, weightAxis) < requirementToValue(0.5, weightAxis));
  assert.ok(requirementToValue(0.8, priceAxis) < requirementToValue(0.5, priceAxis));
  assert.equal(requirementToValue(1, weightAxis), 0.05);
  assert.equal(requirementToValue(1, priceAxis), 1_000);
});

test('recoil axes use the same dynamic maxima as weapon stat meters', () => {
  assert.equal(getAxis('verticalRecoil').range.max, 120);
  assert.equal(getAxis('horizontalRecoil').range.max, 360);
});

test('legacy saved settings migrate to all five custom values', () => {
  assert.deepEqual(createCustomBuildProfileFromSettings({
    customErgo: 64,
    customRecoil: 88,
    maxWeight: 4.2,
    maxPrice: 70_000,
  }, weapon), {
    weight: 4.2,
    verticalRecoil: 88,
    horizontalRecoil: 88,
    price: 70_000,
    ergonomics: 64,
  });
});

test('invalid profiles and zero-size geometry return safe finite defaults', () => {
  assert.deepEqual(normalizeCustomBuildProfile({
    weight: Number.NaN,
    ergonomics: 'bad',
    verticalRecoil: Infinity,
  }, weapon), CUSTOM_BUILD_DEFAULT_PROFILE);
  assert.equal(projectPointerToAxis({
    pointerX: 1,
    pointerY: 1,
    centerX: 0,
    centerY: 0,
    axisX: 1,
    axisY: 0,
    radius: 0,
  }), 0);
  assert.deepEqual(getRadarPoint(10, 10, 0, { x: Number.NaN, y: 1 }), { x: 10, y: 10 });
});
