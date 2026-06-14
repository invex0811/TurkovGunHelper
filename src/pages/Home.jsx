import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getWeapons } from '../data/tarkovApi';

function Home() {
  const [weapons, setWeapons] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState('All');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getWeapons().then(data => {
      setWeapons(data);
      setLoading(false);
    }).catch(err => {
      console.error(err);
      setLoading(false);
    });
  }, []);

  const weaponTypes = Array.from(new Set(
    weapons.flatMap(w => w.categories?.map(c => c.name) || [])
           .filter(c => c !== 'Weapon' && c !== 'Item')
  )).sort();

  const filteredWeapons = weapons.filter(w => {
    const matchesSearch = w.name.toLowerCase().includes(search.toLowerCase()) || w.shortName.toLowerCase().includes(search.toLowerCase());
    const matchesType = selectedType === 'All' || w.categories?.some(c => c.name === selectedType);
    return matchesSearch && matchesType;
  });

  return (
    <div className="glass-panel" style={{ padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h2>Select Weapon</h2>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div style={{ position: 'relative' }}>
            <select 
              value={selectedType} 
              onChange={e => setSelectedType(e.target.value)}
              style={{
                padding: '0.75rem 2rem 0.75rem 1rem',
                backgroundColor: 'rgba(0,0,0,0.5)',
                border: '1px solid var(--color-border)',
                color: 'var(--color-text)',
                borderRadius: 'var(--radius-sm)',
                appearance: 'none',
                cursor: 'pointer',
                outline: 'none',
                minWidth: '150px'
              }}
            >
              <option value="All">All Types</option>
              {weaponTypes.map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <span style={{ position: 'absolute', right: '0.8rem', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>▼</span>
          </div>
          <input 
            type="text" 
            className="input-field" 
            placeholder="Search weapons..." 
            style={{ width: '300px' }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '3rem 0' }}>Loading weapons from Tarkov.dev...</p>
      ) : (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', 
          gap: '1rem' 
        }}>
          {filteredWeapons.map(w => (
            <Link to={`/configure/${w.id}`} key={w.id} style={{ textDecoration: 'none' }}>
              <div className="glass-panel" style={{ 
                padding: '1rem', 
                textAlign: 'center', 
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}>
                <div>
                  <img 
                    src={w.properties?.defaultPreset?.image512pxLink || w.image512pxLink || 'https://via.placeholder.com/512'} 
                    alt={w.shortName} 
                    style={{ maxWidth: '100%', maxHeight: '100px', objectFit: 'contain' }}
                  />
                  <h3 style={{ fontSize: '1.2rem', margin: '1rem 0 0.5rem 0', color: 'var(--color-accent-gold)' }}>{w.shortName}</h3>
                </div>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{w.name}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
      <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
        <span style={{ 
          display: 'inline-flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          width: '18px', 
          height: '18px', 
          borderRadius: '50%', 
          border: '1px solid var(--color-text-muted)', 
          fontSize: '0.75rem', 
          fontWeight: 'bold',
          fontFamily: 'monospace'
        }}>i</span>
        <span>All data is sourced from <a href="https://tarkov.dev" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent-gold)', textDecoration: 'none', borderBottom: '1px dotted var(--color-accent-gold)' }}>tarkov.dev</a></span>
      </div>
    </div>
  );
}

export default Home;
