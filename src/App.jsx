import { lazy, Suspense, useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Link, NavLink } from 'react-router-dom';
import Home from './pages/Home';
import I18nProvider from './i18n/I18nProvider.jsx';
import { useI18n } from './i18n/useI18n.js';
import PwaUpdatePrompt from './features/pwa/PwaUpdatePrompt.jsx';
import PriceModeProvider from './features/priceMode/PriceModeProvider.jsx';
import PriceModeSwitch from './features/priceMode/PriceModeSwitch.jsx';
import TraderLevelsProvider from './features/traderLevels/TraderLevelsProvider.jsx';
import CatalogStatusProvider from './features/dataStatus/CatalogStatusProvider.jsx';
import CatalogStatus from './features/dataStatus/CatalogStatus.jsx';
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

const NAV_ITEMS = [
  { to: '/', end: true, icon: 'my_location', labelKey: 'app.weapons' },
  { to: '/module-comparison', icon: 'view_column', labelKey: 'moduleComparison.nav', shortLabelKey: 'moduleComparison.navShort' },
  { to: '/builds', icon: 'layers', labelKey: 'app.builds' },
];

function navLinkClassName({ isActive }) {
  return `topnav__link${isActive ? ' is-active' : ''}`;
}

// Text tabs in the header; below 768px the same links become a bottom tab bar
// with icons, and settings joins them there.
function MainNav({ t }) {
  return (
    <nav className="topnav" aria-label={t('app.sections')}>
      {NAV_ITEMS.map(item => (
        <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClassName}>
          <MaterialSymbol name={item.icon} className="topnav__icon" />
          <span className="topnav__label">{t(item.labelKey)}</span>
          {item.shortLabelKey && (
            <span className="topnav__label topnav__label--short" aria-hidden="true">{t(item.shortLabelKey)}</span>
          )}
        </NavLink>
      ))}
      <NavLink to="/settings" className={args => `${navLinkClassName(args)} topnav__link--mobile-only`}>
        <MaterialSymbol name="settings" className="topnav__icon" />
        <span className="topnav__label">{t('settings.title')}</span>
      </NavLink>
    </nav>
  );
}

function SettingsLink({ t }) {
  return (
    <NavLink
      to="/settings"
      className={({ isActive }) => `icon-btn topbar__settings${isActive ? ' is-active' : ''}`}
      aria-label={t('settings.open')}
      title={t('settings.title')}
    >
      <MaterialSymbol name="settings" />
    </NavLink>
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
        <Link to="/" className="brand" aria-label={t('app.openWeapons')}>
          <img
            className="brand__mark"
            src={`${import.meta.env.BASE_URL}tgh-logo.png`}
            alt=""
            aria-hidden="true"
          />
          <span className="brand__name">Tarkov Gun Helper</span>
        </Link>
        <MainNav t={t} />
        <div className="topbar__actions">
          <CatalogStatus />
          <PriceModeSwitch />
          <SettingsLink t={t} />
        </div>
      </header>

      <main className="app__main">
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
          <CatalogStatusProvider>
            <Router><MainLayout /></Router>
          </CatalogStatusProvider>
        </TraderLevelsProvider>
      </PriceModeProvider>
    </I18nProvider>
  );
}

export default App;
