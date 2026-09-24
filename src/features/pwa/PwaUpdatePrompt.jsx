import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { useI18n } from '../../i18n/useI18n.js';
import { MaterialSymbol } from '../../ui/MaterialSymbol.js';

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
      <MaterialSymbol name="refresh" className="pwa-update__icon" />
      <div className="pwa-update__content">
        <strong>{t('pwa.updateAvailable')}</strong>
        <p>{t('pwa.updateDescription')}</p>
        <button className="btn btn--primary" type="button" onClick={() => updateServiceWorker.current?.(true)}>{t('pwa.update')}</button>
      </div>
    </aside>
  );
}
