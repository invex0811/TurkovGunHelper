import { isAbortError, loadWeaponSlugIndex } from '../../data/tarkovApi/index.js';
import { getLegacyConfigurePath, getWeaponPath } from '../../domain/weaponSlugs.js';

// The weapon page of a weapon known only by id (a saved or shared build).
// Without the catalog it falls back to /configure/<id>, which redirects once
// the slug is known.
export async function resolveWeaponPath(weaponId, options = {}) {
  try {
    const slug = (await loadWeaponSlugIndex(options)).slugById.get(weaponId);
    if (slug) return getWeaponPath(slug);
  } catch (error) {
    if (isAbortError(error)) throw error;
  }
  return getLegacyConfigurePath(weaponId);
}
