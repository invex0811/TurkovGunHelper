import { HashRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Home from './pages/Home';
import Configurator from './pages/Configurator';

function App() {
  return (
    <Router>
      <div className="container">
        <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }} className="glass-panel">
          <div style={{ padding: '1rem' }}>
            <h1 style={{ color: 'var(--color-accent-gold)', margin: 0 }}>Tarkov Gun Helper</h1>
            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>Optimal Weapon Builds</p>
          </div>
          <nav style={{ padding: '0 2rem' }}>
            <Link to="/" className="btn" style={{ textDecoration: 'none', padding: '0.5rem 1.5rem', borderRadius: 'var(--radius-full)', fontWeight: 'bold' }}>Weapons</Link>
          </nav>
        </header>

        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/configure/:weaponId" element={<Configurator />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
