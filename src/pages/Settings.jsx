import { useEffect, useMemo, useState } from 'react';
import { loadItemsCatalog } from '../data/tarkovApi/repository.js';
import { getTarkovDevGameMode } from '../data/price/priceProvider.js';
import { getCatalogTraders } from '../data/tarkovApi/traders.js';
import {
  loadIncludeTraderPricesPreference,
  saveIncludeTraderPricesPreference,
} from '../data/settings/buildPreferences.js';
import InstallAppButton from '../features/pwa/InstallAppButton.jsx';
import { usePriceMode } from '../features/priceMode/usePriceMode.js';
import { useTraderLevels } from '../features/traderLevels/useTraderLevels.js';
import { useI18n } from '../i18n/useI18n.js';

export default function Settings({ theme, setTheme }) {
  const { language, setLanguage, t } = useI18n();
  const { priceMode } = usePriceMode();
  const { traderLevels, updateTraderLevel, resetTraderLevels } = useTraderLevels();
  const [includeTraderPrices, setIncludeTraderPrices] = useState(
    loadIncludeTraderPricesPreference,
  );
  const [traders, setTraders] = useState([]);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    const controller = new AbortController();
    loadItemsCatalog(getTarkovDevGameMode(priceMode), {
      language,
      priceMode,
      signal: controller.signal,
    }).then(catalog => {
      const catalogTraders = getCatalogTraders(catalog);
      setTraders(catalogTraders);
      setStatus(catalogTraders.length > 0 ? 'ready' : 'empty');
    }).catch(error => {
      if (error?.code !== 'ABORTED') setStatus('error');
    });
    return () => controller.abort();
  }, [language, priceMode]);

  const currentProfile = useMemo(
    () => traderLevels.profiles?.[priceMode] || {},
    [priceMode, traderLevels],
  );

  const handleIncludeChange = event => {
    const next = event.target.checked;
    setIncludeTraderPrices(next);
    saveIncludeTraderPricesPreference(next);
  };

  const handleReset = () => {
    if (!window.confirm(t('traders.resetConfirm'))) return;
    resetTraderLevels(priceMode, traders);
  };

  return (
    <div className="settings-page page-shell">
      <header className="settings-page__header">
        <p className="eyebrow">{t('settings.open')}</p>
        <h2>{t('settings.title')}</h2>
      </header>

      <section className="settings-card" aria-labelledby="interface-settings-title">
        <h3 id="interface-settings-title">{t('settings.interface')}</h3>
        <div className="settings-row">
          <span>{t('settings.language')}</span>
          <div className="settings-segmented" role="group" aria-label={t('settings.language')}>
            {['en', 'ru'].map(value => (
              <button
                key={value}
                type="button"
                aria-pressed={language === value}
                onClick={() => setLanguage(value)}
              >
                {t(`language.${value}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span>{t('settings.theme')}</span>
          <div className="settings-segmented" role="group" aria-label={t('settings.theme')}>
            {['light', 'dark'].map(value => (
              <button
                key={value}
                type="button"
                aria-pressed={theme === value}
                onClick={() => setTheme(value)}
              >
                {t(`settings.${value}`)}
              </button>
            ))}
          </div>
        </div>
        <InstallAppButton />
      </section>

      <section className="settings-card" aria-labelledby="trader-settings-title">
        <div className="settings-card__heading">
          <div>
            <h3 id="trader-settings-title">{t('settings.traders')}</h3>
            <p>{t('traders.description')}</p>
          </div>
          <strong className="price-mode-badge">
            {t(priceMode === 'pve' ? 'traders.profilePve' : 'traders.profilePvp')}
          </strong>
        </div>

        <label className="check settings-trader-toggle">
          <input
            type="checkbox"
            checked={includeTraderPrices}
            onChange={handleIncludeChange}
          />
          <span>
            <strong>{t('traders.include')}</strong>
            <small>{t('traders.includeDescription')}</small>
          </span>
        </label>

        {status === 'loading' && <p role="status">{t('traders.loading')}</p>}
        {status === 'error' && <p role="alert">{t('traders.loadError')}</p>}
        {status === 'empty' && <p>{t('traders.empty')}</p>}
        {status === 'ready' && (
          <div className="trader-level-list">
            {traders.map(trader => {
              const currentLevel = currentProfile[trader.id] || 1;
              return (
                <label className="trader-level-row" key={trader.id}>
                  <span>{trader.name}</span>
                  <select
                    aria-label={`${trader.name}: ${t('traders.level')}`}
                    value={currentLevel}
                    onChange={event => updateTraderLevel(
                      trader.id,
                      Number(event.target.value),
                      priceMode,
                      traders,
                    )}
                  >
                    {Array.from({ length: trader.maxLevel }, (_, index) => index + 1)
                      .map(level => <option key={level} value={level}>LL{level}</option>)}
                  </select>
                </label>
              );
            })}
          </div>
        )}

        <p className="field-help">{t('traders.separateProfiles')}</p>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={status !== 'ready'}
          onClick={handleReset}
        >
          {t('traders.reset')}
        </button>
      </section>
    </div>
  );
}
