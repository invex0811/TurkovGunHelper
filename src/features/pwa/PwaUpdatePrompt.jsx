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
      <span>{t('pwa.updateAvailable')}</span>
      <button className="btn btn--primary" type="button" onClick={() => updateServiceWorker.current?.(true)}>{t('pwa.update')}</button>
    </aside>
  );
}
