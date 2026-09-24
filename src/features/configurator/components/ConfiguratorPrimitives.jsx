import { useId, useState } from 'react';
import { normalizeStatFillPercent } from '../../../ui/weaponStatMeters.js';
import { getInlineMessageA11y } from '../configuratorNotifications.js';
import { MaterialSymbol } from '../../../ui/MaterialSymbol.js';

export function WarningIcon({ className = '' }) {
  return <MaterialSymbol name="warning" className={className} />;
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
  return <MaterialSymbol name="error" />;
}

function InfoIcon() {
  return <MaterialSymbol name="info" />;
}

function SuccessIcon() {
  return <MaterialSymbol name="check_circle" />;
}

const MESSAGE_ICONS = {
  error: ErrorIcon,
  warning: WarningIcon,
  info: InfoIcon,
  success: SuccessIcon,
};

// Shows on hover and keyboard focus; a tap pins it for touch screens and
// Escape hides it until the pointer or focus leaves.
export function InfoTooltip({ label, children }) {
  const tooltipId = useId();
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const reset = () => {
    setPinned(false);
    setDismissed(false);
  };

  return (
    <span
      className="info-tooltip"
      data-pinned={pinned || undefined}
      data-dismissed={dismissed || undefined}
      onMouseLeave={() => setDismissed(false)}
    >
      <button
        type="button"
        className="info-tooltip__trigger"
        aria-label={label}
        aria-describedby={tooltipId}
        onClick={() => {
          setDismissed(false);
          setPinned(current => !current);
        }}
        onBlur={reset}
        onKeyDown={event => {
          if (event.key !== 'Escape') return;
          setPinned(false);
          setDismissed(true);
        }}
      >
        <InfoIcon />
      </button>
      <span id={tooltipId} role="tooltip" className="info-tooltip__bubble">{children}</span>
    </span>
  );
}

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
