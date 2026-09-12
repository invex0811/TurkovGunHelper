import {
  BUILD_GOAL_MODES,
  isSupportedBuildGoalMode,
} from '../../data/settings/buildPreferences.js';

export { BUILD_GOAL_MODES };

export function getBuildGoalMode(targetType, characteristicMode) {
  if (targetType !== 'custom') return BUILD_GOAL_MODES.META;
  return characteristicMode === BUILD_GOAL_MODES.PRIORITIES
    ? BUILD_GOAL_MODES.PRIORITIES
    : BUILD_GOAL_MODES.CONSTRAINTS;
}

export function getBuildGoalModeFromSettings(settings = {}) {
  if (isSupportedBuildGoalMode(settings.buildGoalMode)) {
    return settings.buildGoalMode;
  }

  return getBuildGoalMode(settings.targetType, settings.characteristicMode);
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
