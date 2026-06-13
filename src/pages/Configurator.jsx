import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getWeaponDetails, getAllMods } from '../services/api';
import { calculateBestBuild } from '../utils/calculator';

function formatPartName(name) {
  if (!name) return '';
  return name.replace(/(\d+(?:\.\d+)?)\s*(?:"|inch(?:es)?)/ig, (match, p1) => {
    return Math.round(parseFloat(p1) * 25.4) + ' mm';
  });
}

function Configurator() {
  const { weaponId } = useParams();
  const [weapon, setWeapon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [targetType, setTargetType] = useState('meta'); // meta, max_ergo, min_recoil, custom
  const [customErgo, setCustomErgo] = useState(50);
  const [customRecoil, setCustomRecoil] = useState(50);
  const [requireSuppressor, setRequireSuppressor] = useState(false);
  const [maxWeight, setMaxWeight] = useState('');
  const [showAdditionalOptions, setShowAdditionalOptions] = useState(false);
  const [buildResult, setBuildResult] = useState(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getWeaponDetails(weaponId).then(data => {
      if (cancelled) return;
      setWeapon(data);
      setLoading(false);
    }).catch(err => {
      if (cancelled) return;
      console.error(err);
      setWeapon(null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [weaponId]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const modMap = await getAllMods();
      const options = {
        forbidSuppressor: !requireSuppressor,
        requireSuppressor: requireSuppressor,
        maxWeight: parseFloat(maxWeight) || 0
      };
      const result = calculateBestBuild(weapon, targetType, customErgo, customRecoil, modMap, options);
      setBuildResult(result);
      console.log(`=== GENERATED BUILD (${weapon.shortName} - ${targetType}) ===`);
      console.log(JSON.stringify({
        stats: result.stats,
        parts: result.build.map(p => ({ slot: p.slotName, name: p.item.shortName, id: p.item.id }))
      }, null, 2));
    } catch (err) {
      console.error(err);
      alert('Failed to generate build.');
    }
    setGenerating(false);
  };

  const isLoading = loading || (weapon && weapon.id !== weaponId);

  if (isLoading) {
    return <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>Loading weapon details...</div>;
  }

  if (!weapon) {
    return <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>Weapon not found.</div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
      <div className="glass-panel" style={{ padding: '2rem' }}>
        <Link to="/" className="btn" style={{ textDecoration: 'none', marginBottom: '1.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}>
          <span>&larr;</span> <span>Back to Weapons</span>
        </Link>
        <h2 style={{ color: 'var(--color-accent-gold)' }}>{weapon.shortName}</h2>
        <p style={{ color: 'var(--color-text-muted)' }}>{weapon.name}</p>
        <div style={{ marginTop: '1rem', textAlign: 'center' }}>
          <img src={weapon.properties?.defaultPreset?.image512pxLink || weapon.image512pxLink || weapon.iconLink} alt={weapon.shortName} style={{ maxWidth: '100%' }} />
        </div>
        
        <div style={{ marginTop: '2rem' }}>
          <h3>Base Stats</h3>
          <ul style={{ listStyleType: 'none', padding: 0, marginTop: '1rem' }}>
            <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--color-border)' }}>Ergonomics: {weapon.properties?.ergonomics ?? 'N/A'}</li>
            <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--color-border)' }}>Vertical Recoil: {weapon.properties?.recoilVertical ?? 'N/A'}</li>
            <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--color-border)' }}>Horizontal Recoil: {weapon.properties?.recoilHorizontal ?? 'N/A'}</li>
          </ul>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '2rem' }}>
        <h3>Build Configuration</h3>
        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button 
            className={`btn ${targetType === 'meta' ? '' : 'btn-outline'}`}
            onClick={() => setTargetType('meta')}
            style={{ borderColor: 'var(--color-accent-green)', color: targetType === 'meta' ? 'var(--color-bg-base)' : 'var(--color-accent-green)', background: targetType === 'meta' ? 'var(--color-accent-green)' : 'transparent' }}
          >
            Meta (Top)
          </button>
          <button 
            className={`btn ${targetType === 'max_ergo' ? '' : 'btn-outline'}`}
            onClick={() => setTargetType('max_ergo')}
          >
            Max Ergonomics
          </button>
          <button 
            className={`btn ${targetType === 'min_recoil' ? '' : 'btn-outline'}`}
            onClick={() => setTargetType('min_recoil')}
          >
            Min Recoil
          </button>
          <button 
            className={`btn ${targetType === 'budget' ? '' : 'btn-outline'}`}
            onClick={() => setTargetType('budget')}
          >
            Budget
          </button>
          <button 
            className={`btn ${targetType === 'custom' ? '' : 'btn-outline'}`}
            onClick={() => setTargetType('custom')}
          >
            Custom
          </button>
        </div>

        {targetType === 'custom' && (
          <div style={{ marginTop: '2rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem' }}>Min Ergonomics</label>
              <input type="number" className="input-field" value={customErgo} onChange={e => setCustomErgo(e.target.value)} />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem' }}>Max Recoil</label>
              <input type="number" className="input-field" value={customRecoil} onChange={e => setCustomRecoil(e.target.value)} />
            </div>
          </div>
        )}

        <div style={{ marginTop: '2rem', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <button 
            onClick={() => setShowAdditionalOptions(!showAdditionalOptions)}
            style={{ 
              width: '100%', 
              padding: '1rem', 
              background: 'transparent', 
              border: 'none', 
              color: 'var(--color-text)', 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            <span>Additional Options</span>
            <span style={{ transform: showAdditionalOptions ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s ease' }}>v</span>
          </button>
          
          {showAdditionalOptions && (
            <div style={{ padding: '1.5rem', borderTop: '1px solid var(--color-border)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'end' }}>
              <div>
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: '0.75rem' }}>
                  <div style={{ position: 'relative', width: '44px', height: '24px' }}>
                    <input 
                      type="checkbox" 
                      checked={requireSuppressor}
                      onChange={e => setRequireSuppressor(e.target.checked)}
                      style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }}
                    />
                    <span style={{
                      position: 'absolute',
                      cursor: 'pointer',
                      top: 0, left: 0, right: 0, bottom: 0,
                      backgroundColor: requireSuppressor ? 'var(--color-accent-gold)' : 'rgba(255,255,255,0.1)',
                      border: requireSuppressor ? '1px solid var(--color-accent-gold)' : '1px solid var(--color-border)',
                      transition: '.3s',
                      borderRadius: '24px'
                    }}>
                      <span style={{
                        position: 'absolute',
                        height: '16px',
                        width: '16px',
                        left: requireSuppressor ? '22px' : '3px',
                        bottom: '3px',
                        backgroundColor: requireSuppressor ? '#000' : 'var(--color-text-muted)',
                        transition: '.3s',
                        borderRadius: '50%'
                      }}></span>
                    </span>
                  </div>
                  <span style={{ fontSize: '0.95rem', color: 'var(--color-text)', fontWeight: 'bold' }}>Suppressor</span>
                </label>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>Max Weight (kg)</label>
                <input 
                  type="number" 
                  placeholder="No limit" 
                  value={maxWeight} 
                  onChange={e => setMaxWeight(e.target.value)} 
                  style={{ 
                    width: '100%', 
                    padding: '0.75rem', 
                    backgroundColor: 'rgba(0,0,0,0.5)', 
                    border: '1px solid var(--color-border)', 
                    color: 'var(--color-text)',
                    borderRadius: 'var(--radius-sm)',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }} 
                />
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop: '2rem' }}>
          <button className="btn" style={{ width: '100%', padding: '1rem', fontSize: '1.2rem' }} onClick={handleGenerate} disabled={generating}>
            {generating ? 'LOADING MODS...' : 'GENERATE BUILD'}
          </button>
        </div>

        {buildResult && (
          <div style={{ marginTop: '2rem', padding: '1rem', background: 'rgba(0,0,0,0.3)', borderRadius: 'var(--radius-md)' }}>
            <h4 style={{ color: 'var(--color-accent-green)', marginBottom: '1rem' }}>Build Results</h4>
            {buildResult.error ? (
              <p style={{ color: 'var(--color-accent-red)' }}>{buildResult.error}</p>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1.5rem' }}>
                  <span>Ergonomics: <strong style={{ color: 'var(--color-accent-gold)' }}>{buildResult.stats.ergonomics}</strong></span>
                  <span>Weight: <strong style={{ color: 'var(--color-accent-gold)' }}>{buildResult.stats.weight} kg</strong></span>
                  <span>V. Recoil: <strong style={{ color: 'var(--color-accent-gold)' }}>{buildResult.stats.recoilVertical}</strong></span>
                  <span>H. Recoil: <strong style={{ color: 'var(--color-accent-gold)' }}>{buildResult.stats.recoilHorizontal}</strong></span>
                  <span style={{ gridColumn: 'span 2' }}>Estimated Price: <strong style={{ color: 'var(--color-accent-gold)' }}>{buildResult.stats.price?.toLocaleString()} RUB</strong></span>
                </div>
                {buildResult.warning && (
                  <div style={{ backgroundColor: 'rgba(255, 60, 60, 0.1)', borderLeft: '4px solid var(--color-accent-red)', padding: '0.75rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
                    <strong>Notice:</strong> {buildResult.warning}
                  </div>
                )}
                <h5 style={{ marginTop: '1rem', marginBottom: '0.5rem', color: 'var(--color-text-muted)' }}>Parts List</h5>
                <ul style={{ listStyleType: 'none', padding: 0, maxHeight: '400px', overflowY: 'auto', width: '100%' }}>
                  {buildResult.build.map((part, idx) => {
                    const price = part.item.avg24hPrice || part.item.basePrice || 0;
                    return (
                      <li key={idx} style={{ padding: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', width: '100%', boxSizing: 'border-box' }}>
                        <img src={part.item.image512pxLink || part.item.iconLink || 'https://via.placeholder.com/30'} alt="" style={{ width: '40px', height: '40px', objectFit: 'contain', marginRight: '1rem' }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '1rem', fontWeight: 'bold' }}>{formatPartName(part.item.shortName)}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Slot: {part.slotName}</div>
                        </div>
                        <div style={{ color: 'var(--color-accent-gold)', fontSize: '0.9rem', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                          {price > 0 ? `${price.toLocaleString()} RUB` : 'N/A'}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default Configurator;
