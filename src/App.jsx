import { lazy, Suspense, useState, useEffect } from 'react';
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
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
            aria-label="Toggle theme"
          >
            {theme === 'light' ? '☀️ Светлая' : '🌙 Тёмная'}
          </button>
          <label className="language-switcher">
            <span className="visually-hidden">{t('language.label')}</span>
            <select value={language} onChange={event => setLanguage(event.target.value)} aria-label={t('language.label')}>
              <option value="en">{t('language.en')}</option>
              <option value="ru">{t('language.ru')}</option>
            </select>
          </label>
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
