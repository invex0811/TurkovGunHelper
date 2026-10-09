import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FAVORITE_WEAPONS_STORAGE_KEY,
  loadFavoriteWeaponIds,
  saveFavoriteWeaponIds,
  toggleFavoriteWeaponId,
} from '../../data/settings/favoriteWeapons.js';
import { FavoriteWeaponsContext } from './FavoriteWeaponsContext.js';

export default function FavoriteWeaponsProvider({ children }) {
  const [favoriteWeaponIds, setFavoriteWeaponIds] = useState(() => loadFavoriteWeaponIds());

  // A star set in another tab shows up here too.
  useEffect(() => {
    const handleStorage = event => {
      if (event.key === FAVORITE_WEAPONS_STORAGE_KEY || event.key === null) {
        setFavoriteWeaponIds(loadFavoriteWeaponIds());
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const toggleFavoriteWeapon = useCallback(weaponId => {
    setFavoriteWeaponIds(current => {
      const next = toggleFavoriteWeaponId(current, weaponId);
      saveFavoriteWeaponIds(next);
      return next;
    });
  }, []);

  const value = useMemo(() => {
    const favoriteIdSet = new Set(favoriteWeaponIds);
    return {
      favoriteWeaponIds: favoriteIdSet,
      isFavoriteWeapon: weaponId => favoriteIdSet.has(weaponId),
      toggleFavoriteWeapon,
    };
  }, [favoriteWeaponIds, toggleFavoriteWeapon]);

  return (
    <FavoriteWeaponsContext.Provider value={value}>
      {children}
    </FavoriteWeaponsContext.Provider>
  );
}
