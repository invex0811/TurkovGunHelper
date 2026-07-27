import { useCallback, useMemo, useState } from 'react';
import {
  loadTraderLevels,
  resetTraderLevels,
  saveTraderLevels,
  setTraderLevel,
} from '../../data/settings/traderLevels.js';
import { TraderLevelsContext } from './TraderLevelsContext.js';

export default function TraderLevelsProvider({ children }) {
  const [traderLevels, setTraderLevelsState] = useState(loadTraderLevels);

  const updateTraderLevel = useCallback((traderId, level, priceMode, traders) => {
    setTraderLevelsState(current => {
      const next = setTraderLevel(traderId, level, priceMode, current, traders);
      saveTraderLevels(next);
      return next;
    });
  }, []);

  const resetProfile = useCallback((priceMode, traders) => {
    setTraderLevelsState(current => {
      const next = resetTraderLevels(priceMode, current, traders);
      saveTraderLevels(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({
    traderLevels,
    updateTraderLevel,
    resetTraderLevels: resetProfile,
  }), [resetProfile, traderLevels, updateTraderLevel]);

  return (
    <TraderLevelsContext.Provider value={value}>
      {children}
    </TraderLevelsContext.Provider>
  );
}

