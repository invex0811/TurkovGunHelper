import { useEffect, useMemo, useRef } from 'react';
import AsyncImage from '../../ui/AsyncImage.jsx';
import { formatMetric, getMetricExtremes, metricValue } from './comparison.js';

function SelectAllCheckbox({ checked, indeterminate, onChange, label }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = indeterminate; }, [indeterminate]);
  return <input ref={ref} type="checkbox" checked={checked} onChange={onChange} aria-label={label} />;
}

export default function ModuleComparisonTable({
  rows, selectedIds, metrics, sortKey, sortDirection, locale, t, onSort, onToggle, onToggleRows,
}) {
  const rowIds = useMemo(() => rows.map(row => row.item.id), [rows]);
  const selectedRowCount = rowIds.filter(id => selectedIds.has(id)).length;
  const allSelected = rowIds.length > 0 && selectedRowCount === rowIds.length;
  const someSelected = selectedRowCount > 0 && !allSelected;
  const extremesByMetric = useMemo(() => new Map(metrics.map(metric => [metric.key, getMetricExtremes(rows.map(row => row.item), metric)])), [metrics, rows]);
  const toggleSort = key => onSort(key, key === sortKey ? (sortDirection === 'asc' ? 'desc' : 'asc') : undefined);
  const sortLabel = key => sortKey !== key ? '↕' : sortDirection === 'asc' ? '↑' : '↓';

  return <div className="module-comparison-table-wrap"><table className="module-comparison-table">
    <thead><tr>
      <th className="module-comparison-table__selection"><SelectAllCheckbox checked={allSelected} indeterminate={someSelected} label={t('moduleComparison.selectShown')} onChange={() => onToggleRows(rowIds, !allSelected)} /></th>
      <th className="module-comparison-table__module" aria-sort={sortKey === 'name' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" onClick={() => toggleSort('name')} aria-label={t('moduleComparison.sortBy', { column: t('moduleComparison.module') })}>{t('moduleComparison.module')} <span aria-hidden="true">{sortLabel('name')}</span></button></th>
      {metrics.map(metric => <th key={metric.key} aria-sort={sortKey === metric.key ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}><button type="button" onClick={() => toggleSort(metric.key)} aria-label={t('moduleComparison.sortBy', { column: t(metric.labelKey) })}>{t(metric.labelKey)} <span aria-hidden="true">{sortLabel(metric.key)}</span></button></th>)}
    </tr></thead>
    <tbody>{rows.map(row => { const selected = selectedIds.has(row.item.id); return <tr key={row.item.id}>
      <td className="module-comparison-table__selection"><input type="checkbox" checked={selected} onChange={() => onToggle(row.item)} aria-label={t('moduleComparison.toggleItem', { name: row.item.shortName || row.item.name })} /></td>
      <th className="module-comparison-table__module" scope="row"><div className="module-comparison-table__item"><AsyncImage src={row.item.image512pxLink || row.item.iconLink} alt="" containerStyle={{ width: '52px', height: '52px', flex: '0 0 52px' }} style={{ maxHeight: '52px', maxWidth: '52px', objectFit: 'contain' }} /><span><strong>{row.item.name || row.item.shortName}</strong><small>{row.item.shortName}</small></span></div></th>
      {metrics.map(metric => { const value = metricValue(row.item, metric); const extremes = extremesByMetric.get(metric.key); const state = value !== null && value === extremes.best ? ' is-best' : value !== null && value === extremes.worst ? ' is-worst' : ''; const announcement = state.includes('best') ? t('moduleComparison.best') : state.includes('worst') ? t('moduleComparison.worst') : ''; return <td key={metric.key} className={state} aria-label={announcement || undefined} title={announcement || undefined}>{state && <span className="comparison-value-marker" aria-hidden="true">{state.includes('best') ? '↑' : '↓'}</span>}{formatMetric(value, metric, locale)}</td>; })}
    </tr>; })}</tbody>
  </table></div>;
}
