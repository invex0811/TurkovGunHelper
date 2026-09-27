import AsyncImage from '../../../ui/AsyncImage.jsx';
import { MaterialSymbol } from '../../../ui/MaterialSymbol.js';
import {
  InlineMessage,
  StatTile,
} from './ConfiguratorPrimitives.jsx';

function formatRubles(value, language) {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 0 }).format(Math.round(value));
}

function PriceFigure({ allPurchased, language, t, value }) {
  if (allPurchased) return t('ownedItems.allPurchased');
  if (!Number.isFinite(value)) return t('config.notAvailable');
  return (
    <>
      {formatRubles(value, language)}
      <span className="price-amount__currency"> ₽</span>
    </>
  );
}

export default function WeaponSummary({
  activeSavedBuildId,
  allPurchased,
  canSave,
  goalLabel,
  hasBuild,
  language,
  marketPrice,
  moduleCount,
  onSave,
  onSaveNameChange,
  priceSourceLabel,
  remainingPrice,
  saveFeedback,
  saveName,
  statMeters,
  t,
  weapon,
}) {
  const hasMarketPrice = Number.isFinite(marketPrice);
  const ownedPrice = hasMarketPrice && Number.isFinite(remainingPrice)
    ? Math.max(0, marketPrice - remainingPrice)
    : null;
  const ownedShare = hasMarketPrice && marketPrice > 0 && ownedPrice !== null
    ? Math.min(100, (ownedPrice / marketPrice) * 100)
    : 0;

  return (
    <div className="config-center">
      <section className="panel weapon" aria-label={t('config.buildStats')}>
        <div className="weapon__image reticle">
          <span className="weapon__image-caption">
            {hasBuild ? t('config.finalBuild', { count: moduleCount }) : t('config.bareWeapon')}
          </span>
          {goalLabel && <span className="weapon__image-goal tag tag--gold">{goalLabel}</span>}
          <AsyncImage
            src={weapon.properties?.defaultPreset?.image512pxLink
              || weapon.image512pxLink
              || weapon.iconLink}
            alt={weapon.shortName}
            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            containerStyle={{ height: '100%' }}
          />
        </div>

        <div className="stat-compare">
          {statMeters.map(({ key, ...stat }) => (
            <StatTile key={key} {...stat} t={t} />
          ))}
        </div>
        <div className="stat-legend" aria-hidden="true">
          <span><span className="stat-legend__base" />{t('config.legend.base')}</span>
          <span><span className="stat-legend__swatch is-better" />{t('config.legend.better')}</span>
          <span><span className="stat-legend__swatch is-worse" />{t('config.legend.worse')}</span>
        </div>
      </section>

      <section className="panel price-box" aria-label={t('config.price')}>
        <div className="price-box__figures">
          <div className="price-box__figure price-box__figure--main">
            <span className="price-title">{t('config.price.remaining')}</span>
            <span className="price-amount">
              <PriceFigure allPurchased={allPurchased} language={language} t={t} value={remainingPrice} />
            </span>
          </div>
          {hasMarketPrice && (
            <div className="price-box__figure">
              <span className="price-title">{t('config.price.total')}</span>
              <span className="price-box__value">{formatRubles(marketPrice, language)} ₽</span>
            </div>
          )}
          {ownedPrice !== null && (
            <div className="price-box__figure">
              <span className="price-title">{t('config.price.owned')}</span>
              <span className="price-box__value price-box__value--muted">{formatRubles(ownedPrice, language)} ₽</span>
            </div>
          )}
        </div>
        {priceSourceLabel && <p className="price-box__source">{priceSourceLabel}</p>}
        {hasMarketPrice && (
          <div className="price-split" aria-hidden="true">
            {ownedShare > 0 && <span className="price-split__owned" style={{ width: `${ownedShare}%` }} />}
            {ownedShare < 100 && <span className="price-split__buy" />}
          </div>
        )}

        {canSave && (
          <div className="save-build-bar">
            <label className="save-build-bar__field" htmlFor="saveBuildName">
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
            <button className="btn btn--outline" type="button" onClick={onSave}>
              <MaterialSymbol name="bookmark" className="btn__icon" />
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
      </section>
    </div>
  );
}
