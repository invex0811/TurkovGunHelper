export const SCOPE_MODES = Object.freeze({
  NONE: 'none',
  AUTO: 'auto',
  MANUAL: 'manual',
});

export const SCOPE_NONE_OPTION_ID = '__scope_none__';

function normalizeZoom(zoom) {
  const numericZoom = Number(zoom);
  return Number.isFinite(numericZoom) && numericZoom > 0 ? numericZoom : null;
}

export function normalizeScopeSelection(settings = {}, isSelectableScopeId = () => false) {
  const requestedMode = settings.scopeMode;
  const manualItemId = settings.scopeItemId;
  const hasManualScope = Boolean(manualItemId && isSelectableScopeId(manualItemId));
  const legacySightMode = settings.sightMode;
  const legacyZoom = normalizeZoom(legacySightMode);
  const mode = Object.values(SCOPE_MODES).includes(requestedMode)
    ? requestedMode
    : hasManualScope
      ? SCOPE_MODES.MANUAL
      : legacySightMode === 'none' || settings.requireSight === false
        ? SCOPE_MODES.NONE
        : SCOPE_MODES.AUTO;

  return {
    mode,
    itemId: mode === SCOPE_MODES.MANUAL && hasManualScope ? manualItemId : null,
    zoom: mode === SCOPE_MODES.NONE ? null : normalizeZoom(settings.scopeZoom) || legacyZoom,
  };
}

export function getScopeSightMode(scopeMode, scopeZoom) {
  if (scopeMode === SCOPE_MODES.NONE) return 'none';
  return scopeMode === SCOPE_MODES.AUTO ? normalizeZoom(scopeZoom) || 'any' : 'any';
}
