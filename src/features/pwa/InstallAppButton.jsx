import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/useI18n.js';

function isStandalone() {
  return globalThis.matchMedia?.('(display-mode: standalone)').matches
    || globalThis.navigator?.standalone === true;
}

export default function InstallAppButton() {
  const { t } = useI18n();
  const [installPrompt, setInstallPrompt] = useState(null);
  useEffect(() => {
    const handlePrompt = event => {
      event.preventDefault();
      if (!isStandalone()) setInstallPrompt(event);
    };
    const handleInstalled = () => setInstallPrompt(null);
    globalThis.addEventListener('beforeinstallprompt', handlePrompt);
    globalThis.addEventListener('appinstalled', handleInstalled);
    return () => {
      globalThis.removeEventListener('beforeinstallprompt', handlePrompt);
      globalThis.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);
  if (!installPrompt || isStandalone()) return null;
  return (
    <button type="button" className="settings-option" onClick={async () => {
      await installPrompt.prompt();
      setInstallPrompt(null);
    }}>
      {t('pwa.install')}
    </button>
  );
}
