import { useId } from 'react';
import { normalizeStatFillPercent } from '../../../ui/weaponStatMeters.js';
import { getInlineMessageA11y } from '../configuratorNotifications.js';

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

function ErrorIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6m0-6-6 6" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10h.01" />
    </svg>
  );
}

function SuccessIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16 9" />
    </svg>
  );
}

const MESSAGE_ICONS = {
  error: ErrorIcon,
  warning: WarningIcon,
  info: InfoIcon,
  success: SuccessIcon,
};

export function InlineMessage({
  type = 'info',
  title,
  children,
  details = [],
}) {
  const titleId = useId();
  const { role, ariaLive } = getInlineMessageA11y(type);
  const Icon = MESSAGE_ICONS[type] || InfoIcon;

  return (
    <div
      className={`inline-message inline-message--${type}`}
      role={role}
      aria-live={ariaLive}
      aria-labelledby={title ? titleId : undefined}
    >
      <div className="inline-message__icon"><Icon /></div>
      <div className="inline-message__content">
        {title && <strong className="inline-message__title" id={titleId}>{title}</strong>}
        <div className="inline-message__body">
          {children}
          {details.length > 0 && (
            <ul className="inline-message__list">
              {details.map(detail => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function StatMeterRow({ label, value, displayValue = value, range, t }) {
  const hasNumericValue = typeof value === 'number' && Number.isFinite(value);
  const percent = normalizeStatFillPercent(value, range);
  const accessibleValue = hasNumericValue
    ? Math.min(range.max, Math.max(range.min, value))
    : undefined;

  return (
    <div className={`stat-row stat-row--${range.direction}${range.invertFill ? ' stat-row--inverted-fill' : ''}`}>
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
