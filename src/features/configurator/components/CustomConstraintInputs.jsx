import { useMemo, useRef, useState } from 'react';
import {
  getCustomBuildRadarAxes,
  updateCustomBuildProfileValue,
} from '../../../ui/customBuildRadar.js';

const CONSTRAINT_KEYS = new Set([
  'weight',
  'verticalRecoil',
  'horizontalRecoil',
  'ergonomics',
]);

function ExactLockIcon({ locked }) {
  return (
    <svg
      className="custom-constraints__exact-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <rect x="5" y="10" width="14" height="10" rx="2" />
      {locked ? (
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      ) : (
        <path d="M8 10V8a4 4 0 0 1 7.5-2" />
      )}
      <circle cx="12" cy="15" r="1" />
    </svg>
  );
}

function ConstraintValueInput({
  axis,
  exact,
  onChange,
  onExactChange,
  profile,
  t,
  value,
  weapon,
}) {
  const [draft, setDraft] = useState(null);
  const cancelEditRef = useRef(false);
  const label = t(`ui.radar.axis.${axis.key}`);

  const commitValue = () => {
    if (cancelEditRef.current) {
      cancelEditRef.current = false;
      setDraft(null);
      return;
    }

    onChange(updateCustomBuildProfileValue(
      profile,
      axis,
      draft ?? value,
      weapon,
    ));
    setDraft(null);
  };

  return (
    <div className={`custom-constraints__field ${exact ? 'is-exact' : ''}`}>
      <span className="custom-constraints__label">{label}</span>
      <span className={`custom-constraints__control ${axis.unit ? 'has-unit' : ''}`}>
        <input
          type="number"
          min={axis.range.min}
          max={axis.range.max}
          step={axis.step}
          value={draft ?? (Number.isFinite(value) ? String(value) : '')}
          aria-label={t('ui.radar.value', { label })}
          onFocus={() => setDraft(Number.isFinite(value) ? String(value) : '')}
          onChange={event => setDraft(event.target.value)}
          onBlur={commitValue}
          onKeyDown={event => {
            if (event.key === 'Enter') event.currentTarget.blur();
            if (event.key === 'Escape') {
              cancelEditRef.current = true;
              event.currentTarget.blur();
            }
          }}
        />
        {axis.unit && <span className="custom-constraints__unit">{axis.unit}</span>}
      </span>
      <label className="custom-constraints__exact-toggle" title={t('ui.radar.exactTooltip')}>
        <input
          type="checkbox"
          checked={exact && !(axis.key === 'weight' && !(value > 0))}
          disabled={axis.key === 'weight' && !(value > 0)}
          aria-label={t('ui.radar.exactTarget', { label })}
          onChange={event => onExactChange(axis.key, event.target.checked)}
        />
        <ExactLockIcon locked={exact} />
      </label>
    </div>
  );
}

export default function CustomConstraintInputs({
  exactTargets = {},
  onChange,
  onExactChange,
  profile,
  t,
  weapon,
}) {
  const axes = useMemo(
    () => getCustomBuildRadarAxes(weapon).filter(axis => CONSTRAINT_KEYS.has(axis.key)),
    [weapon],
  );

  return (
    <div className="custom-constraints__grid">
      {axes.map(axis => (
        <ConstraintValueInput
          key={axis.key}
          axis={axis}
          value={profile[axis.key]}
          profile={profile}
          weapon={weapon}
          onChange={onChange}
          exact={exactTargets[axis.key] === true}
          onExactChange={onExactChange}
          t={t}
        />
      ))}
    </div>
  );
}
