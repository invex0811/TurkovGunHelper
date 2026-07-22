import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getWeapons, isAbortError } from '../data/tarkovApi';
import { filterHomeWeapons, getHomeWeaponFilterOptions } from './homeWeaponFilters.js';
import HomeFilterModal from '../ui/HomeFilterModal.jsx';

function ImageWithLoader({ src, alt, style, containerStyle }) {
  const [imageState, setImageState] = useState(src ? 'loading' : 'error');
  const isLoading = Boolean(src) && imageState === 'loading';
  const canDisplayImage = Boolean(src) && imageState !== 'error';

  return (
    <div style={{ position: 'relative', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', ...containerStyle }}>
      {isLoading && (
        <div className="shimmer" style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: 'var(--radius-sm)',
        }} />
      )}
      {canDisplayImage ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setImageState('loaded')}
          onError={() => setImageState('error')}
          style={{
            ...style,
            opacity: imageState === 'loaded' ? 1 : 0,
            transition: 'opacity 0.3s ease-in-out',
          }}
        />
      ) : (
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.8rem' }}>Image unavailable</span>
      )}
    </div>
  );
}

function Home() {
  const [weapons, setWeapons] = useState([]);
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState('All');
  const [selectedCaliber, setSelectedCaliber] = useState('All');
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadWeapons = useCallback(async ({ signal, forceRefresh = false } = {}) => {
    setLoading(true);
    setError(null);

    try {
      const data = await getWeapons({ signal, forceRefresh });

      if (!signal?.aborted) {
        setWeapons(data);
      }
    } catch (loadError) {
      if (!signal?.aborted && !isAbortError(loadError)) {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load weapons. Please try again.');
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void getWeapons({ signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) {
          setWeapons(data);
        }
      })
      .catch(loadError => {
        if (!controller.signal.aborted && !isAbortError(loadError)) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load weapons. Please try again.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, []);

  const { types: weaponTypes, calibers } = useMemo(() => getHomeWeaponFilterOptions(weapons), [weapons]);

  const filteredWeapons = useMemo(
    () => filterHomeWeapons(weapons, { search, type: selectedType, caliber: selectedCaliber }),
    [search, selectedCaliber, selectedType, weapons],
  );

  const activeFacetFilterCount = Number(selectedType !== 'All') + Number(selectedCaliber !== 'All');
  const hasActiveFilters = search.trim().length > 0 || activeFacetFilterCount > 0;
  const showInitialLoading = loading && weapons.length === 0;
  const showInitialError = error && weapons.length === 0;

  const resetFilters = () => {
    setSearch('');
    setSelectedType('All');
    setSelectedCaliber('All');
  };

  const closeFilterModal = useCallback(() => setIsFilterModalOpen(false), []);

  return (
    <div className="glass-panel home-page-panel" style={{ marginTop: '18px', padding: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h2>Select Weapon</h2>
        <div className="home-filter-toolbar">
          <button
            className={`btn btn--ghost home-filter-trigger${activeFacetFilterCount ? ' is-active' : ''}`}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={isFilterModalOpen}
            aria-controls="homeFilterModal"
            onClick={() => setIsFilterModalOpen(true)}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M3 5h18l-7.2 8.1v5.4l-3.6 1.8v-7.2L3 5Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" /></svg>
            <span>Filters</span>
            {activeFacetFilterCount > 0 && <span className="home-filter-trigger__badge" aria-label={`${activeFacetFilterCount} active filters`}>{activeFacetFilterCount}</span>}
          </button>
          <input
            type="search"
            className="input-field home-search-input"
            placeholder="Search weapons..."
            aria-label="Search weapons"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </div>
      </div>

      {isFilterModalOpen && (
        <HomeFilterModal
          types={weaponTypes}
          calibers={calibers}
          selectedType={selectedType}
          selectedCaliber={selectedCaliber}
          onClose={closeFilterModal}
          onApply={({ type, caliber }) => {
            setSelectedType(type);
            setSelectedCaliber(caliber);
            closeFilterModal();
          }}
        />
      )}

      {showInitialLoading ? (
        <p aria-live="polite" style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '3rem 0' }}>Loading weapons from Tarkov.dev...</p>
      ) : showInitialError ? (
        <section aria-live="assertive" style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '3rem 0' }}>
          <p style={{ margin: '0 0 1rem' }}>{error}</p>
          <button className="btn btn--primary" type="button" onClick={() => loadWeapons({ forceRefresh: true })} disabled={loading}>
            Try again
          </button>
        </section>
      ) : (
        <>
          {error && (
            <div role="alert" style={{ border: '1px solid var(--color-accent-red)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text-main)', display: 'flex', gap: '1rem', justifyContent: 'space-between', marginBottom: '1rem', padding: '0.75rem 1rem' }}>
              <span>{error}</span>
              <button className="btn btn--ghost" type="button" onClick={() => loadWeapons({ forceRefresh: true })} disabled={loading}>
                Retry
              </button>
            </div>
          )}

          {filteredWeapons.length === 0 ? (
            <section aria-live="polite" style={{ color: 'var(--color-text-muted)', textAlign: 'center', padding: '3rem 0' }}>
              <p>{hasActiveFilters ? 'No weapons match the selected filters.' : 'Tarkov.dev did not return any weapons.'}</p>
              {hasActiveFilters && (
                <button className="btn btn--ghost" type="button" onClick={resetFilters}>
                  Clear filters
                </button>
              )}
            </section>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
              gap: '1rem',
            }}>
              {filteredWeapons.map(weapon => (
                <Link to={`/configure/${weapon.id}`} key={weapon.id} style={{ textDecoration: 'none' }}>
                  <div className="glass-panel weapon-card" style={{
                    padding: '1rem',
                    textAlign: 'center',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}>
                    <div>
                      <ImageWithLoader
                        key={weapon.properties?.defaultPreset?.image512pxLink || weapon.image512pxLink || `${weapon.id}-missing-image`}
                        src={weapon.properties?.defaultPreset?.image512pxLink || weapon.image512pxLink}
                        alt={weapon.shortName}
                        style={{ maxWidth: '100%', maxHeight: '100px', objectFit: 'contain' }}
                        containerStyle={{ height: '100px' }}
                      />
                      <h3 style={{ fontSize: '1.2rem', margin: '1rem 0 0.5rem 0', color: 'var(--color-accent-gold)' }}>{weapon.shortName}</h3>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{weapon.name}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
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
          fontFamily: 'monospace',
        }}>i</span>
        <span>All data is sourced from <a href="https://tarkov.dev" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent-gold)', textDecoration: 'none', borderBottom: '1px dotted var(--color-accent-gold)' }}>tarkov.dev</a></span>
      </div>
    </div>
  );
}

export default Home;
