import { useContext } from 'react';
import { CatalogStatusContext } from './CatalogStatusContext.js';

export function useCatalogStatus() {
  const context = useContext(CatalogStatusContext);
  if (!context) throw new Error('useCatalogStatus must be used inside CatalogStatusProvider.');
  return context;
}
