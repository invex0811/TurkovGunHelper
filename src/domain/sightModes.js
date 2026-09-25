import { hasItemCategory } from './itemCategories.js';
import { scopeSupportsZoom } from './scopeZoom.js';

// Whether a sight fits the build's sight mode (any, reflex, scope or a zoom).
// Iron sights and thermal or night vision optics never qualify.
export function isValidSightForMode(item, sightMode) {
  if (hasItemCategory(item, 'Ironsight')) return false;
  if (
    hasItemCategory(item, 'Thermal Vision')
    || hasItemCategory(item, 'Night Vision')
    || hasItemCategory(item, 'Special scope')
  ) {
    return false;
  }

  const mode = sightMode || 'any';
  if (mode === 'none') return false;
  if (mode === 'any') return true;

  const isReflex = hasItemCategory(item, 'Reflex sight')
    || hasItemCategory(item, 'Compact reflex sight');
  const isMagnified = hasItemCategory(item, 'Scope')
    || hasItemCategory(item, 'Assault scope');

  if (mode === 'reflex') return isReflex;
  if (mode === 'scope') return isMagnified;

  const parsedMode = Number(mode);
  if (!Number.isNaN(parsedMode)) {
    return scopeSupportsZoom(item, parsedMode);
  }
  return true;
}
