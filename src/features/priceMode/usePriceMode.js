import { useContext } from 'react';
import { PriceModeContext } from './PriceModeContext.js';

export function usePriceMode() {
  const context = useContext(PriceModeContext);
  if (!context) throw new Error('usePriceMode must be used inside PriceModeProvider.');
  return context;
}
