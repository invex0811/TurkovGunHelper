import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/useI18n.js';
import { useCatalogStatus } from './useCatalogStatus.js';

const MINUTE_MS = 60_000;

function formatCatalogRelativeTime(timestamp, language, now) {
  const minutes = Math.max(0, Math.round((now - timestamp) / MINUTE_MS));
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto', style: 'short' });
  if (minutes < 60) return formatter.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return formatter.format(-hours, 'hour');
  return formatter.format(-Math.round(hours / 24), 'day');
}

function getStatusKey(status) {
  if (status.isOfflineFallback) return 'offline';
  if (status.refreshFailed) return 'refreshFailed';
  return status.isStale ? 'stale' : 'fresh';
}

// Header price status: a colored dot and the age of the prices. A click
// downloads fresh prices from Tarkov.dev.
export default function CatalogStatus() {
  const { language, t } = useI18n();
  const { status, isRefreshing, refresh } = useCatalogStatus();
  const [now, setNow] = useState(null);
  useEffect(() => {
    const timeout = setTimeout(() => setNow(Date.now()), 0);
    const interval = setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);
  if (!status) return null;

  const statusKey = getStatusKey(status);
  const updated = status.fetchedAt && now
    ? formatCatalogRelativeTime(status.fetchedAt, language, now)
    : null;
  const label = isRefreshing
    ? t('catalog.refreshing')
    : statusKey === 'fresh'
      ? (updated ? t('catalog.pricesUpdated', { relative: updated }) : t('catalog.fresh'))
      : t(`catalog.header.${statusKey}`);
  const details = [
    t(statusKey === 'fresh' ? 'catalog.fresh' : `catalog.${statusKey}`),
    status.fetchedAt
      ? t('catalog.updated', {
        relative: new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(status.fetchedAt),
      })
      : null,
  ].filter(Boolean).join(' · ');

  return (
    <span className="topbar-status-wrap" aria-live="polite">
      <button
        className={`topbar-status topbar-status--${statusKey}`}
        type="button"
        onClick={refresh}
        disabled={isRefreshing}
        title={`${details}. ${t('catalog.refreshHint')}`}
        aria-label={`${label}. ${t('catalog.refresh')}`}
      >
        <span className={`topbar-status__dot${isRefreshing ? ' is-refreshing' : ''}`} aria-hidden="true" />
        <span className="topbar-status__text">{label}</span>
      </button>
    </span>
  );
}
