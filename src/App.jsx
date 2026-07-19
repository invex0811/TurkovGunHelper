import { lazy, Suspense } from 'react';
import { HashRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Home from './pages/Home';

const Configurator = lazy(() => import('./pages/Configurator'));
const Builds = lazy(() => import('./pages/Builds'));

function ConfiguratorLoading() {
  return (
    <div id="loader-wrapper">
      <div className="loader">
        <div className="loader-ring"></div>
        <div className="loader-ring"></div>
        <div className="loader-ring"></div>
        <p className="loader-text">Loading configurator...</p>
      </div>
    </div>
  );
}

function MainLayout() {
  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Open weapon list">
          <img
            className="brand__mark"
            src={`${import.meta.env.BASE_URL}tgh-logo.png`}
            alt=""
            aria-hidden="true"
          />
          <div>
            <h1>Tarkov Gun Helper</h1>
            <p>Optimal Weapon Builds</p>
          </div>
        </Link>
        <div className="topbar__actions">
          <Link to="/" className="btn btn--ghost">Weapons</Link>
          <Link to="/builds" className="btn btn--ghost">Builds</Link>
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
    <Router>
      <MainLayout />
    </Router>
  );
}

export default App;
