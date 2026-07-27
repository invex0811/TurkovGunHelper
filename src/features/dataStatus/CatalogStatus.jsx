import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/useI18n.js';

const MINUTE_MS = 60_000;

function formatCatalogRelativeTime(timestamp, language, now) {
  const minutes = Math.max(0, Math.round((now - timestamp) / MINUTE_MS));
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  if (minutes < 60) return formatter.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return formatter.format(-hours, 'hour');
  return formatter.format(-Math.round(hours / 24), 'day');
}

export default function CatalogStatus({ status, isRefreshing, onRefresh }) {
  const { language, t } = useI18n();
  const [now, setNow] = useState(null);
  useEffect(() => {
    const timeout = setTimeout(() => setNow(Date.now()), 0);
    const interval = setInterval(() => setNow(Date.now()), MINUTE_MS);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);
  const updated = status?.fetchedAt && now
    ? formatCatalogRelativeTime(status.fetchedAt, language, now)
    : null;
  if (!status) return null;
  const warningKey = status.isOfflineFallback
    ? 'catalog.offline'
    : status.refreshFailed
      ? 'catalog.refreshFailed'
      : status.isStale ? 'catalog.stale' : 'catalog.fresh';

  return (
    <section className={`catalog-status${status.isStale || status.refreshFailed ? ' catalog-status--warning' : ''}`} role="status" aria-live="polite">
      <div>
        <strong>{t(warningKey)}</strong>
        {updated && <span title={new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(status.fetchedAt)}>{t('catalog.updated', { relative: updated })}</span>}
      </div>
      <button className="btn btn--ghost" type="button" onClick={onRefresh} disabled={isRefreshing} aria-label={t('catalog.refresh')}>
        {isRefreshing ? t('catalog.refreshing') : t('catalog.refresh')}
      </button>
    </section>
  );
}
