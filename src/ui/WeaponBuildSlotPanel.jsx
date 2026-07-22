import { useMemo, useState } from 'react';
import { useI18n } from '../i18n/useI18n.js';

import { getPurchasePriceValue } from '../data/price/priceMapper.js';
import { getSlotOptionComparison } from './weaponBuildSlotStats.js';

function getItemName(item, t) {
  return item?.name || item?.shortName || t('ui.slot.unknownModule');
}

function formatPrice(item, priceMode, includeTraderPrices, t) {
  const price = getPurchasePriceValue(
    item,
    { priceMode, includeTraderPrices },
    Number.POSITIVE_INFINITY,
  );
  return Number.isFinite(price)
    ? `${Math.round(price).toLocaleString('en-US')} ₽`
    : t('ui.slot.priceUnavailable');
}

export default function WeaponBuildSlotPanel({
  weapon,
  slotContext,
  compatibleItems,
  isLoading,
  error,
  feedback,
  pendingPlan,
  priceMode,
  includeTraderPrices,
  onChoose,
  onRemove,
  onConfirmPlan,
  onCancelPlan,
  onHoverCandidate,
  onFocusCandidate,
  onClose,
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const currentItem = slotContext?.installedNode?.item || null;
  const parentItem = slotContext?.parent?.item || null;
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('en');
    if (!normalizedQuery) return compatibleItems;
    return compatibleItems.filter(item => (
      `${item.name || ''} ${item.shortName || ''}`.toLocaleLowerCase('en').includes(normalizedQuery)
    ));
  }, [compatibleItems, query]);

  if (!slotContext) return null;

  return (
    <aside className="weapon-slot-panel" aria-label={t('ui.slot.editSlotLabel', { name: slotContext.slot.name })}>
      <header className="weapon-slot-panel__head">
        <div>
          <span>{t('ui.slot.editSlot')}</span>
          <h3>{slotContext.slot.name}</h3>
          <p>{getItemName(parentItem, t)}</p>
        </div>
        <button className="btn btn--ghost" type="button" onClick={onClose} aria-label={t('ui.slot.close')}>×</button>
      </header>

      <div className="weapon-slot-panel__body">
        {currentItem && (
          <section className="weapon-slot-panel__current" aria-label={t('ui.slot.currentModule')}>
            <span>{t('ui.slot.installed')}</span>
            <strong>{getItemName(currentItem, t)}</strong>
            <small>{formatPrice(currentItem, priceMode, includeTraderPrices, t)}</small>
          </section>
        )}

        <label className="weapon-slot-panel__search">
          <span>{t('ui.slot.searchByName')}</span>
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={t('ui.slot.searchPlaceholder')}
          />
        </label>

        {error && <div className="weapon-slot-panel__notice is-error" role="alert">{error}</div>}
        {feedback && <div className="weapon-slot-panel__notice is-success" role="status">{feedback}</div>}

        {pendingPlan && (
          <div className="weapon-slot-panel__warning" role="alert">
            <strong>{t('ui.slot.incompatibleRemoved')}</strong>
            <span>{pendingPlan.removedItems.map(item => getItemName(item, t)).join(', ')}</span>
            <div>
              <button className="btn btn--primary" type="button" onClick={onConfirmPlan}>{t('ui.slot.continue')}</button>
              <button className="btn btn--ghost" type="button" onClick={onCancelPlan}>{t('ui.slot.cancel')}</button>
            </div>
          </div>
        )}

        <div className="weapon-slot-panel__list" aria-live="polite">
          {isLoading && <div className="weapon-slot-panel__empty">{t('ui.slot.loading')}</div>}
          {!isLoading && filteredItems.length === 0 && (
            <div className="weapon-slot-panel__empty">
              {compatibleItems.length === 0 ? t('ui.slot.noCompatible') : t('ui.slot.noSearchResults')}
            </div>
          )}
          {!isLoading && filteredItems.map(item => {
            const isCurrent = item.id === currentItem?.id;
            const comparison = getSlotOptionComparison({
              item,
              currentItem,
              weapon,
              priceMode,
              includeTraderPrices,
            });
            return (
              <button
                className={`weapon-slot-option${isCurrent ? ' is-current' : ''}`}
                type="button"
                key={item.id}
                onClick={() => onChoose(item)}
                onPointerEnter={() => onHoverCandidate?.(item)}
                onPointerLeave={() => onHoverCandidate?.(null)}
                onFocus={() => onFocusCandidate?.(item)}
                onBlur={() => onFocusCandidate?.(null)}
                disabled={isCurrent || Boolean(pendingPlan)}
                aria-label={isCurrent
                  ? t('ui.slot.currentModuleLabel', { name: getItemName(item, t) })
                  : t('ui.slot.install', { name: getItemName(item, t) })}
              >
                <span className="weapon-slot-option__image" aria-hidden="true">
                  {item.image512pxLink || item.iconLink ? <img src={item.image512pxLink || item.iconLink} alt="" loading="lazy" /> : '—'}
                </span>
                <span className="weapon-slot-option__body">
                  <strong>{getItemName(item, t)}</strong>
                  <span className="weapon-slot-option__stats">
                    {comparison.stats.map(stat => (
                      <span className="weapon-slot-option__stat" key={stat.key}>
                        {t(`ui.slot.stat.${stat.key}`)}:{' '}
                        <strong className={`is-${stat.tone}`}>{stat.text}</strong>
                      </span>
                    ))}
                  </span>
                </span>
                <span className="weapon-slot-option__meta">
                  <small>{formatPrice(item, priceMode, includeTraderPrices, t)}</small>
                  <em className={`is-${comparison.priceTone}`}>{comparison.priceDiff === null ? t('ui.slot.differenceUnavailable') : comparison.priceDiffText}</em>
                  {isCurrent && <span className="weapon-slot-option__badge">{t('ui.slot.current')}</span>}
                </span>
              </button>
            );
          })}
        </div>

        {currentItem && (
          <div className="weapon-slot-panel__remove">
            <button
              className="btn btn--ghost"
              type="button"
              onClick={onRemove}
              disabled={slotContext.slot.required === true || Boolean(pendingPlan)}
              title={slotContext.slot.required === true ? t('ui.slot.requiredReplace') : undefined}
            >
              {t('ui.slot.remove')}
            </button>
            {slotContext.slot.required === true && <small>{t('ui.slot.requiredEmpty')}</small>}
          </div>
        )}
      </div>
    </aside>
  );
}
