import { useMemo, useState } from 'react';

import { getPurchasePriceValue } from '../data/price/priceMapper.js';
import { getSlotOptionComparison } from './weaponBuildSlotStats.js';

function getItemName(item) {
  return item?.name || item?.shortName || 'Unknown module';
}

function formatPrice(item, priceMode, includeTraderPrices) {
  const price = getPurchasePriceValue(
    item,
    { priceMode, includeTraderPrices },
    Number.POSITIVE_INFINITY,
  );
  return Number.isFinite(price) ? `${Math.round(price).toLocaleString('en-US')} ₽` : 'Price unavailable';
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
    <aside className="weapon-slot-panel" aria-label={`Edit slot ${slotContext.slot.name}`}>
      <header className="weapon-slot-panel__head">
        <div>
          <span>Edit slot</span>
          <h3>{slotContext.slot.name}</h3>
          <p>{getItemName(parentItem)}</p>
        </div>
        <button className="btn btn--ghost" type="button" onClick={onClose} aria-label="Close module selection panel">×</button>
      </header>

      <div className="weapon-slot-panel__body">
        {currentItem && (
          <section className="weapon-slot-panel__current" aria-label="Current module">
            <span>Installed</span>
            <strong>{getItemName(currentItem)}</strong>
            <small>{formatPrice(currentItem, priceMode, includeTraderPrices)}</small>
          </section>
        )}

        <label className="weapon-slot-panel__search">
          <span>Search by name</span>
          <input
            type="search"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Enter module name"
          />
        </label>

        {error && <div className="weapon-slot-panel__notice is-error" role="alert">{error}</div>}
        {feedback && <div className="weapon-slot-panel__notice is-success" role="status">{feedback}</div>}

        {pendingPlan && (
          <div className="weapon-slot-panel__warning" role="alert">
            <strong>The following incompatible child modules will be removed:</strong>
            <span>{pendingPlan.removedItems.map(getItemName).join(', ')}</span>
            <div>
              <button className="btn btn--primary" type="button" onClick={onConfirmPlan}>Continue</button>
              <button className="btn btn--ghost" type="button" onClick={onCancelPlan}>Cancel</button>
            </div>
          </div>
        )}

        <div className="weapon-slot-panel__list" aria-live="polite">
          {isLoading && <div className="weapon-slot-panel__empty">Loading compatible modules…</div>}
          {!isLoading && filteredItems.length === 0 && (
            <div className="weapon-slot-panel__empty">
              {compatibleItems.length === 0 ? 'No compatible modules are available for this slot.' : 'No modules match your search.'}
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
                aria-label={`${isCurrent ? 'Current module' : 'Install'} ${getItemName(item)}`}
              >
                <span className="weapon-slot-option__image" aria-hidden="true">
                  {item.image512pxLink || item.iconLink ? <img src={item.image512pxLink || item.iconLink} alt="" loading="lazy" /> : '—'}
                </span>
                <span className="weapon-slot-option__body">
                  <strong>{getItemName(item)}</strong>
                  <span className="weapon-slot-option__stats">
                    {comparison.stats.map(stat => (
                      <span className="weapon-slot-option__stat" key={stat.key}>
                        {stat.label}:{' '}
                        <strong className={`is-${stat.tone}`}>{stat.text}</strong>
                      </span>
                    ))}
                  </span>
                </span>
                <span className="weapon-slot-option__meta">
                  <small>{formatPrice(item, priceMode, includeTraderPrices)}</small>
                  <em className={`is-${comparison.priceTone}`}>{comparison.priceDiffText}</em>
                  {isCurrent && <span className="weapon-slot-option__badge">Current</span>}
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
              title={slotContext.slot.required === true ? 'A required module can only be replaced' : undefined}
            >
              Remove module
            </button>
            {slotContext.slot.required === true && <small>A required slot cannot be left empty.</small>}
          </div>
        )}
      </div>
    </aside>
  );
}
