import { useContext } from 'react';
import { FavoriteWeaponsContext } from './FavoriteWeaponsContext.js';

export function useFavoriteWeapons() {
  const context = useContext(FavoriteWeaponsContext);
  if (!context) throw new Error('useFavoriteWeapons must be used inside FavoriteWeaponsProvider.');
  return context;
}
