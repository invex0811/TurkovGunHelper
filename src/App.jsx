import { lazy, Suspense, useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, NavLink, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import I18nProvider from './i18n/I18nProvider.jsx';
import { useI18n } from './i18n/useI18n.js';
import PwaUpdatePrompt from './features/pwa/PwaUpdatePrompt.jsx';
import PriceModeProvider from './features/priceMode/PriceModeProvider.jsx';
import PriceModeSwitch from './features/priceMode/PriceModeSwitch.jsx';
import TraderLevelsProvider from './features/traderLevels/TraderLevelsProvider.jsx';
import FavoriteWeaponsProvider from './features/favorites/FavoriteWeaponsProvider.jsx';
import CatalogStatusProvider from './features/dataStatus/CatalogStatusProvider.jsx';
import CatalogStatus from './features/dataStatus/CatalogStatus.jsx';
import { usePageviewTracking } from './features/analytics/usePageviewTracking.js';
import { MaterialSymbol } from './ui/MaterialSymbol.js';
import { LegacyConfigureRoute, WeaponRoute } from './features/routing/WeaponRoutes.jsx';
import { applyPageMeta } from './features/seo/documentMeta.js';
import { getStaticRouteMeta } from './features/seo/pageMeta.js';

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

// Section links end with a slash: the static pages are <section>/index.html,
// so that is the address the server and the canonical URL use.
const NAV_ITEMS = [
  // The configurator belongs to the weapons section.
  { to: '/', end: true, icon: 'my_location', labelKey: 'app.weapons', activePrefixes: ['/weapon/', '/configure/'] },
  { to: '/module-comparison/', icon: 'view_column', labelKey: 'moduleComparison.nav', shortLabelKey: 'moduleComparison.navShort' },
  { to: '/builds/', icon: 'layers', labelKey: 'app.builds' },
];

const SETTINGS_NAV_ITEM = { to: '/settings/' };

function navLinkClassName({ isActive }) {
  return `topnav__link${isActive ? ' is-active' : ''}`;
}

function withTrailingSlash(pathname) {
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

// NavLink alone would not mark /builds/ active at /builds (a link opened
// without the slash), so the match ignores the trailing slash.
function isNavItemActive(pathname, item) {
  const current = withTrailingSlash(pathname);
  if (item.activePrefixes?.some(prefix => current.startsWith(prefix))) return true;
  return item.end ? current === item.to : current.startsWith(item.to);
}

// Weapon pages set their own meta once the weapon is known.
function useStaticRouteMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    const meta = getStaticRouteMeta(pathname);
    if (meta) applyPageMeta(meta);
  }, [pathname]);
}

// Text tabs in the header; below 768px the same links become a bottom tab bar
// with icons, and settings joins them there.
function MainNav({ t }) {
  const { pathname } = useLocation();
  return (
    <nav className="topnav" aria-label={t('app.sections')}>
      {NAV_ITEMS.map(item => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={() => navLinkClassName({ isActive: isNavItemActive(pathname, item) })}
        >
          <MaterialSymbol name={item.icon} className="topnav__icon" />
          <span className="topnav__label">{t(item.labelKey)}</span>
          {item.shortLabelKey && (
            <span className="topnav__label topnav__label--short" aria-hidden="true">{t(item.shortLabelKey)}</span>
          )}
        </NavLink>
      ))}
      <NavLink
        to="/settings/"
        className={() => `${navLinkClassName({ isActive: isNavItemActive(pathname, SETTINGS_NAV_ITEM) })} topnav__link--mobile-only`}
      >
        <MaterialSymbol name="settings" className="topnav__icon" />
        <span className="topnav__label">{t('settings.title')}</span>
      </NavLink>
    </nav>
  );
}

function SettingsLink({ t }) {
  const { pathname } = useLocation();
  return (
    <NavLink
      to="/settings/"
      className={() => `icon-btn topbar__settings${isNavItemActive(pathname, SETTINGS_NAV_ITEM) ? ' is-active' : ''}`}
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
  usePageviewTracking();
  useStaticRouteMeta();

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
            path="/weapon/:slug"
            element={(
              <WeaponRoute fallback={<ConfiguratorLoading />}>
                {weaponId => (
                  <Suspense fallback={<ConfiguratorLoading />}>
                    <Configurator weaponId={weaponId} />
                  </Suspense>
                )}
              </WeaponRoute>
            )}
          />
          <Route
            path="/configure/:weaponId"
            element={(
              <LegacyConfigureRoute fallback={<ConfiguratorLoading />}>
                {weaponId => (
                  <Suspense fallback={<ConfiguratorLoading />}>
                    <Configurator weaponId={weaponId} />
                  </Suspense>
                )}
              </LegacyConfigureRoute>
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
          <FavoriteWeaponsProvider>
            <CatalogStatusProvider>
              <Router><MainLayout /></Router>
            </CatalogStatusProvider>
          </FavoriteWeaponsProvider>
        </TraderLevelsProvider>
      </PriceModeProvider>
    </I18nProvider>
  );
}

export default App;
