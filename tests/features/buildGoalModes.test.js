import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUILD_GOAL_MODES,
  getBuildGoalMode,
  getBuildGoalModeFromSettings,
  getCalculatorGoalState,
} from '../../src/features/configurator/buildGoalModes.js';

test('maps the three build-goal UI modes to the existing calculator contract', () => {
  assert.deepEqual(getCalculatorGoalState(BUILD_GOAL_MODES.META), {
    targetType: 'meta',
    characteristicMode: null,
  });
  assert.deepEqual(getCalculatorGoalState(BUILD_GOAL_MODES.CONSTRAINTS), {
    targetType: 'custom',
    characteristicMode: 'constraints',
  });
  assert.deepEqual(getCalculatorGoalState(BUILD_GOAL_MODES.PRIORITIES), {
    targetType: 'custom',
    characteristicMode: 'priorities',
  });
});

test('restores legacy targetType and characteristicMode pairs as top-level UI modes', () => {
  assert.equal(getBuildGoalMode('meta', 'priorities'), BUILD_GOAL_MODES.META);
  assert.equal(getBuildGoalMode('custom', 'constraints'), BUILD_GOAL_MODES.CONSTRAINTS);
  assert.equal(getBuildGoalMode('custom', 'priorities'), BUILD_GOAL_MODES.PRIORITIES);
  assert.equal(getBuildGoalMode('custom', 'invalid'), BUILD_GOAL_MODES.CONSTRAINTS);
});

test('restores saved build modes with the new field taking priority over legacy fields', () => {
  assert.equal(getBuildGoalModeFromSettings({
    targetType: 'meta',
  }), BUILD_GOAL_MODES.META);
  assert.equal(getBuildGoalModeFromSettings({
    targetType: 'custom',
    characteristicMode: 'constraints',
  }), BUILD_GOAL_MODES.CONSTRAINTS);
  assert.equal(getBuildGoalModeFromSettings({
    targetType: 'custom',
    characteristicMode: 'priorities',
  }), BUILD_GOAL_MODES.PRIORITIES);
  assert.equal(getBuildGoalModeFromSettings({
    buildGoalMode: 'meta',
    targetType: 'custom',
    characteristicMode: 'priorities',
  }), BUILD_GOAL_MODES.META);
});
