import { HashRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Configurator from './pages/Configurator';

function MainLayout() {
  const location = useLocation();

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
          <Route path="/configure/:weaponId" element={<Configurator />} />
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
