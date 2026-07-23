import { lazy, Suspense, useState, useEffect, useRef } from 'react';
import { HashRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Home from './pages/Home';
import I18nProvider from './i18n/I18nProvider.jsx';
import { useI18n } from './i18n/useI18n.js';

const Configurator = lazy(() => import('./pages/Configurator'));
const Builds = lazy(() => import('./pages/Builds'));

function useTheme() {
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('tarkov-gun-helper-theme') || 'dark';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('tarkov-gun-helper-theme', theme);
  }, [theme]);

  return [theme, setTheme];
}

function SettingsMenu({ theme, setTheme, language, setLanguage, t }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = event => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    const handlePointerDown = event => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isOpen]);

  return (
    <div className="settings-menu-container" ref={containerRef}>
      <button
        type="button"
        className="btn btn--ghost settings-trigger"
        onClick={() => setIsOpen(prev => !prev)}
        aria-label={t('settings.title')}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <svg
          className="settings-trigger__icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span className="settings-trigger__text">{t('settings.title')}</span>
      </button>

      {isOpen && (
        <div className="settings-dropdown" role="dialog" aria-label={t('settings.title')}>
          <section className="settings-dropdown__section">
            <span className="settings-dropdown__title">{t('settings.language')}</span>
            <div className="settings-dropdown__options">
              <button
                type="button"
                className={`settings-option${language === 'en' ? ' is-active' : ''}`}
                onClick={() => setLanguage('en')}
              >
                {t('language.en')}
              </button>
              <button
                type="button"
                className={`settings-option${language === 'ru' ? ' is-active' : ''}`}
                onClick={() => setLanguage('ru')}
              >
                {t('language.ru')}
              </button>
            </div>
          </section>

          <section className="settings-dropdown__section">
            <span className="settings-dropdown__title">{t('settings.theme')}</span>
            <div className="settings-dropdown__options">
              <button
                type="button"
                className={`settings-option${theme === 'light' ? ' is-active' : ''}`}
                onClick={() => setTheme('light')}
              >
                ☀️ {t('settings.light')}
              </button>
              <button
                type="button"
                className={`settings-option${theme === 'dark' ? ' is-active' : ''}`}
                onClick={() => setTheme('dark')}
              >
                🌙 {t('settings.dark')}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function ConfiguratorLoading() {
  const { t } = useI18n();
  return (
    <div id="loader-wrapper">
      <div className="loader">
        <div className="loader-ring"></div>
        <div className="loader-ring"></div>
        <div className="loader-ring"></div>
        <p className="loader-text">{t('app.loadingConfigurator')}</p>
      </div>
    </div>
  );
}

function MainLayout() {
  const { language, setLanguage, t } = useI18n();
  const [theme, setTheme] = useTheme();

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand" aria-label={t('app.openWeapons')}>
          <img
            className="brand__mark"
            src={`${import.meta.env.BASE_URL}tgh-logo.png`}
            alt=""
            aria-hidden="true"
          />
          <div>
            <h1>Tarkov Gun Helper</h1>
            <p>{t('app.tagline')}</p>
          </div>
        </Link>
        <div className="topbar__actions">
          <Link to="/" className="btn btn--ghost">{t('app.weapons')}</Link>
          <Link to="/builds" className="btn btn--ghost">{t('app.builds')}</Link>
          <SettingsMenu
            theme={theme}
            setTheme={setTheme}
            language={language}
            setLanguage={setLanguage}
            t={t}
          />
        </div>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/builds"
            element={(
              <Suspense fallback={<ConfiguratorLoading />}>
                <Builds />
              </Suspense>
            )}
          />
          <Route
            path="/configure/:weaponId"
            element={(
              <Suspense fallback={<ConfiguratorLoading />}>
                <Configurator />
              </Suspense>
            )}
          />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <I18nProvider><Router><MainLayout /></Router></I18nProvider>
  );
}

export default App;
