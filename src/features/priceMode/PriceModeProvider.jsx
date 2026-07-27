import { useCallback, useMemo, useState } from 'react';
import {
  loadPriceModePreference,
  savePriceModePreference,
} from '../../data/settings/buildPreferences.js';
import { getEffectivePriceMode } from '../../data/price/priceProvider.js';
import { PriceModeContext } from './PriceModeContext.js';

export default function PriceModeProvider({ children }) {
  const [priceMode, setPriceModeState] = useState(loadPriceModePreference);
  const setPriceMode = useCallback((nextPriceMode) => {
    const normalizedPriceMode = getEffectivePriceMode(nextPriceMode);
    setPriceModeState(normalizedPriceMode);
    savePriceModePreference(normalizedPriceMode);
  }, []);
  const value = useMemo(() => ({ priceMode, setPriceMode }), [priceMode, setPriceMode]);
  return <PriceModeContext.Provider value={value}>{children}</PriceModeContext.Provider>;
}
