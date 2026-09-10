import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BUILD_GOAL_MODES,
  getBuildGoalMode,
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
