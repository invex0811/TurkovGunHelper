import AsyncImage from '../../../ui/AsyncImage.jsx';
import CustomBuildRadar from '../../../ui/CustomBuildRadar.jsx';
import { PriceSource } from './PriceDisplay.jsx';

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

export default function BuildSettings(props) {
  const {
    availableCapacities,
    availableZoomLevels,
    configTab,
    customExactTargets,
    customProfile,
    generating,
    includeFlashlight,
    includeLaser,
    includeTraderPrices,
    isSightSelectOpen,
    magazineCapacity,
    maxPrice,
    maxPriceDraft,
    maxWeight,
    moduleResults,
    onAddModule,
    onExactChange,
    onGenerate,
    onIncludeTraderPricesChange,
    onMaxPriceBlur,
    onMaxPriceChange,
    onMaxPriceFocus,
    onMaxWeightChange,
    onRemoveModule,
    onRequiredModuleSearchChange,
    onSightModeChange,
    onSightSelectOpenChange,
    requiredModuleSearch,
    selectedModules,
    setters,
    sightMode,
    suppressorMode,
    targetType,
    t,
    weapon,
  } = props;

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
              <CustomBuildRadar
                profile={customProfile}
                weapon={weapon}
                onChange={setters.customProfile}
                exactTargets={customExactTargets}
                onExactChange={onExactChange}
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
            <label className="field-label" htmlFor="sightZoom">{t('config.sight')}</label>
            <div className={`config-select-wrap ${isSightSelectOpen ? 'is-open' : ''}`}>
              <select
                id="sightZoom"
                className="config-select"
                value={sightMode}
                onChange={event => onSightModeChange(event.target.value)}
                onFocus={() => onSightSelectOpenChange(true)}
                onBlur={() => onSightSelectOpenChange(false)}
                onKeyDown={event => {
                  if (event.key === 'Escape') onSightSelectOpenChange(false);
                }}
              >
                {props.sightOptions.concat(
                  availableZoomLevels
                    .filter(zoom => zoom > 1)
                    .map(zoom => ({
                      value: String(zoom),
                      label: t('config.sight.zoom', { zoom }),
                    })),
                ).map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
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
              <label className="check">
                <input
                  type="checkbox"
                  checked={includeFlashlight}
                  onChange={event => setters.includeFlashlight(event.target.checked)}
                />
                <span>{t('config.flashlight')}</span>
              </label>
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
