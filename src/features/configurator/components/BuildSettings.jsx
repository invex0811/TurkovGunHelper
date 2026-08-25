import AsyncImage from '../../../ui/AsyncImage.jsx';
import CustomBuildRadar from '../../../ui/CustomBuildRadar.jsx';
import {
  CUSTOM_PRIORITY_ATTRIBUTE_KEYS,
  CUSTOM_PRIORITY_ATTRIBUTE_METADATA,
} from '../../../domain/customPriorityAttributes.js';
import { Link } from 'react-router-dom';
import { useRef, useState } from 'react';
import { PriceSource } from './PriceDisplay.jsx';
import TacticalDevicePicker from './TacticalDevicePicker.jsx';
import { scopeSupportsZoom } from '../scopeOptions.js';
import { SCOPE_MODES, SCOPE_NONE_OPTION_ID } from '../scopeSelection.js';
import {
  getAdditionalScopeZoomLevels,
  getCompactScopeZoomLevels,
} from '../scopeZoomDisplay.js';
import { getScopeAutoCopy } from '../scopeAutoCopy.js';

function ModuleRow({ view, action, actionLabel, onAction }) {
  const media = (
    <AsyncImage
      src={view.item.image512pxLink || view.item.iconLink || 'https://via.placeholder.com/48'}
      alt=""
      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      containerStyle={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}
    />
  );

  if (action === 'remove') {
    return (
      <div className="required-module">
        <div className="required-module__media">{media}</div>
        <div className="required-module__body">
          <strong>{view.name}</strong>
          <span>{view.meta}</span>
          <PriceSource priceInfo={view.priceInfo} />
        </div>
        <button className="required-module__remove" type="button" onClick={onAction}>
          {actionLabel}
        </button>
      </div>
    );
  }

  return (
    <button className="module-search-item" type="button" onClick={onAction}>
      <span className="module-search-item__media">{media}</span>
      <span className="module-search-item__body">
        <strong>{view.name}</strong>
        <span>{view.meta}</span>
        <PriceSource priceInfo={view.priceInfo} />
      </span>
      <span className="module-search-item__action">{actionLabel}</span>
    </button>
  );
}

const CHARACTERISTIC_TABS = [
  { id: 'constraints', labelKey: 'config.characteristicConstraints' },
  { id: 'priorities', labelKey: 'config.characteristicPriorities' },
];

function PrioritySelector({
  onMaxPriceBlur,
  onMaxPriceChange,
  onMaxPriceFocus,
  onToggle,
  priorityAttributes,
  priorityMaxPrice,
  priorityMaxPriceDraft,
  t,
}) {
  return (
    <section className="custom-priority-attributes" aria-labelledby="customPriorityAttributesLabel">
      <div className="custom-priority-attributes__head">
        <div>
          <h4 id="customPriorityAttributesLabel" className="field-label">{t('config.priorityAttributes')}</h4>
          <p className="field-help">{t('config.choosePriorityAttributes')}</p>
        </div>
      </div>
      <div className="custom-priority-attributes__choices">
        {CUSTOM_PRIORITY_ATTRIBUTE_KEYS.map(attribute => {
          const selected = priorityAttributes.includes(attribute);
          return (
            <button
              key={attribute}
              className={`custom-priority-attributes__choice ${selected ? 'is-selected' : ''}`}
              type="button"
              aria-pressed={selected}
              disabled={!selected && priorityAttributes.length >= 3}
              onClick={() => onToggle(attribute)}
            >
              {t(CUSTOM_PRIORITY_ATTRIBUTE_METADATA[attribute].labelKey)}
            </button>
          );
        })}
      </div>
      <div className="priority-max-price">
        <label className="field-label" htmlFor="priorityMaxPrice">{t('config.priorityMaxPrice')}</label>
        <span className="priority-max-price__control">
          <input
            id="priorityMaxPrice"
            type="number"
            inputMode="numeric"
            min="0"
            step="1000"
            value={priorityMaxPriceDraft ?? priorityMaxPrice}
            onFocus={event => onMaxPriceFocus(event.currentTarget.value)}
            onChange={event => onMaxPriceChange(event.currentTarget.value)}
            onBlur={event => onMaxPriceBlur(event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
            aria-describedby="priorityMaxPriceHelp"
          />
          <span aria-hidden="true">RUB</span>
        </span>
        <span id="priorityMaxPriceHelp" className="field-help">{t('config.priorityMaxPriceHelp')}</span>
      </div>
      {priorityAttributes.length > 0 && (
        <div className="custom-priority-attributes__selected">
          {priorityAttributes.map(attribute => (
            <span key={attribute} className="custom-priority-attributes__chip">
              {t(CUSTOM_PRIORITY_ATTRIBUTE_METADATA[attribute].labelKey)}
              <button
                type="button"
                onClick={() => onToggle(attribute)}
                aria-label={t('config.removePriorityAttribute', {
                  attribute: t(CUSTOM_PRIORITY_ATTRIBUTE_METADATA[attribute].labelKey),
                })}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function CharacteristicSettings({
  activeCharacteristicMode,
  customExactTargets,
  customProfile,
  onExactChange,
  onCharacteristicModeChange,
  onPriorityMaxPriceBlur,
  onPriorityMaxPriceChange,
  onPriorityMaxPriceFocus,
  onPriorityAttributeToggle,
  priorityAttributes,
  priorityMaxPrice,
  priorityMaxPriceDraft,
  setters,
  t,
  weapon,
}) {
  const tabRefs = useRef({});
  const activeTab = activeCharacteristicMode;

  const selectTab = tab => {
    onCharacteristicModeChange(tab);
    tabRefs.current[tab]?.focus();
  };

  const handleTabKeyDown = event => {
    const currentIndex = CHARACTERISTIC_TABS.findIndex(tab => tab.id === activeTab);
    if (currentIndex === -1) return;

    let nextIndex = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % CHARACTERISTIC_TABS.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + CHARACTERISTIC_TABS.length) % CHARACTERISTIC_TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = CHARACTERISTIC_TABS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    selectTab(CHARACTERISTIC_TABS[nextIndex].id);
  };

  return (
    <section className="custom-characteristic-settings" aria-labelledby="customCharacteristicSettingsTitle">
      <h3 id="customCharacteristicSettingsTitle">{t('config.characteristicSettings')}</h3>
      <div
        className="segmented custom-characteristic-settings__tabs"
        role="tablist"
        aria-label={t('config.characteristicSettings')}
      >
        {CHARACTERISTIC_TABS.map(tab => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={element => { tabRefs.current[tab.id] = element; }}
              id={`customCharacteristicTab-${tab.id}`}
              className={`custom-characteristic-settings__tab ${selected ? 'is-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`customCharacteristicPanel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => onCharacteristicModeChange(tab.id)}
              onKeyDown={handleTabKeyDown}
            >
              <span className="custom-characteristic-settings__tab-content">
                <span className="custom-characteristic-settings__tab-label">{t(tab.labelKey)}</span>
                {tab.id === 'priorities' && (
                  <span className="custom-characteristic-settings__tab-count">
                    {t('config.priorityAttributesCount', { count: priorityAttributes.length })}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <span className="visually-hidden" aria-live="polite" aria-atomic="true">
        {t('config.priorityAttributesAnnouncement', { count: priorityAttributes.length })}
      </span>

      <div
        id="customCharacteristicPanel-constraints"
        className="custom-characteristic-settings__panel"
        role="tabpanel"
        aria-labelledby="customCharacteristicTab-constraints"
        hidden={activeTab !== 'constraints'}
      >
        {activeTab === 'constraints' && (
          <CustomBuildRadar
            profile={customProfile}
            weapon={weapon}
            onChange={setters.customProfile}
            exactTargets={customExactTargets}
            onExactChange={onExactChange}
          />
        )}
      </div>
      <div
        id="customCharacteristicPanel-priorities"
        className="custom-characteristic-settings__panel"
        role="tabpanel"
        aria-labelledby="customCharacteristicTab-priorities"
        hidden={activeTab !== 'priorities'}
      >
        {activeTab === 'priorities' && (
          <PrioritySelector
            onMaxPriceBlur={onPriorityMaxPriceBlur}
            onMaxPriceChange={onPriorityMaxPriceChange}
            onMaxPriceFocus={onPriorityMaxPriceFocus}
            priorityAttributes={priorityAttributes}
            priorityMaxPrice={priorityMaxPrice}
            priorityMaxPriceDraft={priorityMaxPriceDraft}
            onToggle={onPriorityAttributeToggle}
            t={t}
          />
        )}
      </div>
    </section>
  );
}

export default function BuildSettings(props) {
  const {
    availableCapacities,
    activeCharacteristicMode,
    configTab,
    customExactTargets,
    customProfile,
    priorityAttributes,
    generating,
    includeFlashlight,
    includeLaser,
    includeTraderPrices,
    flashlightItems,
    flashlightItemId,
    strictTraderLevels,
    magazineCapacity,
    maxPrice,
    maxPriceDraft,
    maxWeight,
    moduleResults,
    onAddModule,
    onCharacteristicModeChange,
    onExactChange,
    onPriorityAttributeToggle,
    onPriorityMaxPriceBlur,
    onPriorityMaxPriceChange,
    onPriorityMaxPriceFocus,
    priorityMaxPrice,
    priorityMaxPriceDraft,
    onGenerate,
    onIncludeTraderPricesChange,
    onMaxPriceBlur,
    onMaxPriceChange,
    onMaxPriceFocus,
    onMaxWeightChange,
    onRemoveModule,
    onRequiredModuleSearchChange,
    requiredModuleSearch,
    selectedModules,
    setters,
    scopeItems,
    scopeMode,
    scopeItemId,
    scopeZoom,
    scopeZoomLevels,
    suppressorMode,
    targetType,
    tblItems,
    tblItemId,
    t,
    weapon,
  } = props;
  const scopeSelectionId = scopeMode === SCOPE_MODES.NONE
    ? SCOPE_NONE_OPTION_ID
    : scopeMode === SCOPE_MODES.MANUAL
      ? scopeItemId
      : null;
  const [zoomFiltersExpanded, setZoomFiltersExpanded] = useState(false);
  const additionalScopeZoomLevels = getAdditionalScopeZoomLevels(scopeZoomLevels);
  const compactScopeZoomLevels = getCompactScopeZoomLevels(
    scopeZoomLevels,
    scopeZoom,
    zoomFiltersExpanded,
  );
  const scopeAutoCopy = getScopeAutoCopy(
    t,
    scopeMode === SCOPE_MODES.AUTO ? scopeZoom : null,
  );

  return (
    <aside className="config" aria-label={t('config.buildConfiguration')}>
      <div className="config__head"><h2>{t('config.buildConfiguration')}</h2></div>
      <section className="config__section config__section--tabs">
        <div className="segmented segmented--tabs">
          {['basic', 'advanced'].map(value => (
            <button
              key={value}
              className={`segmented__btn ${configTab === value ? 'is-active' : ''}`}
              type="button"
              onClick={() => setters.configTab(value)}
            >
              {t(`config.${value}`)}
            </button>
          ))}
        </div>
      </section>

      {configTab === 'basic' && (
        <>
          <section className="config__section">
            <label className="field-label">{t('config.goal')}</label>
            <div className="segmented segmented--goals">
              {['meta', 'custom'].map(value => (
                <button
                  key={value}
                  className={`segmented__btn ${targetType === value ? 'is-active' : ''}`}
                  type="button"
                  onClick={() => setters.targetType(value)}
                >
                  {t(`config.${value}`)}
                </button>
              ))}
            </div>
          </section>

          <div
            className={`custom-radar-collapse ${targetType === 'custom' ? 'is-open' : ''}`}
            aria-hidden={targetType !== 'custom'}
            inert={targetType !== 'custom'}
          >
            <div className="custom-radar-collapse__inner">
              <CharacteristicSettings
                activeCharacteristicMode={activeCharacteristicMode}
                customExactTargets={customExactTargets}
                customProfile={customProfile}
                onCharacteristicModeChange={onCharacteristicModeChange}
                onExactChange={onExactChange}
                onPriorityAttributeToggle={onPriorityAttributeToggle}
                onPriorityMaxPriceBlur={onPriorityMaxPriceBlur}
                onPriorityMaxPriceChange={onPriorityMaxPriceChange}
                onPriorityMaxPriceFocus={onPriorityMaxPriceFocus}
                priorityAttributes={priorityAttributes}
                priorityMaxPrice={priorityMaxPrice}
                priorityMaxPriceDraft={priorityMaxPriceDraft}
                setters={setters}
                t={t}
                weapon={weapon}
              />
            </div>
          </div>

          <section className="config__section">
            <label className="field-label">{t('config.suppressor')}</label>
            <div className="segmented segmented--three">
              {props.suppressorOptions.map(option => (
                <button
                  key={option.value}
                  className={`segmented__btn ${suppressorMode === option.value ? 'is-active' : ''}`}
                  type="button"
                  onClick={() => setters.suppressorMode(option.value)}
                >
                  {t(option.label)}
                </button>
              ))}
            </div>
          </section>

          <section className="config__section">
            <div className="checks price-source-checks">
              <label className="check" htmlFor="includeTraderPrices">
                <input
                  id="includeTraderPrices"
                  type="checkbox"
                  checked={includeTraderPrices}
                  onChange={event => onIncludeTraderPricesChange(event.target.checked)}
                  aria-describedby="includeTraderPricesHelp"
                />
                <span>{t('config.includeTraders')}</span>
              </label>
              <span id="includeTraderPricesHelp" className="field-help">{t('config.helpPrices')}</span>
              {includeTraderPrices && strictTraderLevels && (
                <Link className="strict-trader-badge" to="/settings#traders">
                  <span>{t('traders.strictLevelsActive')}</span>
                  <small>{t('traders.manageLevels')}</small>
                </Link>
              )}
            </div>
          </section>

          {targetType !== 'custom' && (
            <section className="config__section">
              <div className="limit-fields">
                <label className="limit-field" htmlFor="maxWeight">
                  <span className="field-label limit-field__label">{t('config.maxWeight')}</span>
                  <input
                    id="maxWeight"
                    className="limit-field__control"
                    type="number"
                    placeholder={t('config.noLimit')}
                    min="0"
                    max={props.maxWeightLimit}
                    step="0.05"
                    value={maxWeight}
                    onChange={event => onMaxWeightChange(event.target.value)}
                  />
                </label>
                <label className="limit-field" htmlFor="maxBudget">
                  <span className="field-label limit-field__label">{t('config.maxBudget')}</span>
                  <input
                    id="maxBudget"
                    className="limit-field__control"
                    type="number"
                    placeholder={t('config.noLimit')}
                    min="0"
                    max={props.maxPriceLimit}
                    step="1000"
                    value={maxPriceDraft ?? maxPrice}
                    onFocus={event => onMaxPriceFocus(event.currentTarget.value)}
                    onChange={event => onMaxPriceChange(event.currentTarget.value)}
                    onBlur={event => onMaxPriceBlur(event.currentTarget.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                  />
                </label>
              </div>
            </section>
          )}

          <section className="config__section">
            <label className="field-label">{t('config.magazine')}</label>
            <div className="segmented segmented--capacity">
              {availableCapacities.map(capacity => (
                <button
                  key={capacity}
                  className={`segmented__btn ${Number(magazineCapacity) === capacity ? 'is-active' : ''}`}
                  type="button"
                  onClick={() => setters.magazineCapacity(capacity)}
                >
                  {capacity}
                </button>
              ))}
            </div>
          </section>

          <section className="config__section">
            <label className="field-label">{t('config.sight')}</label>
            <TacticalDevicePicker
              id="scopeItem"
              items={scopeItems}
              label={t('config.sight')}
              onChange={setters.scopeSelection}
              selectedItemId={scopeSelectionId}
              showLabel={false}
              indented={false}
              searchLabel={t('config.sight.search')}
              systemOptions={[
                {
                  id: null,
                  label: scopeAutoCopy.label,
                  description: scopeAutoCopy.description,
                },
                { id: SCOPE_NONE_OPTION_ID, label: t('config.sight.none') },
              ]}
              filterItems={item => scopeZoom === null || scopeSupportsZoom(item, scopeZoom)}
              panelControls={(
                <div className="tactical-device-picker__filters" aria-label={t('config.sight.zoomFilters')}>
                  <button
                    className={`tactical-device-picker__filter ${scopeZoom === null ? 'is-active' : ''}`}
                    type="button"
                    aria-pressed={scopeZoom === null}
                    onClick={() => setters.scopeZoom(null)}
                  >
                    {t('config.sight.allZooms')}
                  </button>
                  {compactScopeZoomLevels.map(zoom => (
                    <button
                      key={zoom}
                      className={`tactical-device-picker__filter ${scopeZoom === zoom ? 'is-active' : ''}`}
                      type="button"
                      aria-pressed={scopeZoom === zoom}
                      onClick={() => setters.scopeZoom(zoom)}
                    >
                      {zoom}x
                    </button>
                  ))}
                  <button
                    className={`tactical-device-picker__filter tactical-device-picker__filter--toggle ${zoomFiltersExpanded ? 'is-expanded' : ''}`}
                    type="button"
                    aria-label={zoomFiltersExpanded ? t('config.sight.hideMoreZooms') : t('config.sight.showMoreZooms')}
                    aria-expanded={zoomFiltersExpanded}
                    onClick={() => setZoomFiltersExpanded(expanded => !expanded)}
                  >
                    <span className="tactical-device-picker__filter-chevron" aria-hidden="true" />
                  </button>
                  {zoomFiltersExpanded && additionalScopeZoomLevels.map(zoom => (
                    <button
                      key={zoom}
                      className={`tactical-device-picker__filter ${scopeZoom === zoom ? 'is-active' : ''}`}
                      type="button"
                      aria-pressed={scopeZoom === zoom}
                      onClick={() => setters.scopeZoom(zoom)}
                    >
                      {zoom}x
                    </button>
                  ))}
                </div>
              )}
              t={t}
            />
          </section>

          <section className="config__section">
            <label className="field-label">{t('config.accessories')}</label>
            <div className="checks">
              <label className="check">
                <input
                  type="checkbox"
                  checked={includeLaser}
                  onChange={event => setters.includeLaser(event.target.checked)}
                />
                <span>{t('config.laser')}</span>
              </label>
              {includeLaser && (
                <TacticalDevicePicker
                  id="tblItem"
                  items={tblItems}
                  label={t('config.tactical.tbl')}
                  onChange={setters.tblItemId}
                  selectedItemId={tblItemId}
                  showLabel={false}
                  t={t}
                />
              )}
              <label className="check">
                <input
                  type="checkbox"
                  checked={includeFlashlight}
                  onChange={event => setters.includeFlashlight(event.target.checked)}
                />
                <span>{t('config.flashlight')}</span>
              </label>
              {includeFlashlight && (
                <TacticalDevicePicker
                  id="flashlightItem"
                  items={flashlightItems}
                  label={t('config.tactical.flashlight')}
                  onChange={setters.flashlightItemId}
                  selectedItemId={flashlightItemId}
                  showLabel={false}
                  t={t}
                />
              )}
            </div>
          </section>
        </>
      )}

      {configTab === 'advanced' && (
        <section className="config__section advanced-builder">
          <label className="field-label" htmlFor="requiredModuleSearch">{t('config.modules')}</label>
          <input
            id="requiredModuleSearch"
            type="search"
            placeholder={t('config.searchModules')}
            value={requiredModuleSearch}
            onChange={event => onRequiredModuleSearchChange(event.target.value)}
          />
          {moduleResults.length > 0 && (
            <div className="module-search-list">
              {moduleResults.map(view => (
                <ModuleRow
                  key={view.item.id}
                  view={view}
                  action="add"
                  actionLabel={t('config.add')}
                  onAction={() => onAddModule(view.item)}
                />
              ))}
            </div>
          )}
          <div className="required-modules">
            {selectedModules.length === 0 ? (
              <div className="required-modules__empty">{t('config.noRequiredModules')}</div>
            ) : selectedModules.map(view => (
              <ModuleRow
                key={view.item.id}
                view={view}
                action="remove"
                actionLabel={t('config.remove')}
                onAction={() => onRemoveModule(view.item.id)}
              />
            ))}
          </div>
        </section>
      )}

      <section className="config__section">
        <button
          className="btn btn--primary"
          type="button"
          style={{ width: '100%' }}
          onClick={onGenerate}
          disabled={generating}
        >
          {generating ? t('config.calculating') : t('config.generateBuild')}
        </button>
      </section>
    </aside>
  );
}
