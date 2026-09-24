import { useCallback, useMemo, useState } from 'react';
import {
  loadIncludeRefOffersPreference,
  loadStrictTraderLevelsPreference,
  saveIncludeRefOffersPreference,
  saveStrictTraderLevelsPreference,
} from '../../data/settings/buildPreferences.js';
import {
  initializeTraderLevels,
  loadTraderLevels,
  resetTraderLevels,
  saveTraderLevels,
  setTraderLevel,
} from '../../data/settings/traderLevels.js';
import { TraderLevelsContext } from './TraderLevelsContext.js';

export default function TraderLevelsProvider({ children }) {
  const [traderLevels, setTraderLevelsState] = useState(loadTraderLevels);
  const [strictTraderLevels, setStrictTraderLevelsState] = useState(
    loadStrictTraderLevelsPreference,
  );

  const setStrictTraderLevels = useCallback(nextValue => {
    const normalizedValue = nextValue === true;
    setStrictTraderLevelsState(normalizedValue);
    saveStrictTraderLevelsPreference(normalizedValue);
  }, []);
  const [includeRefOffers, setIncludeRefOffersState] = useState(
    loadIncludeRefOffersPreference,
  );

  const setIncludeRefOffers = useCallback(nextValue => {
    const normalizedValue = nextValue !== false;
    setIncludeRefOffersState(normalizedValue);
    saveIncludeRefOffersPreference(normalizedValue);
  }, []);

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

  const initializeProfile = useCallback((priceMode, traders) => {
    setTraderLevelsState(current => {
      const next = initializeTraderLevels(priceMode, current, traders);
      saveTraderLevels(next);
      return next;
    });
  }, []);

  const value = useMemo(() => ({
    traderLevels,
    strictTraderLevels,
    setStrictTraderLevels,
    includeRefOffers,
    setIncludeRefOffers,
    initializeTraderLevels: initializeProfile,
    updateTraderLevel,
    resetTraderLevels: resetProfile,
  }), [
    includeRefOffers,
    initializeProfile,
    resetProfile,
    setIncludeRefOffers,
    setStrictTraderLevels,
    strictTraderLevels,
    traderLevels,
    updateTraderLevel,
  ]);

  return (
    <TraderLevelsContext.Provider value={value}>
      {children}
    </TraderLevelsContext.Provider>
  );
}
