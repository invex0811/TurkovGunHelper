export function getSlotPlanErrorMessage(error, t) {
  if (error === 'The selected slot no longer exists in the current build.') return t('ui.slot.errorSlotUnavailable');
  if (error === 'A required module cannot be removed without a replacement.') return t('ui.slot.requiredReplace');
  if (error === 'The selected module is incompatible with this slot instance.') return t('ui.slot.errorIncompatible');
  if (error === 'This module is already installed in the build.') return t('ui.slot.errorDuplicate');
  if (error === 'After this change, one or more modules will lose their compatible parent slot.') return t('ui.slot.errorUnattached');

  const conflictMatch = /^(.+) conflicts with (.+)\.$/.exec(error);
  if (conflictMatch) return t('ui.slot.errorConflict', { first: conflictMatch[1], second: conflictMatch[2] });

  return t('ui.slot.errorGeneric');
}
