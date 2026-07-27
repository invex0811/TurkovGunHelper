import AsyncImage from '../../../ui/AsyncImage.jsx';
import { TarkovDevItemLink } from '../../../ui/TarkovDevItemLink.js';
import {
  InlineMessage,
  StatMeterRow,
} from './ConfiguratorPrimitives.jsx';

export default function WeaponSummary({
  activeSavedBuildId,
  canSave,
  currentPrice,
  marketPrice,
  onOpenDiagram,
  onSave,
  onSaveNameChange,
  priceMode,
  requiredModuleCount,
  saveFeedback,
  saveName,
  statMeters,
  summaryStatus,
  t,
  weapon,
}) {
  return (
    <section className="panel weapon">
      <div className="weapon__head">
        <div>
          <h2>{weapon.shortName}</h2>
          <p>{weapon.name}</p>
        </div>
        <div className="source">
          <span>{t(`config.price.${priceMode}Short`)}</span>
          <span className="source__separator" aria-hidden="true">·</span>
          <TarkovDevItemLink
            weapon={weapon}
            title={t('config.tarkovDevLinkTitle')}
            ariaLabel={t('config.tarkovDevLinkAria', {
              weapon: weapon.name || weapon.shortName || t('config.weapon'),
            })}
            fallbackWeaponName={t('config.weapon')}
          />
          <span className="source__separator" aria-hidden="true">·</span>
          <span>{summaryStatus}</span>
        </div>
      </div>

      <div className="weapon__image">
        <AsyncImage
          src={weapon.properties?.defaultPreset?.image512pxLink
            || weapon.image512pxLink
            || weapon.iconLink}
          alt={weapon.shortName}
          style={{ maxWidth: '100%', maxHeight: '250px', objectFit: 'contain' }}
          containerStyle={{ minHeight: '200px' }}
        />
      </div>

      <div className="stat-compare">
        {statMeters.map(({ key, ...stat }) => (
          <StatMeterRow key={key} {...stat} t={t} />
        ))}
      </div>

      <div className="weapon-diagram-trigger">
        <button className="btn btn--ghost" type="button" onClick={onOpenDiagram}>
          {t('config.diagram')}
        </button>
      </div>

      <div className="weapon__actions">
        <div className="price-box">
          <span className="price-title">{t('ownedItems.remainingTotal', { price: '' })}</span>
          <span className="price-amount">{currentPrice}</span>
          {Number.isFinite(marketPrice) && (
            <small>{t('ownedItems.marketTotal', {
              price: `${Math.round(marketPrice).toLocaleString('en-US')} ₽`,
            })}</small>
          )}
        </div>
        {requiredModuleCount > 0 && (
          <div className="chip">
            {t('config.required')}
            <strong>{t('config.modulesCount', { count: requiredModuleCount })}</strong>
          </div>
        )}

        {canSave && (
          <div className="save-build-bar">
            <label htmlFor="saveBuildName">
              <span>{t('config.buildName')}</span>
              <input
                id="saveBuildName"
                type="text"
                maxLength={80}
                value={saveName}
                onChange={event => onSaveNameChange(event.target.value)}
                placeholder={t('config.saveNameDefault', {
                  weapon: weapon.shortName || weapon.name,
                })}
              />
            </label>
            <button className="btn btn--primary" type="button" onClick={onSave}>
              {activeSavedBuildId ? t('config.update') : t('config.save')}
            </button>
          </div>
        )}

        {saveFeedback && (
          <InlineMessage
            type={saveFeedback.type}
            title={saveFeedback.type === 'error'
              ? t('config.saveFailedTitle')
              : t('config.savedLocalTitle')}
          >
            {saveFeedback.message}
          </InlineMessage>
        )}
      </div>
    </section>
  );
}
