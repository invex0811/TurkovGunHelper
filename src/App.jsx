import { lazy, Suspense } from 'react';
import { HashRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Home from './pages/Home';

const Configurator = lazy(() => import('./pages/Configurator'));

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
        <div className="brand">
          <div className="brand__mark">TGH</div>
          <div>
            <h1>Tarkov Gun Helper</h1>
            <p>Optimal Weapon Builds</p>
          </div>
        </div>
        <div className="topbar__actions">
          <Link to="/" className="btn btn--ghost">Weapons</Link>
        </div>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<Home />} />
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
