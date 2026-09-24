import { lazy, Suspense, useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Home from './pages/Home';
import I18nProvider from './i18n/I18nProvider.jsx';
import { useI18n } from './i18n/useI18n.js';
import PwaUpdatePrompt from './features/pwa/PwaUpdatePrompt.jsx';
import PriceModeProvider from './features/priceMode/PriceModeProvider.jsx';
import PriceModeSwitch from './features/priceMode/PriceModeSwitch.jsx';
import TraderLevelsProvider from './features/traderLevels/TraderLevelsProvider.jsx';
import { MaterialSymbol } from './ui/MaterialSymbol.js';

const Configurator = lazy(() => import('./pages/Configurator'));
const Builds = lazy(() => import('./pages/Builds'));
const Settings = lazy(() => import('./pages/Settings'));
const ModuleComparison = lazy(() => import('./pages/ModuleComparison'));

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

function SettingsLink({ t }) {
  return (
    <Link to="/settings" className="btn btn--ghost settings-trigger" aria-label={t('settings.open')}>
        <MaterialSymbol name="settings" className="settings-trigger__icon" />
        <span className="settings-trigger__text">{t('settings.title')}</span>
    </Link>
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
  const { t } = useI18n();
  const [theme, setTheme] = useTheme();

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__primary">
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
          <PriceModeSwitch />
        </div>
        <div className="topbar__actions">
          <Link to="/" className="btn btn--ghost">{t('app.weapons')}</Link>
          <Link to="/module-comparison" className="btn btn--ghost">{t('moduleComparison.nav')}</Link>
          <Link to="/builds" className="btn btn--ghost">{t('app.builds')}</Link>
          <SettingsLink t={t} />
        </div>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/settings"
            element={(
              <Suspense fallback={<ConfiguratorLoading />}>
                <Settings theme={theme} setTheme={setTheme} />
              </Suspense>
            )}
          />
          <Route
            path="/builds"
            element={(
              <Suspense fallback={<ConfiguratorLoading />}>
                <Builds />
              </Suspense>
            )}
          />
          <Route
            path="/module-comparison"
            element={(
              <Suspense fallback={<ConfiguratorLoading />}>
                <ModuleComparison />
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
      <PwaUpdatePrompt />
    </div>
  );
}

function App() {
  return (
    <I18nProvider>
      <PriceModeProvider>
        <TraderLevelsProvider>
          <Router><MainLayout /></Router>
        </TraderLevelsProvider>
      </PriceModeProvider>
    </I18nProvider>
  );
}

export default App;
