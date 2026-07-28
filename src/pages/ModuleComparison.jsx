import { useEffect, useMemo, useState } from 'react';
import { getAllMods, getWeapons, isAbortError } from '../data/tarkovApi/index.js';
import { useI18n } from '../i18n/useI18n.js';
import { usePriceMode } from '../features/priceMode/usePriceMode.js';
import ModuleComparisonTable from '../features/moduleComparison/ModuleComparisonTable.jsx';
import {
  COMPARISON_METRICS, DEFAULT_VISIBLE_COLUMNS, deselectComparedModules, filterComparisonRows,
  getCandidatesForCategory, getInitialSortDirection, getModuleCategories, getReachableModules,
  selectComparedModules, sortComparisonRows, toggleComparedModule,
} from '../features/moduleComparison/comparison.js';

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
  const [visibleColumns, setVisibleColumns] = useState(() => new Set(DEFAULT_VISIBLE_COLUMNS));
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

  const filteredWeapons = useMemo(() => weapons.filter(weapon => [weapon.name, weapon.shortName]
    .some(value => String(value || '').toLocaleLowerCase().includes(weaponSearch.trim().toLocaleLowerCase()))), [weapons, weaponSearch]);
  const weapon = weapons.find(item => item.id === weaponId) || null;
  const candidates = useMemo(() => getReachableModules(weapon, allMods), [weapon, allMods]);
  const categories = useMemo(() => getModuleCategories(candidates), [candidates]);
  const categoryCandidates = useMemo(() => getCandidatesForCategory(candidates, categoryKey), [candidates, categoryKey]);
  const selectedIds = useMemo(() => new Set(selected.map(item => item.id)), [selected]);
  const filteredRows = useMemo(() => filterComparisonRows(categoryCandidates, { search: moduleSearch, compatibility, selectedOnly, withPrice, selectedIds }), [categoryCandidates, compatibility, moduleSearch, selectedIds, selectedOnly, withPrice]);
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';
  const rows = useMemo(() => sortComparisonRows(filteredRows, sortKey, sortDirection, locale), [filteredRows, locale, sortDirection, sortKey]);

  const clearFilters = () => { setModuleSearch(''); setCompatibility(''); setSelectedOnly(false); setWithPrice(false); };
  const chooseWeapon = id => { setWeaponId(id); setCategoryKey(''); setSelected([]); clearFilters(); };
  const chooseCategory = key => { setCategoryKey(key); setSelected([]); clearFilters(); };
  const toggleItem = item => setSelected(current => toggleComparedModule(current, item));
  const toggleRows = (ids, shouldSelect) => setSelected(current => shouldSelect
    ? selectComparedModules(current, categoryCandidates.filter(row => ids.includes(row.item.id)).map(row => row.item))
    : deselectComparedModules(current, ids));
  const setAll = () => setSelected(current => selectComparedModules(current, categoryCandidates.map(row => row.item)));
  const onSort = (key, nextDirection) => { setSortKey(key); setSortDirection(nextDirection || getInitialSortDirection(key)); };
  const toggleColumn = key => setVisibleColumns(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });

  return <div className="module-comparison-page">
    <header className="module-comparison-page__head"><div><p className="eyebrow">{t('moduleComparison.eyebrow')}</p><h2>{t('moduleComparison.title')}</h2><p>{t('moduleComparison.description')}</p></div><span className="comparison-count">{t('moduleComparison.selectedCount', { count: selected.length })}</span></header>
    {loading ? <p className="comparison-empty">{t('common.loading')}</p> : error ? <p className="comparison-empty" role="alert">{t('error.load')}</p> : <>
      <section className="comparison-controls glass-panel">
        <label>{t('moduleComparison.weaponSearch')}<input className="input-field" type="search" value={weaponSearch} onChange={event => setWeaponSearch(event.target.value)} /></label>
        <label>{t('moduleComparison.weapon')}<select value={weaponId} onChange={event => chooseWeapon(event.target.value)}><option value="">{t('moduleComparison.chooseWeapon')}</option>{filteredWeapons.map(item => <option key={item.id} value={item.id}>{item.shortName || item.name}</option>)}</select></label>
        <label>{t('moduleComparison.category')}<select value={categoryKey} onChange={event => chooseCategory(event.target.value)} disabled={!weapon}><option value="">{t('moduleComparison.chooseCategory')}</option>{categories.map(category => <option key={category.key} value={category.key}>{category.label}</option>)}</select></label>
      </section>
      {!weapon ? <p className="comparison-empty">{t('moduleComparison.noWeapon')}</p> : !categories.length ? <p className="comparison-empty">{t('moduleComparison.noCategories')}</p> : !categoryKey ? <p className="comparison-empty">{t('moduleComparison.chooseCategory')}</p> : <>
        <section className="module-comparison-toolbar glass-panel">
          <div className="module-comparison-toolbar__counts"><span>{t('moduleComparison.compatibleCount', { count: categoryCandidates.length })}</span><span>{t('moduleComparison.shownCount', { count: rows.length, total: categoryCandidates.length })}</span><span>{t('moduleComparison.selectedCount', { count: selected.length })}</span></div>
          <div className="module-comparison-toolbar__actions"><button className="btn btn--primary" type="button" onClick={setAll}>{t('moduleComparison.compareAll')}</button><button className="btn btn--ghost" type="button" onClick={() => toggleRows(rows.map(row => row.item.id), true)} disabled={!rows.length}>{t('moduleComparison.selectShown')}</button><button className="btn btn--ghost" type="button" onClick={() => setSelected([])} disabled={!selected.length}>{t('moduleComparison.deselectAll')}</button></div>
        </section>
        <section className="module-comparison-filters glass-panel"><label>{t('moduleComparison.moduleSearch')}<input className="input-field" type="search" value={moduleSearch} onChange={event => setModuleSearch(event.target.value)} /></label><label>{t('moduleComparison.compatibility')}<select value={compatibility} onChange={event => setCompatibility(event.target.value)}><option value="">{t('moduleComparison.all')}</option><option value="direct">{t('moduleComparison.direct')}</option><option value="viaAdapter">{t('moduleComparison.viaAdapter')}</option></select></label><label><input type="checkbox" checked={selectedOnly} onChange={event => setSelectedOnly(event.target.checked)} /> {t('moduleComparison.selectedOnly')}</label><label><input type="checkbox" checked={withPrice} onChange={event => setWithPrice(event.target.checked)} /> {t('moduleComparison.withPrice')}</label><button className="btn btn--ghost" type="button" onClick={clearFilters}>{t('moduleComparison.clearFilters')}</button><div className="module-comparison-columns"><button className="btn btn--ghost" type="button" aria-expanded={columnsOpen} onClick={() => setColumnsOpen(open => !open)}>{t('moduleComparison.columns')}</button>{columnsOpen && <div className="module-comparison-columns__menu">{COMPARISON_METRICS.map(metric => <label key={metric.key}><input type="checkbox" checked={visibleColumns.has(metric.key)} onChange={() => toggleColumn(metric.key)} /> {t(metric.labelKey)}</label>)}</div>}</div></section>
        {rows.length ? <section className="comparison-table-panel glass-panel"><ModuleComparisonTable rows={rows} selectedIds={selectedIds} visibleColumns={visibleColumns} sortKey={sortKey} sortDirection={sortDirection} locale={locale} t={t} onSort={onSort} onToggle={toggleItem} onToggleRows={toggleRows} /></section> : <p className="comparison-empty">{t('moduleComparison.noModules')}</p>}
      </>}
    </>}
  </div>;
}
