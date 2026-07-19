import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CUSTOM_BUILD_DEFAULT_PROFILE,
  createCustomBuildProfileFromSettings,
  getCustomBuildRadarAxes,
  getRadarAxisVectors,
  getRadarPoint,
  normalizeCustomBuildProfile,
  projectPointerToAxis,
  requirementToValue,
  updateCustomBuildProfileValue,
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

test('uses a direct zero-to-maximum mapping for every axis', () => {
  assert.equal(requirementToValue(0.75, getAxis('ergonomics')), 75);
  assert.equal(requirementToValue(0.75, getAxis('verticalRecoil')), 90);
  assert.equal(requirementToValue(0.75, getAxis('horizontalRecoil')), 270);
  assert.equal(valueToRequirement(75, getAxis('ergonomics')), 0.75);
  assert.equal(valueToRequirement(90, getAxis('verticalRecoil')), 0.75);
  assert.equal(valueToRequirement(270, getAxis('horizontalRecoil')), 0.75);
});

test('weight and price start at zero and snap to practical steps', () => {
  const weightAxis = getAxis('weight');
  const priceAxis = getAxis('price');

  assert.equal(requirementToValue(0, weightAxis), 0);
  assert.equal(requirementToValue(0, priceAxis), 0);
  assert.equal(Number((requirementToValue(0.5, weightAxis) / 0.05).toFixed(8)) % 1, 0);
  assert.equal(requirementToValue(0.5, priceAxis) % 1_000, 0);
  assert.ok(requirementToValue(0.8, weightAxis) > requirementToValue(0.5, weightAxis));
  assert.ok(requirementToValue(0.8, priceAxis) > requirementToValue(0.5, priceAxis));
  assert.equal(requirementToValue(1, weightAxis), 15);
  assert.equal(requirementToValue(1, priceAxis), 2_000_000);
});

test('manual values snap and clamp to the same axis limits as the radar', () => {
  const profile = { ...CUSTOM_BUILD_DEFAULT_PROFILE };

  assert.equal(updateCustomBuildProfileValue(profile, 'weight', 4.037, weapon).weight, 4.05);
  assert.equal(updateCustomBuildProfileValue(profile, 'price', 1_750_400, weapon).price, 1_750_000);
  assert.equal(updateCustomBuildProfileValue(profile, 'price', 3_000_000, weapon).price, 2_000_000);
  assert.equal(updateCustomBuildProfileValue(profile, 'ergonomics', -10, weapon).ergonomics, 0);
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
