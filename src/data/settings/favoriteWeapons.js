export const FAVORITE_WEAPONS_STORAGE_KEY = 'tarkovGunHelper.favoriteWeapons';

function getDefaultStorage() {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

// Weapon ids, unique and in the order they were added. Anything else stored
// under the key (an old or hand-edited value) is dropped.
export function normalizeFavoriteWeaponIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(id => typeof id === 'string' && id.trim()))];
}

export function loadFavoriteWeaponIds(storage = getDefaultStorage()) {
  if (!storage) return [];

  try {
    return normalizeFavoriteWeaponIds(JSON.parse(storage.getItem(FAVORITE_WEAPONS_STORAGE_KEY)));
  } catch {
    return [];
  }
}

export function saveFavoriteWeaponIds(weaponIds, storage = getDefaultStorage()) {
  if (!storage) return;

  try {
    storage.setItem(FAVORITE_WEAPONS_STORAGE_KEY, JSON.stringify(normalizeFavoriteWeaponIds(weaponIds)));
  } catch {
    // Ignore storage errors: the favorite still applies until the page reloads.
  }
}

export function toggleFavoriteWeaponId(weaponIds, weaponId) {
  const current = normalizeFavoriteWeaponIds(weaponIds);
  if (typeof weaponId !== 'string' || !weaponId) return current;
  return current.includes(weaponId)
    ? current.filter(id => id !== weaponId)
    : [...current, weaponId];
}
