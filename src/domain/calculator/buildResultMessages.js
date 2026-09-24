export const BUILD_WARNING_CODES = Object.freeze({
  BASE_WEAPON_MAX_WEIGHT: 'BASE_WEAPON_MAX_WEIGHT',
  BUILD_MAX_PRICE_EXCEEDED: 'BUILD_MAX_PRICE_EXCEEDED',
  PRICE_ITEMS_UNAVAILABLE: 'PRICE_ITEMS_UNAVAILABLE',
});

function normalizeWarning(warning) {
  if (!warning || typeof warning !== 'object') return null;
  const code = typeof warning.code === 'string' ? warning.code.trim() : '';
  const fallback = typeof warning.fallback === 'string' ? warning.fallback.trim() : '';
  if (!code && !fallback) return null;

  return {
    code,
    params: warning.params && typeof warning.params === 'object' ? warning.params : {},
    fallback,
  };
}

export function setBuildWarnings(result, warnings) {
  const normalized = (warnings || []).map(normalizeWarning).filter(Boolean);
  if (normalized.length === 0) return result;

  result.warnings = normalized;
  result.warningCode = normalized[0].code || undefined;
  result.warningParams = normalized[0].params;
  result.warning = normalized.map(entry => entry.fallback).filter(Boolean).join(' ');
  return result;
}

export function appendBuildWarning(result, warning) {
  const existing = Array.isArray(result.warnings)
    ? result.warnings
    : result.warning
      ? [{
          code: result.warningCode || '',
          params: result.warningParams || {},
          fallback: result.warning,
        }]
      : [];

  return setBuildWarnings(result, [...existing, warning]);
}
