import AsyncImage from '../../../ui/AsyncImage.jsx';
import {
  CriticalModuleBadge,
  WarningIcon,
} from './ConfiguratorPrimitives.jsx';
import { ItemPrice } from './PriceDisplay.jsx';

export default function BuildParts({
  activeReplacePartId,
  buildExists,
  canShowBuildDetails,
  generating,
  groups,
  onOpenReplacement,
  onToggleOwned,
  formatPartName,
  t,
}) {
  return (
    <>
      {!generating && canShowBuildDetails && groups.map(group => (
        <div key={`${group.displayRank}:${group.rootSlotName}`} className="parts-group">
          <div className="parts-group__head">
            <h3>{group.rootSlotName}</h3>
            <span>{t('config.parts', { count: group.parts.length })}</span>
          </div>
          <div className="parts-grid">
            {group.parts.map(part => {
              if (part.isEmpty) {
                return (
                  <article
                    key={part.key}
                    className="part-card part-card--critical part-card--empty-critical"
                  >
                    <div className="part-card__media part-card__media--warning">
                      <WarningIcon className="part-card__warning-icon" />
                    </div>
                    <div className="part-card__body">
                      <div className="part-card__title-wrap">
                        <h4 className="part-card__empty-warning">{part.emptyWarning}</h4>
                        <span className="part-card__slot-context">
                          {part.slotName} ·{' '}
                          {formatPartName(part.parentItem?.shortName || part.parentItem?.name)}
                        </span>
                      </div>
                      <div className="part-card__badges">
                        <CriticalModuleBadge t={t} />
                      </div>
                    </div>
                  </article>
                );
              }

              return (
                <article
                  key={part.key}
                  className={`part-card ${part.isCritical ? 'part-card--critical' : ''} ${part.isOwned ? 'part-card--owned' : ''}`}
                >
                  <div className="part-card__left">
                    <div className="part-card__media">
                      <AsyncImage
                        src={part.item.image512pxLink || part.item.iconLink || 'https://via.placeholder.com/70'}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        containerStyle={{
                          width: '100%',
                          height: '100%',
                          minWidth: 0,
                          minHeight: 0,
                        }}
                      />
                    </div>
                  </div>
                  <div className="part-card__body">
                    <div className="part-card__topline">
                      <div className="part-card__title-wrap">
                        <h4>{formatPartName(part.item.shortName)}</h4>
                        {part.isWeapon && (
                          <span className="part-card__slot-context">
                            {part.item.name || t('ownedItems.baseWeapon')}
                          </span>
                        )}
                      </div>
                      <div className="part-card__price-wrap">
                        <ItemPrice priceInfo={part.priceInfo} />
                      </div>
                    </div>
                    <div className="part-card__details-row">
                      {part.isCritical ? <CriticalModuleBadge t={t} /> : <span />}
                        <label className="check owned-item-toggle">
                          <input
                            type="checkbox"
                            checked={part.isOwned}
                            aria-label={t('ownedItems.toggle', {
                              item: part.item.name || part.item.shortName,
                            })}
                            onClick={event => event.stopPropagation()}
                            onChange={() => onToggleOwned(part)}
                          />
                          <span>{t('ownedItems.owned')}</span>
                        </label>
                    </div>
                    {!part.isWeapon && (
                      <button
                        className={`replace-btn ${activeReplacePartId === part.item.id ? 'active' : ''}`}
                        type="button"
                        onClick={event => {
                          event.stopPropagation();
                          onOpenReplacement(part);
                        }}
                      >
                        {t('config.replace')}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      ))}

      {!generating && !buildExists && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '3rem 2rem',
            border: '1px dashed var(--line)',
            borderRadius: 'var(--radius)',
            color: 'var(--muted)',
            fontSize: '0.95rem',
          }}
        >
          {t('config.emptyBuild')}
        </div>
      )}
    </>
  );
}
