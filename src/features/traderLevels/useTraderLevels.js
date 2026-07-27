import { useContext } from 'react';
import { TraderLevelsContext } from './TraderLevelsContext.js';

export function useTraderLevels() {
  const context = useContext(TraderLevelsContext);
  if (!context) throw new Error('useTraderLevels must be used inside TraderLevelsProvider.');
  return context;
}

