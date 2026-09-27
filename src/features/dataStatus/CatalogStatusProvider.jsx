import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCatalogStatus, getWeapons, subscribeToCatalogStatus } from '../../data/tarkovApi';
import { useI18n } from '../../i18n/useI18n.js';
import { CatalogStatusContext } from './CatalogStatusContext.js';

// Shares the latest catalog status with the header and lets any page react to
// a manual price refresh started there.
export default function CatalogStatusProvider({ children }) {
  const { language } = useI18n();
  const [lastStatus, setLastStatus] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);

  useEffect(() => subscribeToCatalogStatus(setLastStatus), []);

  const status = lastStatus?.cacheKey.includes(`:${language}:`)
    ? lastStatus
    : getCatalogStatus('regular', { language, priceMode: 'pvp' });

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await getWeapons({ forceRefresh: true, language });
      setRefreshVersion(version => version + 1);
    } catch {
      // The repository publishes a refreshFailed status, which the header shows.
    } finally {
      setIsRefreshing(false);
    }
  }, [language]);

  const value = useMemo(
    () => ({ status, isRefreshing, refresh, refreshVersion }),
    [isRefreshing, refresh, refreshVersion, status],
  );
  return <CatalogStatusContext.Provider value={value}>{children}</CatalogStatusContext.Provider>;
}
