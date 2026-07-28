import { useEffect, useMemo, useState } from 'react';
import { getAllMods, getWeapons, isAbortError } from '../data/tarkovApi/index.js';
import { useI18n } from '../i18n/useI18n.js';
import { usePriceMode } from '../features/priceMode/usePriceMode.js';
import AsyncImage from '../ui/AsyncImage.jsx';
import {
  COMPARISON_METRICS, MAX_COMPARE_MODULES, filterModulesByCategory, formatMetric,
  getMetricExtremes, getModuleCategories, getReachableModules, metricValue, toggleComparedModule,
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
  const [selected, setSelected] = useState([]);
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
  const modules = useMemo(() => filterModulesByCategory(candidates, categoryKey, moduleSearch), [candidates, categoryKey, moduleSearch]);

  const chooseWeapon = id => { setWeaponId(id); setCategoryKey(''); setModuleSearch(''); setSelected([]); };
  const locale = language === 'ru' ? 'ru-RU' : 'en-US';

  return <div className="module-comparison-page">
    <header className="module-comparison-page__head"><div><p className="eyebrow">{t('moduleComparison.eyebrow')}</p><h2>{t('moduleComparison.title')}</h2><p>{t('moduleComparison.description')}</p></div><span className="comparison-count">{t('moduleComparison.selectedCount', { count: selected.length, max: MAX_COMPARE_MODULES })}</span></header>
    {loading ? <p className="comparison-empty">{t('common.loading')}</p> : error ? <p className="comparison-empty" role="alert">{t('error.load')}</p> : <>
      <section className="comparison-controls glass-panel">
        <label>{t('moduleComparison.weaponSearch')}<input className="input-field" type="search" value={weaponSearch} onChange={event => setWeaponSearch(event.target.value)} /></label>
        <label>{t('moduleComparison.weapon')}<select value={weaponId} onChange={event => chooseWeapon(event.target.value)}><option value="">{t('moduleComparison.chooseWeapon')}</option>{filteredWeapons.map(item => <option key={item.id} value={item.id}>{item.shortName || item.name}</option>)}</select></label>
        <label>{t('moduleComparison.category')}<select value={categoryKey} onChange={event => { setCategoryKey(event.target.value); setModuleSearch(''); }} disabled={!weapon}><option value="">{t('moduleComparison.chooseCategory')}</option>{categories.map(category => <option key={category.key} value={category.key}>{category.label}</option>)}</select></label>
      </section>
      {!weapon ? <p className="comparison-empty">{t('moduleComparison.noWeapon')}</p> : !categories.length ? <p className="comparison-empty">{t('moduleComparison.noCategories')}</p> : <>
        {categoryKey && <section className="comparison-module-list glass-panel"><div className="comparison-module-list__head"><h3>{t('moduleComparison.modules')}</h3><label className="visually-hidden" htmlFor="module-search">{t('moduleComparison.moduleSearch')}</label><input id="module-search" className="input-field" type="search" placeholder={t('moduleComparison.moduleSearch')} value={moduleSearch} onChange={event => setModuleSearch(event.target.value)} /></div>{modules.length ? <div className="comparison-module-grid">{modules.map(({ item, compatibilityKind }) => { const included = selected.some(entry => entry.id === item.id); return <article className="comparison-module" key={item.id}><AsyncImage src={item.image512pxLink || item.iconLink} alt="" containerStyle={{ height: '76px' }} style={{ maxHeight: '76px', maxWidth: '100%', objectFit: 'contain' }} /><div><strong>{item.shortName || item.name}</strong><small>{item.price?.value ? formatMetric(item.price.value, COMPARISON_METRICS.at(-1), locale) : '—'}</small><span>{compatibilityKind === 'direct' ? t('moduleComparison.direct') : t('moduleComparison.viaAdapter')}</span></div><button className="btn btn--ghost" type="button" onClick={() => setSelected(current => toggleComparedModule(current, item))} disabled={!included && selected.length >= MAX_COMPARE_MODULES} aria-pressed={included}>{included ? t('moduleComparison.remove') : t('moduleComparison.add')}</button></article>; })}</div> : <p className="comparison-empty">{t('moduleComparison.noModules')}</p>}</section>}
        {selected.length > 0 && <section className="comparison-table-panel glass-panel"><div className="comparison-table-panel__head"><h3>{t('moduleComparison.table')}</h3><button type="button" className="btn btn--ghost" onClick={() => setSelected([])}>{t('moduleComparison.clear')}</button></div><div className="comparison-table-wrap"><table className="comparison-table"><thead><tr><th>{t('moduleComparison.metric')}</th>{selected.map(item => <th key={item.id}><button className="comparison-remove" type="button" onClick={() => setSelected(current => current.filter(entry => entry.id !== item.id))} aria-label={t('moduleComparison.removeItem', { name: item.shortName || item.name })}>×</button>{item.shortName || item.name}</th>)}</tr></thead><tbody>{COMPARISON_METRICS.map(metric => { const extremes = getMetricExtremes(selected, metric); return <tr key={metric.key}><th>{t(metric.labelKey)}</th>{selected.map(item => { const value = metricValue(item, metric); const state = value !== null && value === extremes.best ? ' is-best' : value !== null && value === extremes.worst ? ' is-worst' : ''; return <td className={state} key={item.id}>{state && <span className="visually-hidden">{state.includes('best') ? t('moduleComparison.best') : t('moduleComparison.worst')} </span>}{formatMetric(value, metric, locale)}</td>; })}</tr>; })}</tbody></table></div></section>}
      </>}
    </>}
  </div>;
}
