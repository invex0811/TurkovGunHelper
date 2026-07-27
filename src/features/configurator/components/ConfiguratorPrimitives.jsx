import { normalizeStatPercent } from '../../../ui/weaponStatMeters.js';

export function WarningIcon({ className = '' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M10.3 3.7 2.4 17.4A1.8 1.8 0 0 0 4 20h16a1.8 1.8 0 0 0 1.6-2.6L13.7 3.7a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function CriticalModuleBadge({ t }) {
  return (
    <span className="critical-module-badge" title={t('config.critical')}>
      <WarningIcon className="critical-module-badge__icon" />
      {t('config.critical')}
    </span>
  );
}

export function InlineMessage({ type = 'info', title, children }) {
  const isError = type === 'error';
  const isWarning = type === 'warning';
  const borderColor = isError
    ? 'var(--color-accent-red)'
    : isWarning
      ? 'var(--color-accent-gold-dark)'
      : 'var(--color-border-active)';

  return (
    <div
      style={{
        backgroundColor: isError ? 'rgba(205, 30, 47, 0.12)' : 'rgba(154, 136, 102, 0.12)',
        borderLeft: `4px solid ${borderColor}`,
        padding: '0.75rem 1rem',
        marginBottom: '1rem',
        borderRadius: 'var(--radius-sm)',
        fontSize: '0.9rem',
      }}
    >
      {title && (
        <strong style={{ display: 'block', marginBottom: '0.25rem' }}>
          {title}
        </strong>
      )}
      <span style={{ color: 'var(--color-text-main)' }}>{children}</span>
    </div>
  );
}

export function StatMeterRow({ label, value, displayValue = value, range, t }) {
  const hasNumericValue = typeof value === 'number' && Number.isFinite(value);
  const percent = normalizeStatPercent(value, range.min, range.max);
  const accessibleValue = hasNumericValue
    ? Math.min(range.max, Math.max(range.min, value))
    : undefined;

  return (
    <div className={`stat-row stat-row--${range.direction}`}>
      <span>{label}</span>
      <div
        className="bar"
        role="meter"
        aria-label={label}
        aria-valuemin={range.min}
        aria-valuemax={range.max}
        aria-valuenow={accessibleValue}
        aria-valuetext={hasNumericValue ? undefined : t('config.notAvailable')}
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
