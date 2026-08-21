import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { useI18n } from '../../i18n/useI18n.js';

export default function PwaUpdatePrompt() {
  const { t } = useI18n();
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const updateServiceWorker = useRef(null);
  useEffect(() => {
    updateServiceWorker.current = registerSW({
      immediate: true,
      onNeedRefresh: () => setNeedsRefresh(true),
    });
  }, []);
  if (!needsRefresh) return null;
  return (
    <aside className="pwa-update" role="status" aria-live="polite">
      <svg className="pwa-update__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 11a8 8 0 1 0 2.2 5.5" />
        <path d="M20 4v7h-7" />
      </svg>
      <div className="pwa-update__content">
        <strong>{t('pwa.updateAvailable')}</strong>
        <p>{t('pwa.updateDescription')}</p>
        <button className="btn btn--primary" type="button" onClick={() => updateServiceWorker.current?.(true)}>{t('pwa.update')}</button>
      </div>
    </aside>
  );
}
