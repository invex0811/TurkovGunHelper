import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AsyncImage from '../../../ui/AsyncImage.jsx';
import {
  CUSTOM_PRIORITY_ATTRIBUTE_KEYS,
  CUSTOM_PRIORITY_ATTRIBUTE_METADATA,
  PRIORITY_SELECTION_MODES,
} from '../../../domain/customPriorityAttributes.js';
import {
  BUILD_GOAL_LABEL_KEYS,
  BUILD_GOAL_MODES,
} from '../buildGoalModes.js';
import { getPriorityWeightMax } from '../priorityWeightControls.js';
import { scopeSupportsZoom } from '../scopeOptions.js';
import { SCOPE_MODES, SCOPE_NONE_OPTION_ID } from '../scopeSelection.js';
import {
  getAdditionalScopeZoomLevels,
  getCompactScopeZoomLevels,
} from '../scopeZoomDisplay.js';
import { getScopeAutoCopy } from '../scopeAutoCopy.js';
import CustomConstraintInputs from './CustomConstraintInputs.jsx';
import { InfoTooltip } from './ConfiguratorPrimitives.jsx';
import { PriceSource } from './PriceDisplay.jsx';
import TacticalDevicePicker from './TacticalDevicePicker.jsx';
import { MaterialSymbol } from '../../../ui/MaterialSymbol.js';

const BUILD_GOAL_OPTIONS = [
  BUILD_GOAL_MODES.META,
  BUILD_GOAL_MODES.CONSTRAINTS,
  BUILD_GOAL_MODES.PRIORITIES,
].map(id => ({ id, labelKey: BUILD_GOAL_LABEL_KEYS[id] }));

// A numbered block of the settings panel: "01 Goal", "02 Suppressor"...
function ConfigSection({ children, className = '', index, title }) {
  return (
    <section className={`config__section ${className}`.trim()}>
      <h3 className="config__section-title">
        <span className="config__section-index" aria-hidden="true">{index}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

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

function PrioritySelector({ onMove, onToggle, priorityAttributes, showHeader = true, t }) {
  return (
    <div className="custom-priority-attributes__selector">
      {showHeader && (
        <>
          <div className="custom-priority-attributes__head">
            <div>
              <h3 id="customPriorityAttributesLabel" className="field-label">
                {t('config.priorityAttributes')}
              </h3>
              <p className="field-help">{t('config.choosePriorityAttributes')}</p>
            </div>
            <span className="custom-priority-attributes__count" aria-hidden="true">
              {t('config.priorityAttributesCount', { count: priorityAttributes.length })}
            </span>
          </div>
        </>
      )}
      <span className="visually-hidden" aria-live="polite" aria-atomic="true">
        {t('config.priorityAttributesAnnouncement', { count: priorityAttributes.length })}
      </span>
      <div className="custom-priority-attributes__choices">
        {CUSTOM_PRIORITY_ATTRIBUTE_KEYS.map(attribute => {
          const selected = priorityAttributes.includes(attribute);
          return (
            <button
              key={attribute}
              className={`custom-priority-attributes__choice ${selected ? 'is-selected' : ''}`}
              type="button"
              aria-pressed={selected}
              disabled={!selected && priorityAttributes.length >= CUSTOM_PRIORITY_ATTRIBUTE_KEYS.length}
              onClick={() => onToggle(attribute)}
            >
              {t(CUSTOM_PRIORITY_ATTRIBUTE_METADATA[attribute].labelKey)}
            </button>
          );
        })}
      </div>
      {priorityAttributes.length > 0 && (
        <ol className="custom-priority-attributes__selected">
          {priorityAttributes.map((attribute, index) => {
            const label = t(CUSTOM_PRIORITY_ATTRIBUTE_METADATA[attribute].labelKey);
            const rank = index + 1;
            return (
              <li key={attribute} className="custom-priority-attributes__item">
                <span className="custom-priority-attributes__rank">
                  {t('config.priorityRank', { rank })}
                </span>
                <span className="custom-priority-attributes__label">{label}</span>
                <span className="custom-priority-attributes__actions">
                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => onMove(index, index - 1)}
                    aria-label={t('config.movePriorityAttributeUp', { attribute: label })}
                  >
                    {t('config.moveUp')}
                  </button>
                  <button
                    type="button"
                    disabled={index === priorityAttributes.length - 1}
                    onClick={() => onMove(index, index + 1)}
                    aria-label={t('config.movePriorityAttributeDown', { attribute: label })}
                  >
                    {t('config.moveDown')}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggle(attribute)}
                    aria-label={t('config.removePriorityAttribute', { attribute: label })}
                  >
                    <MaterialSymbol name="close" />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function getPriorityWeightTotal(priorityWeights) {
  return CUSTOM_PRIORITY_ATTRIBUTE_KEYS.reduce((total, attribute) => {
    const value = priorityWeights?.[attribute];
    if (value == null || String(value).trim() === '') return Number.NaN;
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? total + numericValue : Number.NaN;
  }, 0);
}

function hasPriorityWeightsInRange(priorityWeights) {
  return CUSTOM_PRIORITY_ATTRIBUTE_KEYS.every(attribute => {
    const value = priorityWeights?.[attribute];
    if (value == null || String(value).trim() === '') return false;
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue >= 0 && numericValue <= 100;
  });
}

function PrioritySelectionSettings({
  onPriorityAttributeMove,
  onPriorityAttributeToggle,
  onPrioritySelectionModeChange,
  onPriorityWeightChange,
  priorityAttributes,
  prioritySelectionMode,
  priorityWeights,
  t,
}) {
  const isWeighted = prioritySelectionMode === PRIORITY_SELECTION_MODES.WEIGHTED;
  const total = getPriorityWeightTotal(priorityWeights);
  const hasValidTotal = total === 100 && hasPriorityWeightsInRange(priorityWeights);
  const priorityWeightValidationId = 'priorityWeightValidation';

  return (
    <section className="custom-priority-attributes" aria-labelledby="customPriorityAttributesLabel">
      <div className="custom-priority-attributes__head">
        <div>
          <h3 id="customPriorityAttributesLabel" className="field-label">
            {t('config.priorityAttributes')}
          </h3>
          {!isWeighted && <p className="field-help">{t('config.choosePriorityAttributes')}</p>}
        </div>
        {!isWeighted && (
          <span className="custom-priority-attributes__count" aria-hidden="true">
            {t('config.priorityAttributesCount', { count: priorityAttributes.length })}
          </span>
        )}
      </div>
      <div className="segmented" role="group" aria-label={t('config.priorityAttributes')}>
        {[PRIORITY_SELECTION_MODES.ORDERED, PRIORITY_SELECTION_MODES.WEIGHTED].map(mode => (
          <button
            key={mode}
            className={`segmented__btn ${prioritySelectionMode === mode ? 'is-active' : ''}`}
            type="button"
            aria-pressed={prioritySelectionMode === mode}
            onClick={() => onPrioritySelectionModeChange(mode)}
          >
            {t(`config.prioritySelectionMode.${mode}`)}
          </button>
        ))}
      </div>
      {isWeighted ? (
        <div className="priority-weights">
          <span className="visually-hidden" aria-live="polite" aria-atomic="true">
            {Number.isFinite(total) ? t('config.priorityWeightTotal', { total }) : t('config.priorityWeightInvalid')}
          </span>
          {CUSTOM_PRIORITY_ATTRIBUTE_KEYS.map(attribute => {
            const label = t(CUSTOM_PRIORITY_ATTRIBUTE_METADATA[attribute].labelKey);
            const weightValue = priorityWeights?.[attribute] ?? 0;
            const weightMax = getPriorityWeightMax(priorityWeights, attribute);
            return (
              <div key={attribute} className="priority-weights__field">
                <span className="priority-weights__label">{label}</span>
                <div className="priority-weights__inputs">
                  <input
                    className="priority-weights__slider"
                    aria-label={t('config.priorityWeightSliderLabel', { attribute: label })}
                    aria-valuetext={`${weightValue}%`}
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={weightValue}
                    onChange={event => onPriorityWeightChange(attribute, event.target.value)}
                    aria-invalid={hasValidTotal ? undefined : true}
                    aria-describedby={hasValidTotal ? undefined : priorityWeightValidationId}
                  />
                  <span className="priority-weights__control">
                    <input
                      aria-label={t('config.priorityWeightValueLabel', { attribute: label })}
                      type="number"
                      min="0"
                      max={weightMax}
                      step="1"
                      value={weightValue}
                      onChange={event => onPriorityWeightChange(attribute, event.target.value)}
                      aria-invalid={hasValidTotal ? undefined : true}
                      aria-describedby={hasValidTotal ? undefined : priorityWeightValidationId}
                    />
                    <span aria-hidden="true">%</span>
                  </span>
                </div>
              </div>
            );
          })}
          <p className={`priority-weights__total ${hasValidTotal ? '' : 'is-invalid'}`.trim()}>
            {Number.isFinite(total) ? t('config.priorityWeightTotal', { total }) : t('config.priorityWeightTotal', { total: '—' })}
          </p>
          {!hasValidTotal && (
            <p id={priorityWeightValidationId} className="priority-weights__error">
              {t('config.priorityWeightInvalid')}
            </p>
          )}
        </div>
      ) : (
        <PrioritySelector
          priorityAttributes={priorityAttributes}
          onMove={onPriorityAttributeMove}
          onToggle={onPriorityAttributeToggle}
          showHeader={false}
          t={t}
        />
      )}
    </section>
  );
}

function SuppressorSection({ suppressorMode, suppressorOptions, setters, t }) {
  return (
    <ConfigSection index="02" title={t('config.section.suppressor')}>
      <div className="segmented segmented--three" role="group" aria-label={t('config.suppressor')}>
        {suppressorOptions.map(option => (
          <button
            key={option.value}
            className={`segmented__btn ${suppressorMode === option.value ? 'is-active' : ''}`}
            type="button"
            aria-pressed={suppressorMode === option.value}
            onClick={() => setters.suppressorMode(option.value)}
          >
            {t(option.label)}
          </button>
        ))}
      </div>
    </ConfigSection>
  );
}

function TraderPricesSection({
  includeTraderPrices,
  onIncludeTraderPricesChange,
  strictTraderLevels,
  t,
}) {
  return (
    <section className="config__section config__section--switch">
      <div className="switch-row">
        <label className="switch-row__text" htmlFor="includeTraderPrices">
          <span id="includeTraderPricesLabel">{t('config.includeTraders')}</span>
          <span id="includeTraderPricesHelp" className="field-help">{t('config.helpPrices')}</span>
        </label>
        <input
          id="includeTraderPrices"
          className="switch"
          type="checkbox"
          role="switch"
          checked={includeTraderPrices}
          onChange={event => onIncludeTraderPricesChange(event.target.checked)}
          aria-labelledby="includeTraderPricesLabel"
          aria-describedby="includeTraderPricesHelp"
        />
      </div>
      {includeTraderPrices && strictTraderLevels && (
        <Link className="strict-trader-badge" to="/settings#traders">
          <span>{t('traders.strictLevelsActive')}</span>
          <small>{t('traders.manageLevels')}</small>
        </Link>
      )}
    </section>
  );
}

function MetaWeightSection({
  maxWeight,
  maxWeightLimit,
  onMaxWeightChange,
  t,
}) {
  return (
    <div className="limit-fields-wrap">
      <div className="limit-fields limit-fields--single">
        <label className="limit-field" htmlFor="maxWeight">
          <span className="field-label limit-field__label">{t('config.maxWeight')}</span>
          <input
            id="maxWeight"
            className="limit-field__control"
            type="number"
            placeholder={t('config.noLimit')}
            min="0"
            max={maxWeightLimit}
            step="0.05"
            value={maxWeight}
            onChange={event => onMaxWeightChange(event.target.value)}
          />
        </label>
      </div>
    </div>
  );
}

function BudgetSection({
  draft,
  max,
  onBlur,
  onChange,
  onFocus,
  t,
  value,
}) {
  const id = 'maxPrice';
  const helpId = 'maxPriceHelp';
  return (
    <div className="build-budget">
      <label className="field-label" htmlFor={id}>{t('config.maxPrice')}</label>
      <span className="build-budget__control">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min="0"
          max={max}
          step="1000"
          value={draft ?? value}
          onFocus={event => onFocus(event.currentTarget.value)}
          onChange={event => onChange(event.currentTarget.value)}
          onBlur={event => onBlur(event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          aria-describedby={helpId}
        />
        <span aria-hidden="true">₽</span>
      </span>
      <span id={helpId} className="field-help">{t('config.maxPriceHelp')}</span>
    </div>
  );
}

function MagazineSection({ availableCapacities, magazineCapacity, setters, t }) {
  return (
    <ConfigSection index="04" title={t('config.section.magazine')}>
      <div className="segmented segmented--capacity" role="group" aria-label={t('config.magazine')}>
        {availableCapacities.map(capacity => (
          <button
            key={capacity}
            className={`segmented__btn ${Number(magazineCapacity) === capacity ? 'is-active' : ''}`}
            type="button"
            aria-pressed={Number(magazineCapacity) === capacity}
            onClick={() => setters.magazineCapacity(capacity)}
          >
            {capacity}
          </button>
        ))}
      </div>
    </ConfigSection>
  );
}

function SightSection({
  additionalScopeZoomLevels,
  compactScopeZoomLevels,
  scopeAutoCopy,
  scopeItems,
  scopeSelectionId,
  scopeZoom,
  setters,
  t,
  zoomFiltersExpanded,
  setZoomFiltersExpanded,
}) {
  return (
    <div className="config__subsection">
      <span className="field-label">{t('config.sight')}</span>
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
              <MaterialSymbol name="expand_more" className="tactical-device-picker__filter-chevron" />
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
    </div>
  );
}

function AccessoriesSection({
  flashlightItemId,
  flashlightItems,
  includeFlashlight,
  includeLaser,
  setters,
  t,
  tblItemId,
  tblItems,
}) {
  return (
    <div className="config__subsection">
      <span className="field-label">{t('config.accessories')}</span>
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
    </div>
  );
}

function RequiredModulesSection({
  moduleResults,
  onAddModule,
  onRemoveModule,
  onRequiredModuleSearchChange,
  requiredModuleSearch,
  selectedModules,
  t,
}) {
  return (
    <ConfigSection className="advanced-builder" index="06" title={t('config.section.modules')}>
      <label className="visually-hidden" htmlFor="requiredModuleSearch">{t('config.modules')}</label>
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
    </ConfigSection>
  );
}

function GenerateSection({ disabled = false, generating, onGenerate, t }) {
  return (
    <div className="config__footer">
      <button
        className="btn btn--primary btn--generate"
        type="button"
        onClick={onGenerate}
        disabled={generating || disabled}
        aria-keyshortcuts="Control+Enter Meta+Enter"
      >
        {generating ? t('config.calculating') : t('config.generateBuild')}
      </button>
      <span className="config__shortcut" aria-hidden="true">Ctrl + Enter</span>
    </div>
  );
}

// Ctrl+Enter (Cmd+Enter on macOS) starts a generation from anywhere on the page.
function useGenerateShortcut(onGenerate, enabled) {
  const latest = useRef({ onGenerate, enabled });
  useEffect(() => {
    latest.current = { onGenerate, enabled };
  });
  useEffect(() => {
    const handleKeyDown = event => {
      if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.repeat) return;
      if (!latest.current.enabled || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      event.preventDefault();
      latest.current.onGenerate();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}

export default function BuildSettings(props) {
  const {
    availableCapacities,
    buildGoalMode,
    customProfile,
    flashlightItemId,
    flashlightItems,
    generating,
    includeFlashlight,
    includeLaser,
    includeTraderPrices,
    magazineCapacity,
    maxPrice,
    maxPriceDraft,
    maxWeight,
    moduleResults,
    onAddModule,
    onBuildGoalModeChange,
    onGenerate,
    onIncludeTraderPricesChange,
    onMaxPriceBlur,
    onMaxPriceChange,
    onMaxPriceFocus,
    onMaxWeightChange,
    onPriorityAttributeToggle,
    onPriorityAttributeMove,
    onPrioritySelectionModeChange,
    onPriorityWeightChange,
    onRemoveModule,
    onRequiredModuleSearchChange,
    priorityAttributes,
    prioritySelectionMode,
    priorityWeights,
    requiredModuleSearch,
    scopeItemId,
    scopeItems,
    scopeMode,
    scopeZoom,
    scopeZoomLevels,
    selectedModules,
    setters,
    strictTraderLevels,
    suppressorMode,
    t,
    tblItemId,
    tblItems,
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

  const suppressorSection = (
    <SuppressorSection
      suppressorMode={suppressorMode}
      suppressorOptions={props.suppressorOptions}
      setters={setters}
      t={t}
    />
  );
  const traderPricesSection = (
    <TraderPricesSection
      includeTraderPrices={includeTraderPrices}
      onIncludeTraderPricesChange={onIncludeTraderPricesChange}
      strictTraderLevels={strictTraderLevels}
      t={t}
    />
  );
  const magazineSection = (
    <MagazineSection
      availableCapacities={availableCapacities}
      magazineCapacity={magazineCapacity}
      setters={setters}
      t={t}
    />
  );
  const sightSection = (
    <SightSection
      additionalScopeZoomLevels={additionalScopeZoomLevels}
      compactScopeZoomLevels={compactScopeZoomLevels}
      scopeAutoCopy={scopeAutoCopy}
      scopeItems={scopeItems}
      scopeSelectionId={scopeSelectionId}
      scopeZoom={scopeZoom}
      setters={setters}
      t={t}
      zoomFiltersExpanded={zoomFiltersExpanded}
      setZoomFiltersExpanded={setZoomFiltersExpanded}
    />
  );
  const accessoriesSection = (
    <AccessoriesSection
      flashlightItemId={flashlightItemId}
      flashlightItems={flashlightItems}
      includeFlashlight={includeFlashlight}
      includeLaser={includeLaser}
      setters={setters}
      t={t}
      tblItemId={tblItemId}
      tblItems={tblItems}
    />
  );
  const requiredModulesSection = (
    <RequiredModulesSection
      moduleResults={moduleResults}
      onAddModule={onAddModule}
      onRemoveModule={onRemoveModule}
      onRequiredModuleSearchChange={onRequiredModuleSearchChange}
      requiredModuleSearch={requiredModuleSearch}
      selectedModules={selectedModules}
      t={t}
    />
  );
  const priorityWeightTotal = getPriorityWeightTotal(priorityWeights);
  const priorityWeightsInvalid = buildGoalMode === BUILD_GOAL_MODES.PRIORITIES
    && prioritySelectionMode === PRIORITY_SELECTION_MODES.WEIGHTED
    && (priorityWeightTotal !== 100 || !hasPriorityWeightsInRange(priorityWeights));
  useGenerateShortcut(onGenerate, !generating && !priorityWeightsInvalid);
  const generateSection = (
    <GenerateSection disabled={priorityWeightsInvalid} generating={generating} onGenerate={onGenerate} t={t} />
  );
  const budgetField = (
    <BudgetSection
      draft={maxPriceDraft}
      max={props.maxPriceLimit}
      onBlur={onMaxPriceBlur}
      onChange={onMaxPriceChange}
      onFocus={onMaxPriceFocus}
      t={t}
      value={maxPrice}
    />
  );
  const opticsSection = (
    <ConfigSection index="05" title={t('config.section.optics')}>
      {sightSection}
      {accessoriesSection}
    </ConfigSection>
  );
  const goalHintKey = `config.goalHint.${buildGoalMode}`;

  const renderMode = (goalContent, limitsContent) => (
    <div className="config__mode" data-build-goal={buildGoalMode}>
      <ConfigSection className="config__section--goals" index="01" title={t('config.section.goal')}>
        <div className="segmented segmented--goals" role="group" aria-label={t('config.goal')}>
          {BUILD_GOAL_OPTIONS.map(option => {
            const selected = buildGoalMode === option.id;
            return (
              <button
                key={option.id}
                className={`segmented__btn ${selected ? 'is-active' : ''}`}
                type="button"
                aria-pressed={selected}
                onClick={() => onBuildGoalModeChange(option.id)}
              >
                {t(option.labelKey)}
              </button>
            );
          })}
        </div>
        <p className="field-help config__goal-hint">{t(goalHintKey)}</p>
        {goalContent}
      </ConfigSection>
      {suppressorSection}
      <ConfigSection index="03" title={t('config.section.limits')}>
        {limitsContent}
      </ConfigSection>
      {magazineSection}
      {opticsSection}
      {requiredModulesSection}
      {traderPricesSection}
      {generateSection}
    </div>
  );

  return (
    <aside className="config" aria-label={t('config.buildConfiguration')}>
      <div className="config__head"><h2>{t('config.buildConfiguration')}</h2></div>

      {buildGoalMode === BUILD_GOAL_MODES.META && renderMode(
        null,
        (
          <div className="limit-grid">
            <MetaWeightSection
              maxWeight={maxWeight}
              maxWeightLimit={props.maxWeightLimit}
              onMaxWeightChange={onMaxWeightChange}
              t={t}
            />
            {budgetField}
          </div>
        ),
      )}

      {buildGoalMode === BUILD_GOAL_MODES.CONSTRAINTS && renderMode(
        (
          <div className="custom-characteristic-settings" role="group" aria-labelledby="customCharacteristicSettingsTitle">
            <div className="custom-characteristic-settings__head">
              <h4 id="customCharacteristicSettingsTitle">{t('config.characteristicSettings')}</h4>
              <InfoTooltip label={t('config.characteristicSettingsInfo')}>
                {t('ui.radar.help')}
              </InfoTooltip>
            </div>
            <CustomConstraintInputs
              onChange={setters.customProfile}
              profile={customProfile}
              t={t}
              weapon={weapon}
            />
          </div>
        ),
        budgetField,
      )}

      {buildGoalMode === BUILD_GOAL_MODES.PRIORITIES && renderMode(
        (
          <PrioritySelectionSettings
            priorityAttributes={priorityAttributes}
            prioritySelectionMode={prioritySelectionMode}
            priorityWeights={priorityWeights}
            onPriorityAttributeMove={onPriorityAttributeMove}
            onPriorityAttributeToggle={onPriorityAttributeToggle}
            onPrioritySelectionModeChange={onPrioritySelectionModeChange}
            onPriorityWeightChange={onPriorityWeightChange}
            t={t}
          />
        ),
        budgetField,
      )}
    </aside>
  );
}
