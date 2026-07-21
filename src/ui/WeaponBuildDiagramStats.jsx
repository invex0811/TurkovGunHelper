import { normalizeStatPercent } from './weaponStatMeters.js';

function DiagramStatRow({ label, value, displayValue = value, range }) {
  const hasNumericValue = typeof value === 'number' && Number.isFinite(value);
  const percent = normalizeStatPercent(value, range.min, range.max);
  const accessibleValue = hasNumericValue
    ? Math.min(range.max, Math.max(range.min, value))
    : undefined;

  return (
    <div className={`stat-row stat-row--${range.direction} weapon-diagram-stats__row`}>
      <span>{label}</span>
      <div
        className="bar"
        role="meter"
        aria-label={label}
        aria-valuemin={range.min}
        aria-valuemax={range.max}
        aria-valuenow={accessibleValue}
        aria-valuetext={hasNumericValue ? undefined : 'Not available'}
      >
        <span
          className="bar__gradient"
          style={{ '--meter-value': `${percent}%` }}
          aria-hidden="true"
        />
      </div>
      <strong>{displayValue}</strong>
    </div>
  );
}

export default function WeaponBuildDiagramStats({ stats = [] }) {
  if (stats.length === 0) return null;

  return (
    <section className="weapon-diagram-stats" aria-label="Current weapon stats">
      {stats.map(({ key, ...stat }) => <DiagramStatRow key={key} {...stat} />)}
    </section>
  );
}
