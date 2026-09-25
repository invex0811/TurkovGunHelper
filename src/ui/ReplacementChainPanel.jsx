import { useMemo, useState } from 'react';
import { useI18n } from '../i18n/useI18n.js';

import { getPurchasePriceValue } from '../data/price/priceMapper.js';
import { MaterialSymbol } from './MaterialSymbol.js';
import { getSlotPlanErrorMessage } from './slotPlanErrors.js';
import { useReplacementChains } from './useReplacementChains.js';
import { getPackageComparison, getSlotOptionComparison } from './weaponBuildSlotStats.js';

function getItemName(item) {
  return item?.shortName || item?.name || '—';
}

function formatPriceValue(price, t) {
  return Number.isFinite(price)
    ? `${Math.round(price).toLocaleString('en-US')} ₽`
    : t('ui.slot.priceUnavailable');
}

function getItemSearchText(item) {
  return `${item?.name || ''} ${item?.shortName || ''}`.toLocaleLowerCase('en');
}

const SORT_MODES = ['goal', 'price', 'ergonomics', 'recoil', 'weight'];

function getSortValue(plan, sortMode) {
  if (sortMode === 'price') return plan.chainPrice ?? Number.POSITIVE_INFINITY;
  if (sortMode === 'ergonomics') return -(plan.stats.ergonomics ?? 0);
  if (sortMode === 'recoil') return plan.stats.recoilVertical ?? Number.POSITIVE_INFINITY;
  if (sortMode === 'weight') return Number(plan.stats.weight);
  return 0;
}

// Plans arrive ranked by the build goal; other modes keep that order on ties.
function sortPlans(plans, sortMode) {
  if (sortMode === 'goal') return plans;
  return plans
    .map((plan, goalRank) => ({ plan, goalRank, value: getSortValue(plan, sortMode) }))
    .sort((first, second) => (first.value - second.value) || (first.goalRank - second.goalRank))
    .map(entry => entry.plan);
}

function getPathKey(path, slotIndex) {
  return [...path, slotIndex].join('/');
}

function ItemImage({ item }) {
  const src = item?.image512pxLink || item?.iconLink;
  return (
    <span className="weapon-slot-option__image" aria-hidden="true">
      {src ? <img src={src} alt="" loading="lazy" /> : '—'}
    </span>
  );
}

function ComparisonStats({ comparison, t }) {
  return (
    <span className="weapon-slot-option__stats">
      {comparison.stats.map(stat => (
        <span className="weapon-slot-option__stat" key={stat.key}>
          {t(`ui.slot.stat.${stat.key}`)}:{' '}
          <strong className={`is-${stat.tone}`}>{stat.text}</strong>
        </span>
      ))}
    </span>
  );
}

function ChainSlotPicker({
  planner,
  chain,
  parentPath,
  slot,
  slotIndex,
  currentItem,
  weapon,
  priceOptions,
  onPick,
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const options = useMemo(
    () => planner.getSlotOptions(chain, parentPath, slotIndex),
    [chain, parentPath, planner, slotIndex],
  );
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('en');
    const matches = normalizedQuery
      ? options.filter(item => `${item.name || ''} ${item.shortName || ''}`.toLocaleLowerCase('en').includes(normalizedQuery))
      : options;
    return [...matches].sort((first, second) => (
      getPurchasePriceValue(first, priceOptions, Number.POSITIVE_INFINITY)
      - getPurchasePriceValue(second, priceOptions, Number.POSITIVE_INFINITY)
    ));
  }, [options, priceOptions, query]);

  return (
    <li className="replacement-chain__picker">
      <label className="weapon-slot-panel__search">
        <span>{t('ui.chain.chooseFor', { slot: slot.name })}</span>
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={t('ui.slot.searchPlaceholder')}
          autoFocus
        />
      </label>
      <div className="replacement-chain__options">
        {currentItem && slot.required !== true && (
          <button className="btn btn--ghost replacement-chain__clear" type="button" onClick={() => onPick(null)}>
            {t('ui.chain.leaveEmpty')}
          </button>
        )}
        {filteredOptions.length === 0 && (
          <div className="weapon-slot-panel__empty">
            {options.length === 0 ? t('ui.chain.noOptions') : t('ui.slot.noSearchResults')}
          </div>
        )}
        {filteredOptions.map(item => {
          const isCurrent = item.id === currentItem?.id;
          const comparison = getSlotOptionComparison({ item, currentItem, weapon, ...priceOptions });
          return (
            <button
              className={`weapon-slot-option weapon-slot-option--compact${isCurrent ? ' is-current' : ''}`}
              type="button"
              key={item.id}
              disabled={isCurrent}
              onClick={() => onPick(item)}
              aria-label={isCurrent
                ? t('ui.slot.currentModuleLabel', { name: getItemName(item) })
                : t('ui.slot.install', { name: getItemName(item) })}
            >
              <ItemImage item={item} />
              <span className="weapon-slot-option__body">
                <strong>{getItemName(item)}</strong>
                <ComparisonStats comparison={comparison} t={t} />
              </span>
              <span className="weapon-slot-option__meta">
                <small>{formatPriceValue(comparison.price, t)}</small>
                {isCurrent
                  ? <span className="weapon-slot-option__badge">{t('ui.slot.current')}</span>
                  : <em className={`is-${comparison.priceTone}`}>{comparison.priceDiff === null ? t('ui.slot.differenceUnavailable') : comparison.priceDiffText}</em>}
              </span>
            </button>
          );
        })}
      </div>
    </li>
  );
}

function ChainTree({ planner, chain, weapon, priceOptions, onChange }) {
  const { t } = useI18n();
  const [editingKey, setEditingKey] = useState(null);
  const rows = [];

  function visit(node, path, depth) {
    (node.item.properties?.slots || []).forEach((slot, slotIndex) => {
      const child = node.children.find(candidate => candidate.slotIndex === slotIndex) ?? null;
      const key = getPathKey(path, slotIndex);
      const isEditing = editingKey === key;
      rows.push(
        <li
          className={`replacement-chain__slot${child ? '' : ' is-empty'}`}
          key={key}
          style={{ '--chain-depth': depth }}
        >
          <span className="replacement-chain__slot-name">
            {slot.name}
            {slot.required === true && <span aria-hidden="true">*</span>}
          </span>
          <span className="replacement-chain__item">{child ? getItemName(child.item) : t('ui.chain.emptySlot')}</span>
          {child && (
            <span className={`replacement-chain__origin is-${child.origin}`}>
              {t(`ui.chain.origin.${child.origin}`)}
            </span>
          )}
          <button
            className="btn btn--ghost replacement-chain__change"
            type="button"
            aria-expanded={isEditing}
            aria-label={t('ui.chain.changeSlot', { slot: slot.name })}
            onClick={() => setEditingKey(isEditing ? null : key)}
          >
            {t('ui.chain.change')}
          </button>
        </li>,
      );
      if (isEditing) {
        rows.push(
          <ChainSlotPicker
            key={`${key}:picker`}
            planner={planner}
            chain={chain}
            parentPath={path}
            slot={slot}
            slotIndex={slotIndex}
            currentItem={child?.item ?? null}
            weapon={weapon}
            priceOptions={priceOptions}
            onPick={item => {
              setEditingKey(null);
              onChange(planner.setSlotItem(chain, path, slotIndex, item));
            }}
          />,
        );
      }
      if (child) visit(child, [...path, slotIndex], depth + 1);
    });
  }

  visit(chain, [], 0);
  return <ul className="replacement-chain__tree">{rows}</ul>;
}

function ChainEntry({
  planner,
  basePlan,
  isBest,
  isExpanded,
  showProfiles,
  editedChain,
  weapon,
  priceOptions,
  validateBuild,
  onToggle,
  onEdit,
  onApply,
}) {
  const { t } = useI18n();
  const [applyError, setApplyError] = useState(null);
  const plan = useMemo(
    () => (editedChain ? planner.planChain(editedChain) : basePlan),
    [basePlan, editedChain, planner],
  );
  const comparison = useMemo(
    () => getPackageComparison({ items: plan.chainItems, currentItems: plan.currentItems, weapon, ...priceOptions }),
    [plan, priceOptions, weapon],
  );
  const problems = useMemo(() => {
    const messages = plan.errors.map(error => getSlotPlanErrorMessage(error, t));
    if (plan.missingRequiredSlots.length > 0) {
      messages.push(t('ui.chain.missingRequired', {
        slots: plan.missingRequiredSlots.map(entry => entry.slot.name).join(', '),
      }));
    }
    if (messages.length === 0 && validateBuild) messages.push(...validateBuild(plan.buildParts));
    return [...new Set(messages)];
  }, [plan, t, validateBuild]);
  const titleItem = plan.focusItem;
  const attachedNames = plan.chainItems.filter(item => item !== titleItem).map(getItemName);
  const detailsId = `replacement-chain-${plan.key.replace(/[^\w-]/g, '-')}`;

  return (
    <div className={`replacement-chain${isExpanded ? ' is-expanded' : ''}`}>
      <button
        className="weapon-slot-option replacement-chain__summary"
        type="button"
        aria-expanded={isExpanded}
        aria-controls={detailsId}
        aria-label={t(isExpanded ? 'ui.chain.collapse' : 'ui.chain.expand', { name: getItemName(titleItem) })}
        onClick={onToggle}
      >
        <ItemImage item={titleItem} />
        <span className="weapon-slot-option__body">
          <strong>
            {problems.length > 0 && <MaterialSymbol name="warning" className="replacement-chain__warning-icon" />}
            {getItemName(titleItem)}
          </strong>
          <span className="replacement-chain__composition">
            {t('ui.chain.modules', { count: plan.chainItems.length })}
            {attachedNames.length > 0 && `: ${attachedNames.join(' + ')}`}
          </span>
          {showProfiles && (
            <span className="replacement-chain__profiles">
              {plan.profiles.map(profile => (
                <span className="replacement-chain__profile" key={profile}>{t(`ui.chain.profile.${profile}`)}</span>
              ))}
            </span>
          )}
          <ComparisonStats comparison={comparison} t={t} />
        </span>
        <span className="weapon-slot-option__meta">
          <small>{formatPriceValue(comparison.price, t)}</small>
          <em className={`is-${comparison.priceTone}`}>{comparison.priceDiff === null ? t('ui.slot.differenceUnavailable') : comparison.priceDiffText}</em>
          {isBest && <span className="weapon-slot-option__badge">{t('ui.chain.best')}</span>}
        </span>
      </button>

      {isExpanded && (
        <div className="replacement-chain__details" id={detailsId}>
          <ChainTree
            planner={planner}
            chain={plan.chain}
            weapon={weapon}
            priceOptions={priceOptions}
            onChange={chain => {
              setApplyError(null);
              onEdit(chain);
            }}
          />
          {plan.removedItems.length > 0 && (
            <div className="weapon-slot-panel__empty">
              {t('ui.chain.removed', { items: plan.removedItems.map(getItemName).join(', ') })}
            </div>
          )}
          {(problems.length > 0 || applyError) && (
            <div className="weapon-slot-panel__notice is-error" role="alert">
              {applyError || problems.join(' ')}
            </div>
          )}
          <div className="replacement-chain__actions">
            <button
              className="btn btn--primary"
              type="button"
              disabled={problems.length > 0}
              onClick={() => {
                const errors = onApply(plan) || [];
                setApplyError(errors.length > 0 ? errors.join(' ') : null);
              }}
            >
              {t('ui.chain.apply')}
            </button>
            {editedChain && (
              <button className="btn btn--ghost" type="button" onClick={() => onEdit(null)}>
                {t('ui.chain.reset')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Lists every alternative for a slot as a complete chain: the new module plus
// everything that hangs below it, editable slot by slot before applying.
export default function ReplacementChainPanel({
  planner,
  weapon,
  priceOptions,
  validateBuild,
  onApply,
}) {
  const { t } = useI18n();
  const { plans, completed, total, done } = useReplacementChains(planner);
  const [expandedKey, setExpandedKey] = useState(null);
  const [editedChains, setEditedChains] = useState({});
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState('goal');
  const visiblePlans = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('en');
    const matches = normalizedQuery
      ? plans.filter(plan => plan.chainItems.some(item => getItemSearchText(item).includes(normalizedQuery)))
      : plans;
    return sortPlans(matches, sortMode);
  }, [plans, query, sortMode]);

  if (!planner) return null;
  const replacedItems = plan => plan.currentItems.map(getItemName).join(' + ');

  return (
    <section className="replacement-chains" aria-live="polite">
      <div className="replacement-chains__head">
        <span>{t(planner.isSightAssembly ? 'ui.chain.sightTitle' : 'ui.chain.title', { count: plans.length })}</span>
        <p>{t(planner.isSightAssembly ? 'ui.chain.sightHint' : 'ui.chain.hint')}</p>
        {plans[0]?.currentItems.length > 0 && (
          <p>{t('ui.chain.replacing', { items: replacedItems(plans[0]) })}</p>
        )}
      </div>
      {plans.length > 1 && (
        <div className="replacement-chains__controls">
          {plans.length > 6 && (
            <label className="weapon-slot-panel__search">
              <span>{t('ui.slot.searchByName')}</span>
              <input
                type="search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder={t('ui.slot.searchPlaceholder')}
              />
            </label>
          )}
          <label className="weapon-slot-panel__search replacement-chains__sort">
            <span>{t('ui.chain.sort')}</span>
            <select value={sortMode} onChange={event => setSortMode(event.target.value)}>
              {SORT_MODES.map(mode => (
                <option key={mode} value={mode}>{t(`ui.chain.sort.${mode}`)}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      {!done && (
        <div className="weapon-slot-panel__empty" role="status">
          {t('ui.chain.calculating', { done: completed, total })}
        </div>
      )}
      {done && total === 0 && <div className="weapon-slot-panel__empty">{t('ui.chain.empty')}</div>}
      {done && total > 0 && visiblePlans.length === 0 && (
        <div className="weapon-slot-panel__empty">{t('ui.slot.noSearchResults')}</div>
      )}
      <div className="replacement-chains__list">
        {visiblePlans.map(plan => {
          const key = plan.key;
          return (
            <ChainEntry
              key={key}
              planner={planner}
              basePlan={plan}
              isBest={done && plan === plans[0] && plans.length > 1}
              isExpanded={expandedKey === key}
              showProfiles={!planner.isSightAssembly}
              editedChain={editedChains[key] ?? null}
              weapon={weapon}
              priceOptions={priceOptions}
              validateBuild={validateBuild}
              onToggle={() => setExpandedKey(current => (current === key ? null : key))}
              onEdit={chain => setEditedChains(current => ({ ...current, [key]: chain }))}
              onApply={onApply}
            />
          );
        })}
      </div>
    </section>
  );
}
