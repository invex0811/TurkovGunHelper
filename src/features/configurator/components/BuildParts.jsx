import AsyncImage from '../../../ui/AsyncImage.jsx';
import { MaterialSymbol } from '../../../ui/MaterialSymbol.js';
import {
  CriticalModuleBadge,
  WarningIcon,
} from './ConfiguratorPrimitives.jsx';
import { ItemPrice } from './PriceDisplay.jsx';

function formatSignedNumber(value, language) {
  const text = new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(Math.abs(value));
  return `${value > 0 ? '+' : '−'}${text}`;
}

// Stat changes a module brings: ergonomics points and recoil percent.
function getModuleDeltas(item, language, t) {
  const deltas = [];
  const ergonomics = Number(item?.ergonomicsModifier);
  const recoil = Number(item?.recoilModifier);
  if (Number.isFinite(ergonomics) && ergonomics !== 0) {
    deltas.push({
      key: 'ergonomics',
      text: `${formatSignedNumber(ergonomics, language)} ${t('config.delta.ergonomics')}`,
      tone: ergonomics > 0 ? 'good' : 'bad',
    });
  }
  if (Number.isFinite(recoil) && recoil !== 0) {
    deltas.push({
      key: 'recoil',
      text: `${formatSignedNumber(recoil, language)}% ${t('config.delta.recoil')}`,
      tone: recoil < 0 ? 'good' : 'bad',
    });
  }
  return deltas;
}

function EmptyCriticalRow({ formatPartName, part, t }) {
  return (
    <li>
      <article className="part-card part-card--critical part-card--empty-critical">
        <div className="part-card__media part-card__media--warning">
          <WarningIcon className="part-card__warning-icon" />
        </div>
        <div className="part-card__body">
          <div className="part-card__slotline">
            <span className="part-card__slot">{part.slotName}</span>
            <CriticalModuleBadge t={t} />
          </div>
          <h4 className="part-card__empty-warning">{part.emptyWarning}</h4>
          <span className="part-card__slot-context">
            {formatPartName(part.parentItem?.shortName || part.parentItem?.name, part.parentItem)}
          </span>
        </div>
      </article>
    </li>
  );
}

function PartRow({
  activeReplacePartId,
  formatPartName,
  language,
  onOpenReplacement,
  onToggleOwned,
  part,
  t,
}) {
  const itemName = part.item.name || part.item.shortName;
  const title = part.isWeapon
    ? formatPartName(part.item.shortName, part.item)
    : formatPartName(itemName, part.item);
  // The group heading already names the slot; rows repeat only a sub-slot.
  const slot = part.isWeapon ? null : part.slotLabel;
  const deltas = part.isWeapon ? [] : getModuleDeltas(part.item, language, t);
  const ownedLabel = t('ownedItems.toggle', { item: itemName });

  return (
    <li>
      <article
        className={[
          'part-card',
          part.isCritical ? 'part-card--critical' : '',
          part.isOwned ? 'part-card--owned' : '',
        ].filter(Boolean).join(' ')}
      >
        <div className="part-card__media">
          <AsyncImage
            src={part.item.image512pxLink || part.item.iconLink}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            containerStyle={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}
          />
        </div>
        <div className="part-card__body">
          {(slot || part.isCritical) && (
            <div className="part-card__slotline">
              {slot && <span className="part-card__slot">{slot}</span>}
              {part.isCritical && <CriticalModuleBadge t={t} />}
            </div>
          )}
          <h4 title={itemName}>{title}</h4>
          {part.isWeapon && part.item.name && (
            <span className="part-card__slot-context">{part.item.name}</span>
          )}
          {deltas.length > 0 && (
            <span className="part-card__deltas">
              {deltas.map(delta => (
                <span key={delta.key} className={`part-card__delta is-${delta.tone}`}>{delta.text}</span>
              ))}
            </span>
          )}
        </div>
        <div className="part-card__price-wrap">
          <ItemPrice priceInfo={part.priceInfo} />
        </div>
        <div className="part-card__actions">
          <label className="owned-toggle" title={t('ownedItems.owned')}>
            <input
              type="checkbox"
              className="owned-toggle__input"
              checked={part.isOwned}
              aria-label={ownedLabel}
              onClick={event => event.stopPropagation()}
              onChange={() => onToggleOwned(part)}
            />
            <MaterialSymbol name="check" className="owned-toggle__icon" />
          </label>
          {!part.isWeapon && (
            <button
              className={`icon-btn icon-btn--sm replace-btn${activeReplacePartId === part.item.id ? ' is-active' : ''}`}
              type="button"
              aria-label={t('config.replace')}
              title={t('config.replace')}
              onClick={event => {
                event.stopPropagation();
                onOpenReplacement(part, event.currentTarget);
              }}
            >
              <MaterialSymbol name="swap_horiz" />
            </button>
          )}
        </div>
      </article>
    </li>
  );
}

export default function BuildParts({
  activeReplacePartId,
  buildExists,
  canShowBuildDetails,
  generating,
  groups,
  language,
  onOpenReplacement,
  onToggleOwned,
  formatPartName,
  t,
}) {
  const hasCritical = groups.some(group => group.parts.some(part => part.isCritical));

  return (
    <>
      {!generating && canShowBuildDetails && groups.map(group => (
        <div key={group.key} className="parts-group">
          <div className="parts-group__head">
            <h3>{group.rootSlotName}</h3>
            <span>{t('config.parts', { count: group.parts.length })}</span>
          </div>
          <ul className="parts-grid">
            {group.parts.map(part => (part.isEmpty ? (
              <EmptyCriticalRow key={part.key} formatPartName={formatPartName} part={part} t={t} />
            ) : (
              <PartRow
                key={part.key}
                activeReplacePartId={activeReplacePartId}
                formatPartName={formatPartName}
                language={language}
                onOpenReplacement={onOpenReplacement}
                onToggleOwned={onToggleOwned}
                part={part}
                t={t}
              />
            )))}
          </ul>
        </div>
      ))}

      {!generating && canShowBuildDetails && hasCritical && (
        <p className="parts-panel__note">
          <span className="parts-panel__note-dot" aria-hidden="true" />
          {t('config.criticalExplained')}
        </p>
      )}

      {!generating && !buildExists && (
        <div className="parts-panel__empty">
          {t('config.emptyBuild')}
        </div>
      )}
    </>
  );
}
