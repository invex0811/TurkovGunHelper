import { useEffect, useMemo, useState } from 'react';
import { getAllMods, getWeapons, isAbortError } from '../data/tarkovApi/index.js';
import { useI18n } from '../i18n/useI18n.js';
import { usePriceMode } from '../features/priceMode/usePriceMode.js';
import ModuleComparisonTable from '../features/moduleComparison/ModuleComparisonTable.jsx';
import SelectButton from '../ui/SelectButton.jsx';
import {
  deselectComparedModules, filterComparisonRows, getAvailableComparisonMetrics,
  getCandidatesForCategory, getInitialSortDirection, getModuleCategories, getReachableModules, getWeaponOptions,
  normalizeComparisonSort, selectComparedModules, sortComparisonRows, toggleComparedModule,
} from '../features/moduleComparison/comparison.js';

const WIDE_TABLE_METRIC_THRESHOLD = 5;

export default function ModuleComparison() {
  const { language, t } = useI18n();
  const { priceMode } = usePriceMode();
  const [weapons, setWeapons] = useState([]);
  const [allMods, setAllMods] = useState({});
  const [weaponId, setWeaponId] = useState('');
  const [categoryKey, setCategoryKey] = useState('');
  const [weaponSearch, setWeaponSearch] = useState('');
  const [moduleSearch, setModuleSearch] = useState('');
  const [compatibility, setCompatibility] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [withPrice, setWithPrice] = useState(false);
  const [selected, setSelected] = useState([]);
  const [visibleColumns, setVisibleColumns] = useState(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [sortKey, setSortKey] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([getWeapons({ language, priceMode, signal: controller.signal }), getAllMods(priceMode, { language, signal: controller.signal })])
      .then(([nextWeapons, nextMods]) => { if (!controller.signal.aborted) { setWeapons(nextWeapons); setAllMods(nextMods); setSelected(current => current.flatMap(item => nextMods[item.id] ? [nextMods[item.id]] : [])); setError(false); } })
      .catch(loadError => { if (!controller.signal.aborted && !isAbortError(loadError)) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [language, priceMode]);

  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const weaponOptions = useMemo(() => getWeaponOptions(weapons, locale), [locale, weapons]);
  // The chosen weapon stays in the list, so the field keeps showing it.
  const filteredWeaponOptions = useMemo(() => {
    const query = weaponSearch.trim().toLocaleLowerCase();
    const matchingIds = new Set(weapons.filter(weapon => [weapon.name, weapon.shortName]
      .some(value => String(value || '').toLocaleLowerCase().includes(query))).map(weapon => weapon.id));
    return weaponOptions.filter(option => matchingIds.has(option.value) || option.value === weaponId);
  }, [weaponId, weaponOptions, weaponSearch, weapons]);
  const weapon = weapons.find(item => item.id === weaponId) || null;
  const candidates = useMemo(() => getReachableModules(weapon, allMods), [weapon, allMods]);
  const categories = useMemo(() => getModuleCategories(candidates), [candidates]);
  const categoryCandidates = useMemo(() => getCandidatesForCategory(candidates, categoryKey), [candidates, categoryKey]);
  const availableMetrics = useMemo(() => getAvailableComparisonMetrics(categoryCandidates), [categoryCandidates]);
  const visibleMetrics = useMemo(() => availableMetrics.filter(metric => !visibleColumns || visibleColumns.has(metric.key)), [availableMetrics, visibleColumns]);
  const selectedIds = useMemo(() => new Set(selected.map(item => item.id)), [selected]);
  const filteredRows = useMemo(() => filterComparisonRows(categoryCandidates, { search: moduleSearch, compatibility, selectedOnly, withPrice, selectedIds }), [categoryCandidates, compatibility, moduleSearch, selectedIds, selectedOnly, withPrice]);
  const activeSort = useMemo(() => normalizeComparisonSort(sortKey, sortDirection, availableMetrics), [availableMetrics, sortDirection, sortKey]);
  const { sortKey: activeSortKey, sortDirection: activeSortDirection } = activeSort;
  const rows = useMemo(() => sortComparisonRows(filteredRows, activeSortKey, activeSortDirection, locale), [activeSortDirection, activeSortKey, filteredRows, locale]);

  const clearFilters = () => { setModuleSearch(''); setCompatibility(''); setSelectedOnly(false); setWithPrice(false); };
  const chooseWeapon = id => { setWeaponId(id); setCategoryKey(''); setSelected([]); setVisibleColumns(null); setSortKey('name'); setSortDirection('asc'); clearFilters(); };
  const chooseCategory = key => { setCategoryKey(key); setSelected([]); setVisibleColumns(null); setSortKey('name'); setSortDirection('asc'); clearFilters(); };
  const toggleItem = item => setSelected(current => toggleComparedModule(current, item));
  const toggleRows = (ids, shouldSelect) => setSelected(current => shouldSelect
    ? selectComparedModules(current, categoryCandidates.filter(row => ids.includes(row.item.id)).map(row => row.item))
    : deselectComparedModules(current, ids));
  const onSort = (key, nextDirection) => { setSortKey(key); setSortDirection(nextDirection || getInitialSortDirection(key)); };
  const toggleColumn = key => setVisibleColumns(current => { const next = new Set(current || availableMetrics.map(metric => metric.key)); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  return <div className="module-comparison-page">
    <header className="module-comparison-page__head"><div><p className="eyebrow">{t('moduleComparison.eyebrow')}</p><h2>{t('moduleComparison.title')}</h2><p>{t('moduleComparison.description')}</p></div><span className="comparison-count">{t('moduleComparison.selectedCount', { count: selected.length })}</span></header>
    {loading ? <p className="comparison-empty">{t('common.loading')}</p> : error ? <p className="comparison-empty" role="alert">{t('error.load')}</p> : <>
      <section className="comparison-controls glass-panel">
        <label>{t('moduleComparison.weaponSearch')}<input className="input-field" type="search" value={weaponSearch} onChange={event => setWeaponSearch(event.target.value)} /></label>
        <div className="comparison-field"><label id="comparisonWeaponLabel" htmlFor="comparisonWeapon">{t('moduleComparison.weapon')}</label><SelectButton id="comparisonWeapon" labelId="comparisonWeaponLabel" options={[{ value: '', label: t('moduleComparison.chooseWeapon') }, ...filteredWeaponOptions]} value={weaponId} onChange={chooseWeapon} /></div>
        <div className="comparison-field"><label id="comparisonCategoryLabel" htmlFor="comparisonCategory">{t('moduleComparison.category')}</label><SelectButton id="comparisonCategory" labelId="comparisonCategoryLabel" options={[{ value: '', label: t('moduleComparison.chooseCategory') }, ...categories.map(category => ({ value: category.key, label: category.label }))]} value={categoryKey} onChange={chooseCategory} disabled={!weapon} /></div>
      </section>
      {!weapon ? <p className="comparison-empty">{t('moduleComparison.noWeapon')}</p> : !categories.length ? <p className="comparison-empty">{t('moduleComparison.noCategories')}</p> : !categoryKey ? <p className="comparison-empty">{t('moduleComparison.chooseCategory')}</p> : <>
        <section className="module-comparison-filters glass-panel"><label>{t('moduleComparison.moduleSearch')}<input className="input-field" type="search" value={moduleSearch} onChange={event => setModuleSearch(event.target.value)} /></label><div className="comparison-field comparison-field--inline"><label id="comparisonCompatibilityLabel" htmlFor="comparisonCompatibility">{t('moduleComparison.compatibility')}</label><SelectButton id="comparisonCompatibility" labelId="comparisonCompatibilityLabel" options={[{ value: '', label: t('moduleComparison.all') }, { value: 'direct', label: t('moduleComparison.direct') }, { value: 'viaAdapter', label: t('moduleComparison.viaAdapter') }]} value={compatibility} onChange={setCompatibility} /></div><label><input type="checkbox" checked={selectedOnly} onChange={event => setSelectedOnly(event.target.checked)} /> {t('moduleComparison.selectedOnly')}</label><label><input type="checkbox" checked={withPrice} onChange={event => setWithPrice(event.target.checked)} /> {t('moduleComparison.withPrice')}</label><button className="btn btn--ghost" type="button" onClick={clearFilters}>{t('moduleComparison.clearFilters')}</button><div className="module-comparison-columns"><button className="btn btn--ghost" type="button" aria-expanded={columnsOpen} onClick={() => setColumnsOpen(open => !open)}>{t('moduleComparison.columns')}</button>{columnsOpen && <div className="module-comparison-columns__menu">{availableMetrics.map(metric => <label key={metric.key}><input type="checkbox" checked={!visibleColumns || visibleColumns.has(metric.key)} onChange={() => toggleColumn(metric.key)} /> {t(metric.labelKey)}</label>)}</div>}</div></section>
        {rows.length ? <section className={`comparison-table-panel glass-panel${visibleMetrics.length > WIDE_TABLE_METRIC_THRESHOLD ? ' comparison-table-panel--wide' : ''}`}><ModuleComparisonTable rows={rows} selectedIds={selectedIds} metrics={visibleMetrics} sortKey={activeSortKey} sortDirection={activeSortDirection} locale={locale} t={t} onSort={onSort} onToggle={toggleItem} onToggleRows={toggleRows} /></section> : <p className="comparison-empty">{t('moduleComparison.noModules')}</p>}
      </>}
    </>}
  </div>;
}
