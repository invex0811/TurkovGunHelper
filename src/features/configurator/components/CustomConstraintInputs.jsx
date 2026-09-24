import { useId, useMemo, useRef, useState } from 'react';
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

function ConstraintValueInput({
  axis,
  onChange,
  profile,
  t,
  value,
  weapon,
}) {
  const [draft, setDraft] = useState(null);
  const cancelEditRef = useRef(false);
  const label = t(`ui.radar.axis.${axis.key}`);
  const inputId = useId();
  const directionId = `${inputId}-direction`;

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
    <div className="custom-constraints__field">
      <label className="custom-constraints__label" htmlFor={inputId}>{label}</label>
      <span id={directionId} className="visually-hidden">
        {t(`ui.radar.constraint.${axis.constraint}`)}
        {axis.allowNoLimit ? `. ${t('config.maxPriceHelp')}` : ''}
      </span>
      <span className={`custom-constraints__control ${axis.unit ? 'has-unit' : ''}`}>
        <span className="custom-constraints__symbol" aria-hidden="true">{axis.constraintSymbol}</span>
        <input
          id={inputId}
          type="number"
          min={axis.range.min}
          max={axis.range.max}
          step={axis.step}
          value={draft ?? (Number.isFinite(value) ? String(value) : '')}
          aria-label={t('ui.radar.value', { label })}
          aria-describedby={directionId}
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
    </div>
  );
}

export default function CustomConstraintInputs({
  onChange,
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
          t={t}
        />
      ))}
    </div>
  );
}
