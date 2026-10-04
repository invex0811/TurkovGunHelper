import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getWeapons, isAbortError } from '../data/tarkovApi';
import { selectWeaponPurchasePrice } from '../data/price/priceMapper.js';
import {
  filterHomeWeapons,
  formatCaliberLabel,
  getHomeWeaponFilterOptions,
  getWeaponTypeLabel,
  HOME_TYPE_PARAM,
  HOME_WEAPON_SORTS,
  sortHomeWeapons,
} from './homeWeaponFilters.js';
import HomeFilterModal from '../ui/HomeFilterModal.jsx';
import SelectButton from '../ui/SelectButton.jsx';
import { useI18n } from '../i18n/useI18n.js';
import AsyncImage from '../ui/AsyncImage.jsx';
import { MaterialSymbol } from '../ui/MaterialSymbol.js';
import { useCatalogStatus } from '../features/dataStatus/useCatalogStatus.js';
import { usePriceMode } from '../features/priceMode/usePriceMode.js';
import { useTraderLevels } from '../features/traderLevels/useTraderLevels.js';

function formatRubles(value, language) {
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(value)} ₽`;
}

function isEditableTarget(target) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName));
}

function WeaponStat({ abbreviation, label, value }) {
  return (
    <span className="weapon-card__stat">
      <span className="weapon-card__stat-label" aria-hidden="true">{abbreviation}</span>
      <span className="visually-hidden">{label}</span>
      {' '}{value}
    </span>
  );
}

function WeaponCard({ language, price, t, weapon }) {
  const type = getWeaponTypeLabel(weapon);
  const caliber = weapon.properties?.caliber;
  const ergonomics = weapon.properties?.ergonomics;
  const recoil = weapon.properties?.recoilVertical;
  const image = weapon.properties?.defaultPreset?.image512pxLink || weapon.image512pxLink;

  return (
    <Link to={`/configure/${weapon.id}`} className="weapon-card">
      <div className="weapon-card__plate reticle">
        {type && <span className="weapon-card__type">{type}</span>}
        <AsyncImage
          key={image || `${weapon.id}-missing-image`}
          src={image}
          alt=""
          unavailableLabel={t('image.unavailable')}
          unavailableStyle={{ fontSize: '0.75rem' }}
          shimmerBorderRadius="var(--radius-sm)"
          className="weapon-card__image"
          containerStyle={{ width: '100%', height: '100%' }}
        />
      </div>
      <div className="weapon-card__body">
        <div className="weapon-card__title">
          <h3>{weapon.shortName}</h3>
          {caliber && <span className="tag tag--gold">{formatCaliberLabel(caliber)}</span>}
        </div>
        <p className="weapon-card__name">{weapon.name}</p>
        <div className="weapon-card__footer">
          <span className="weapon-card__stats">
            {Number.isFinite(ergonomics) && (
              <WeaponStat abbreviation={t('home.card.ergonomicsShort')} label={t('config.stat.ergonomics')} value={ergonomics} />
            )}
            {Number.isFinite(recoil) && (
              <WeaponStat abbreviation={t('home.card.recoilShort')} label={t('config.stat.verticalRecoil')} value={recoil} />
            )}
          </span>
          {Number.isFinite(price) && (
            <span className="weapon-card__price">
              <span className="visually-hidden">{t('home.card.basePrice')} </span>
              {formatRubles(price, language)}
            </span>
          )}
          <span className="weapon-card__cta" aria-hidden="true">
            {t('home.card.build')}
            <MaterialSymbol name="arrow_forward" />
          </span>
        </div>
      </div>
    </Link>
  );
}

function Home() {
  const { language, t } = useI18n();
  const { priceMode } = usePriceMode();
  const { traderLevels, strictTraderLevels, includeRefOffers } = useTraderLevels();
  const { refreshVersion } = useCatalogStatus();
  const [weapons, setWeapons] = useState([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
  const [selectedCaliber, setSelectedCaliber] = useState('All');
  const [selectedTrader, setSelectedTrader] = useState('All');
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedType = searchParams.get(HOME_TYPE_PARAM) || 'All';
  const setSelectedType = useCallback(type => {
    setSearchParams(current => {
      const next = new URLSearchParams(current);
      if (type === 'All') next.delete(HOME_TYPE_PARAM);
      else next.set(HOME_TYPE_PARAM, type);
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const loadedLanguageRef = useRef(null);
  const searchRef = useRef(null);

  const loadWeapons = useCallback(async ({ signal, forceRefresh = false } = {}) => {
    setLoading(true);
    setError(null);
    // A catalog is localized as a whole. Do not keep the previous locale visible
    // while the replacement request is in flight or after it fails.
    if (!forceRefresh) setWeapons([]);

    try {
      const data = await getWeapons({ signal, forceRefresh, language, priceMode });

      if (!signal?.aborted) {
        setWeapons(data);
      }
    } catch (loadError) {
      if (!signal?.aborted && !isAbortError(loadError)) {
        setError(t('error.load'));
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [language, priceMode, t]);

  // A new language replaces the list; a price mode switch or a header refresh
  // only swaps the prices, so filters and the visible list stay in place.
  useEffect(() => {
    const controller = new AbortController();
    const languageChanged = loadedLanguageRef.current !== language;

    void Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) return null;
        setError(null);
        if (languageChanged) {
          setLoading(true);
          setWeapons([]);
          // Category labels come from Tarkov.dev and change with the locale; a
          // type label from the old locale is dropped once the new list arrives.
        }
        return getWeapons({ signal: controller.signal, language, priceMode });
      })
      .then(data => {
        if (data && !controller.signal.aborted) {
          loadedLanguageRef.current = language;
          setWeapons(data);
        }
      })
      .catch(loadError => {
        if (!controller.signal.aborted && !isAbortError(loadError)) {
          setError(t('error.load'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [language, priceMode, refreshVersion, t]);

  // "/" jumps to the search field, as the hint in the field says.
  useEffect(() => {
    const handleKeyDown = event => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableTarget(event.target) || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const { types: weaponTypes, calibers, traders } = useMemo(() => getHomeWeaponFilterOptions(weapons), [weapons]);
  // A type from the URL that this catalog does not have (another language, a
  // stale link) falls back to all weapons instead of an empty list.
  const selectedType = weaponTypes.includes(requestedType) ? requestedType : 'All';
  const hasStaleType = !loading && weapons.length > 0 && requestedType !== selectedType;
  useEffect(() => {
    if (hasStaleType) setSelectedType('All');
  }, [hasStaleType, setSelectedType]);

  const prices = useMemo(() => {
    const options = {
      priceMode,
      includeTraderPrices: true,
      traderLevels: traderLevels.profiles?.[priceMode] || {},
      strictTraderLevels,
      includeRefOffers,
    };
    return new Map(weapons.map(weapon => {
      const value = selectWeaponPurchasePrice(weapon, options).value;
      return [weapon.id, typeof value === 'number' && value > 0 ? value : Number.NaN];
    }));
  }, [includeRefOffers, priceMode, strictTraderLevels, traderLevels, weapons]);

  const visibleWeapons = useMemo(
    () => sortHomeWeapons(
      filterHomeWeapons(weapons, {
        search,
        type: selectedType,
        caliber: selectedCaliber,
        trader: selectedTrader,
      }),
      sort,
      weapon => prices.get(weapon.id),
    ),
    [prices, search, selectedCaliber, selectedTrader, selectedType, sort, weapons],
  );

  const activeFacetFilterCount = Number(selectedCaliber !== 'All') + Number(selectedTrader !== 'All');
  const hasActiveFilters = search.trim().length > 0 || selectedType !== 'All' || activeFacetFilterCount > 0;
  const showInitialLoading = loading && weapons.length === 0;
  const showInitialError = error && weapons.length === 0;

  const resetFilters = () => {
    setSearch('');
    setSelectedType('All');
    setSelectedCaliber('All');
    setSelectedTrader('All');
  };

  const closeFilterModal = useCallback(() => setIsFilterModalOpen(false), []);

  return (
    <section className="catalog" aria-labelledby="catalogTitle">
      <div className="catalog__head">
        <div className="catalog__heading">
          <p className="eyebrow-mono">
            {t('home.eyebrow', { mode: t(`priceMode.${priceMode}`), count: weapons.length })}
          </p>
          <h1 id="catalogTitle" className="page-title">{t('home.selectWeapon')}</h1>
        </div>
        <div className="catalog__tools">
          <label className="search-field">
            <MaterialSymbol name="search" className="search-field__icon" />
            <input
              ref={searchRef}
              type="search"
              placeholder={t('home.searchPlaceholder')}
              aria-label={t('home.searchLabel')}
              aria-keyshortcuts="/"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
            <kbd className="search-field__kbd" aria-hidden="true">/</kbd>
          </label>
          <SelectButton
            label={t('home.sort.label')}
            options={HOME_WEAPON_SORTS.map(option => ({ value: option, label: t(`home.sort.${option}`) }))}
            value={sort}
            onChange={setSort}
          />
        </div>
      </div>

      <div className="catalog__filters">
        <div className="chip-row" role="group" aria-label={t('filter.weaponType')}>
          {['All', ...weaponTypes].map(type => (
            <button
              key={type}
              className="chip"
              type="button"
              aria-pressed={selectedType === type}
              onClick={() => setSelectedType(type)}
            >
              {type === 'All' ? t('filter.allTypes') : type}
            </button>
          ))}
        </div>
        <button
          className={`text-btn catalog__filter-trigger${activeFacetFilterCount ? ' is-active' : ''}`}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={isFilterModalOpen}
          aria-controls="homeFilterModal"
          onClick={() => setIsFilterModalOpen(true)}
        >
          <MaterialSymbol name="filter_alt" />
          <span className="catalog__filter-label">{t('home.filters')}</span>
          {activeFacetFilterCount > 0 && (
            <span className="count-badge" aria-label={t('home.activeFilters', { count: activeFacetFilterCount })}>
              {activeFacetFilterCount}
            </span>
          )}
        </button>
      </div>

      {isFilterModalOpen && (
        <HomeFilterModal
          calibers={calibers}
          traders={traders}
          selectedCaliber={selectedCaliber}
          selectedTrader={selectedTrader}
          onClose={closeFilterModal}
          onApply={({ caliber, trader }) => {
            setSelectedCaliber(caliber);
            setSelectedTrader(trader);
            closeFilterModal();
          }}
        />
      )}

      {showInitialLoading ? (
        <p className="catalog__message" aria-live="polite">{t('home.loading')}</p>
      ) : showInitialError ? (
        <section className="catalog__message" aria-live="assertive">
          <p>{error}</p>
          <button className="btn btn--primary" type="button" onClick={() => loadWeapons({ forceRefresh: true })} disabled={loading}>
            {t('common.tryAgain')}
          </button>
        </section>
      ) : (
        <>
          {error && (
            <div className="catalog__alert" role="alert">
              <span>{error}</span>
              <button className="btn btn--ghost" type="button" onClick={() => loadWeapons({ forceRefresh: true })} disabled={loading}>
                {t('common.retry')}
              </button>
            </div>
          )}

          {visibleWeapons.length === 0 ? (
            <section className="catalog__message" aria-live="polite">
              <p>{hasActiveFilters ? t('home.emptyFiltered') : t('home.empty')}</p>
              {hasActiveFilters && (
                <button className="btn btn--ghost" type="button" onClick={resetFilters}>
                  {t('home.clearFilters')}
                </button>
              )}
            </section>
          ) : (
            <div className="weapon-grid">
              {visibleWeapons.map(weapon => (
                <WeaponCard
                  key={weapon.id}
                  language={language}
                  price={prices.get(weapon.id)}
                  t={t}
                  weapon={weapon}
                />
              ))}
            </div>
          )}
        </>
      )}
      <footer className="catalog__footer">
        <span>
          {t('home.source')}{' '}
          <a href="https://tarkov.dev" target="_blank" rel="noopener noreferrer">tarkov.dev</a>
          {'. '}{t('home.pricesApproximate')}
        </span>
        <span>{t('home.unofficial')}</span>
      </footer>
    </section>
  );
}

export default Home;
