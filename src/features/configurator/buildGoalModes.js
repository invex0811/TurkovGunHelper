export const BUILD_GOAL_MODES = Object.freeze({
  META: 'meta',
  CONSTRAINTS: 'constraints',
  PRIORITIES: 'priorities',
});

export function getBuildGoalMode(targetType, characteristicMode) {
  if (targetType !== 'custom') return BUILD_GOAL_MODES.META;
  return characteristicMode === BUILD_GOAL_MODES.PRIORITIES
    ? BUILD_GOAL_MODES.PRIORITIES
    : BUILD_GOAL_MODES.CONSTRAINTS;
}

export function getCalculatorGoalState(buildGoalMode) {
  if (buildGoalMode === BUILD_GOAL_MODES.CONSTRAINTS) {
    return { targetType: 'custom', characteristicMode: 'constraints' };
  }

  if (buildGoalMode === BUILD_GOAL_MODES.PRIORITIES) {
    return { targetType: 'custom', characteristicMode: 'priorities' };
  }

  return { targetType: 'meta', characteristicMode: null };
}
