import { useEffect, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { useI18n } from '../../i18n/useI18n.js';
import { MaterialSymbol } from '../../ui/MaterialSymbol.js';

// The service worker activates updates itself (skipWaiting + clientsClaim in
// vite.config.js), so there is no waiting worker to confirm. When a new worker
// takes over a page that was already controlled, the page still runs the old
// version: the prompt offers a reload. The first install controls the page
// without a prompt.
export default function PwaUpdatePrompt() {
  const { t } = useI18n();
  const [needsRefresh, setNeedsRefresh] = useState(false);
  useEffect(() => {
    registerSW({
      immediate: true,
      onNeedRefresh: () => setNeedsRefresh(true),
    });
    const container = navigator.serviceWorker;
    if (!container) return undefined;
    let hadController = Boolean(container.controller);
    const handleControllerChange = () => {
      if (hadController) setNeedsRefresh(true);
      hadController = true;
    };
    container.addEventListener('controllerchange', handleControllerChange);
    return () => container.removeEventListener('controllerchange', handleControllerChange);
  }, []);
  if (!needsRefresh) return null;
  return (
    <aside className="pwa-update" role="status" aria-live="polite">
      <MaterialSymbol name="refresh" className="pwa-update__icon" />
      <div className="pwa-update__content">
        <strong>{t('pwa.updateAvailable')}</strong>
        <p>{t('pwa.updateDescription')}</p>
        <button className="btn btn--primary" type="button" onClick={() => window.location.reload()}>{t('pwa.update')}</button>
      </div>
    </aside>
  );
}
