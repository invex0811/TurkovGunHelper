import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  PRICE_CONFIDENCE,
  PRICE_MODE_LABELS,
  PRICE_MODE_OPTIONS,
} from '../data/price/priceModes.js';
import {
  loadPriceModePreference,
  savePriceModePreference,
} from '../data/settings/buildPreferences.js';
import { getWeaponDetails, getAllMods } from '../data/tarkovApi';
import { calculateBestBuild } from '../domain/calculator.js';

function formatPartName(name) {
  if (!name) return '';
  return name.replace(/(\d+(?:\.\d+)?)\s*(?:"|inch(?:es)?)/ig, (match, p1) => {
    return Math.round(parseFloat(p1) * 25.4) + ' mm';
  });
}

function isPositivePrice(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function getRawFallbackPrice(item) {
  const candidates = [
    { field: 'avg24hPrice', value: item?.avg24hPrice },
    { field: 'lastLowPrice', value: item?.lastLowPrice },
    { field: 'low24hPrice', value: item?.low24hPrice },
    { field: 'basePrice', value: item?.basePrice },
  ];

  return candidates.find(candidate => isPositivePrice(candidate.value)) ?? {
    field: null,
    value: 0,
  };
}

function formatCurrency(value, currency = 'RUB') {
  if (!isPositivePrice(value)) return 'N/A';
  return `${Math.round(value).toLocaleString()} ${currency}`;
}

function getPriceFieldLabel(field) {
  if (field === 'avg24hPrice') return '24h avg';
  if (field === 'lastLowPrice') return 'Last low';
  if (field === 'low24hPrice') return '24h low';
  if (field === 'basePrice') return 'Base price';
  return 'No price field';
}

function getPriceConfidenceLabel(priceInfo) {
  if (priceInfo.isMissing) return 'Missing';
  if (priceInfo.usesRawFallback) return 'Raw fallback';
  if (priceInfo.confidence === PRICE_CONFIDENCE.FALLBACK) return 'Fallback';
  if (priceInfo.confidence === PRICE_CONFIDENCE.HIGH) return 'Market';
  return 'Price';
}

function getItemDisplayName(item, fallbackLabel = 'Item') {
  return item?.shortName || item?.name || fallbackLabel;
}

function getSelectedPriceInfo(item, selectedPriceMode) {
  const normalizedPrice = item?.price;
  const rawFallback = getRawFallbackPrice(item);
  const modeMismatch = Boolean(
    normalizedPrice?.mode
    && selectedPriceMode
    && normalizedPrice.mode !== selectedPriceMode,
  );

  if (normalizedPrice && !modeMismatch) {
    const value = isPositivePrice(normalizedPrice.value) ? normalizedPrice.value : 0;
    const confidence = normalizedPrice.confidence
      ?? (normalizedPrice.fallbackUsed ? PRICE_CONFIDENCE.FALLBACK : PRICE_CONFIDENCE.HIGH);
    const isMissing = confidence === PRICE_CONFIDENCE.MISSING || !isPositivePrice(value);

    return {
      value,
      currency: normalizedPrice.currency ?? 'RUB',
      mode: normalizedPrice.mode ?? selectedPriceMode,
      source: normalizedPrice.source ?? 'Unknown source',
      field: normalizedPrice.field ?? null,
      fallbackUsed: Boolean(normalizedPrice.fallbackUsed),
      updatedAt: normalizedPrice.updatedAt ?? null,
      confidence: isMissing ? PRICE_CONFIDENCE.MISSING : confidence,
      usesSelectedMode: true,
      usesRawFallback: false,
      modeMismatch: false,
      isMissing,
    };
  }

  if (isPositivePrice(rawFallback.value)) {
    return {
      value: rawFallback.value,
      currency: normalizedPrice?.currency ?? 'RUB',
      mode: selectedPriceMode,
      source: normalizedPrice?.source ?? 'Raw item fields',
      field: rawFallback.field,
      fallbackUsed: true,
      updatedAt: normalizedPrice?.updatedAt ?? item?.updated ?? null,
      confidence: PRICE_CONFIDENCE.FALLBACK,
      usesSelectedMode: false,
      usesRawFallback: true,
      modeMismatch,
      isMissing: false,
    };
  }

  return {
    value: 0,
    currency: normalizedPrice?.currency ?? 'RUB',
    mode: selectedPriceMode,
    source: normalizedPrice?.source ?? 'Unknown source',
    field: null,
    fallbackUsed: true,
    updatedAt: normalizedPrice?.updatedAt ?? item?.updated ?? null,
    confidence: PRICE_CONFIDENCE.MISSING,
    usesSelectedMode: false,
    usesRawFallback: true,
    modeMismatch,
    isMissing: true,
  };
}

function formatDiagnosticsList(entries, limit = 3) {
  const names = entries
    .slice(0, limit)
    .map(entry => entry.label);

  const remainingCount = entries.length - names.length;

  if (remainingCount > 0) {
    return `${names.join(', ')} and ${remainingCount} more`;
  }

  return names.join(', ');
}

function getPriceSummaryStatus(diagnostics) {
  if (diagnostics.missingEntries.length > 0) return 'some prices missing';
  if (diagnostics.fallbackEntries.length > 0) return 'includes fallback prices';
  return 'primary market prices';
}

function collectBuildPriceDiagnostics(weapon, buildResult, selectedPriceMode) {
  const entries = [
    {
      label: 'Base weapon',
      item: weapon,
    },
    ...buildResult.build.map(part => ({
      label: getItemDisplayName(part.item, part.slotName),
      item: part.item,
    })),
  ].map(entry => ({
    ...entry,
    priceInfo: getSelectedPriceInfo(entry.item, selectedPriceMode),
  }));

  const fallbackEntries = entries.filter(entry => (
    entry.priceInfo.fallbackUsed
    && !entry.priceInfo.isMissing
  ));
  const missingEntries = entries.filter(entry => entry.priceInfo.isMissing);
  const modeMismatchEntries = entries.filter(entry => entry.priceInfo.modeMismatch);
  const sourceLabels = Array.from(new Set(
    entries
      .filter(entry => !entry.priceInfo.isMissing)
      .map(entry => entry.priceInfo.source)
      .filter(Boolean),
  ));

  const warningMessages = [];

  if (missingEntries.length > 0) {
    warningMessages.push(
      `Missing prices: ${formatDiagnosticsList(missingEntries)}. Total price may be incomplete.`,
    );
  }

  if (fallbackEntries.length > 0) {
    warningMessages.push(
      `Fallback prices: ${formatDiagnosticsList(fallbackEntries)}.`,
    );
  }

  if (modeMismatchEntries.length > 0) {
    warningMessages.push(
      `Price mode fallback used for: ${formatDiagnosticsList(modeMismatchEntries)}.`,
    );
  }

  if (sourceLabels.length > 1) {
    warningMessages.push(`Mixed price sources: ${sourceLabels.join(', ')}.`);
  }

  const modeLabel = PRICE_MODE_LABELS[selectedPriceMode] ?? selectedPriceMode;
  const sourceLabel = sourceLabels.length > 0 ? sourceLabels.join(' + ') : 'No source';

  return {
    entries,
    fallbackEntries,
    missingEntries,
    modeMismatchEntries,
    sourceLabels,
    warningMessages,
    summaryLabel: `${modeLabel} · ${sourceLabel} · ${getPriceSummaryStatus({
      fallbackEntries,
      missingEntries,
    })}`,
  };
}

function getPartPriceMetaLabel(priceInfo, selectedPriceMode) {
  if (priceInfo.isMissing) return 'Price missing';

  const modeLabel = PRICE_MODE_LABELS[priceInfo.mode]
    ?? PRICE_MODE_LABELS[selectedPriceMode]
    ?? selectedPriceMode
    ?? 'Price mode';
  const fieldLabel = getPriceFieldLabel(priceInfo.field);

  if (priceInfo.modeMismatch) {
    return `${fieldLabel} · mode fallback`;
  }

  if (priceInfo.confidence === PRICE_CONFIDENCE.FALLBACK || priceInfo.usesRawFallback) {
    return `Fallback · ${fieldLabel}`;
  }

  return `${modeLabel} · ${priceInfo.source}`;
}

const SUPPRESSOR_MODE_OPTIONS = [
  { value: 'allow', label: 'Allow suppressors' },
  { value: 'forbid', label: 'Forbid suppressors' },
  { value: 'require', label: 'Require suppressor' },
];

function getSuppressorOptions(suppressorMode) {
  if (suppressorMode === 'forbid') {
    return {
      forbidSuppressor: true,
      requireSuppressor: false,
    };
  }

  if (suppressorMode === 'require') {
    return {
      forbidSuppressor: false,
      requireSuppressor: true,
    };
  }

  return {
    forbidSuppressor: false,
    requireSuppressor: false,
  };
}

function InlineMessage({ type = 'info', title, children }) {
  const isError = type === 'error';
  const isWarning = type === 'warning';

  const borderColor = isError
    ? 'var(--color-accent-red)'
    : isWarning
      ? 'var(--color-accent-gold-dark)'
      : 'var(--color-border-active)';

  return (
    <div
      style={{
        backgroundColor: isError ? 'rgba(205, 30, 47, 0.12)' : 'rgba(154, 136, 102, 0.12)',
        borderLeft: `4px solid ${borderColor}`,
        padding: '0.75rem 1rem',
        marginBottom: '1rem',
        borderRadius: 'var(--radius-sm)',
        fontSize: '0.9rem',
      }}
    >
      {title && (
        <strong style={{ display: 'block', marginBottom: '0.25rem' }}>
          {title}
        </strong>
      )}
      <span style={{ color: 'var(--color-text-main)' }}>{children}</span>
    </div>
  );
}

function Configurator() {
  const { weaponId } = useParams();
  const [weapon, setWeapon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [targetType, setTargetType] = useState('meta'); // meta, max_ergo, min_recoil, custom
  const [customErgo, setCustomErgo] = useState(50);
  const [customRecoil, setCustomRecoil] = useState(50);
  const [suppressorMode, setSuppressorMode] = useState('allow');
  const [priceMode, setPriceMode] = useState(loadPriceModePreference);
  const [maxWeight, setMaxWeight] = useState('');
  const [magazineCapacity, setMagazineCapacity] = useState('30');
  const [showAdditionalOptions, setShowAdditionalOptions] = useState(false);
  const [buildResult, setBuildResult] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [generationError, setGenerationError] = useState(null);
  const [generating, setGenerating] = useState(false);
  
  useEffect(() => {
    savePriceModePreference(priceMode);
  }, [priceMode]);
  
  useEffect(() => {
    let cancelled = false;

    getWeaponDetails(weaponId, priceMode).then(data => {
      if (cancelled) return;

      setWeapon(data);
      setBuildResult(null);
      setLoadError(null);
      setGenerationError(null);
      setLoading(false);
    }).catch(err => {
      if (cancelled) return;

      console.error(err);
      setWeapon(null);
      setLoadError('Failed to load weapon details. Please go back to the weapon list and try again.');
      setBuildResult(null);
      setGenerationError(null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [weaponId, priceMode]);

  const handleGenerate = async () => {
  setGenerating(true);
  setGenerationError(null);
  setBuildResult(null);

  try {
    const modMap = await getAllMods(priceMode);
    const options = {
      ...getSuppressorOptions(suppressorMode),
      maxWeight: parseFloat(maxWeight) || 0,
      magazineCapacity: parseInt(magazineCapacity) || 30,
      priceMode,
    };

    const result = calculateBestBuild(weapon, targetType, customErgo, customRecoil, modMap, options);
    setBuildResult(result);

    console.log(`=== GENERATED BUILD (${weapon.shortName} - ${targetType}) ===`);
    console.log(JSON.stringify({
      stats: result.stats,
      parts: result.build.map(p => ({ slot: p.slotName, name: p.item.shortName, id: p.item.id }))
    }, null, 2));
  } catch (err) {
    console.error(err);
    setGenerationError('Failed to generate build. Mod data could not be loaded or the calculation failed.');
  } finally {
    setGenerating(false);
  }
};

  const isLoading = loading || (weapon && weapon.id !== weaponId);

  if (isLoading) {
    return <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>Loading weapon details...</div>;
  }

  if (!weapon) {
  return (
    <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
      {loadError ? (
        <InlineMessage type="error" title="Weapon loading failed">
          {loadError}
        </InlineMessage>
      ) : (
        'Weapon not found.'
      )}
    </div>
  );
}

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
      <div className="glass-panel" style={{ padding: '2rem' }}>
        <Link to="/" className="btn" style={{ textDecoration: 'none', marginBottom: '1.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}>
          <span>&larr;</span> <span>Back to Weapons</span>
        </Link>
        <h2 style={{ color: 'var(--color-accent-gold)' }}>{weapon.shortName}</h2>
        <p style={{ color: 'var(--color-text-muted)' }}>{weapon.name}</p>
        <div style={{ marginTop: '1rem', textAlign: 'center' }}>
          <img src={weapon.properties?.defaultPreset?.image512pxLink || weapon.image512pxLink || weapon.iconLink} alt={weapon.shortName} style={{ maxWidth: '100%' }} />
        </div>
        
        <div style={{ marginTop: '2rem' }}>
          <h3>Base Stats</h3>
          <ul style={{ listStyleType: 'none', padding: 0, marginTop: '1rem' }}>
            <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--color-border)' }}>Ergonomics: {weapon.properties?.ergonomics ?? 'N/A'}</li>
            <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--color-border)' }}>Vertical Recoil: {weapon.properties?.recoilVertical ?? 'N/A'}</li>
            <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--color-border)' }}>Horizontal Recoil: {weapon.properties?.recoilHorizontal ?? 'N/A'}</li>
          </ul>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '2rem' }}>
        <h3>Build Configuration</h3>
        <div style={{ marginTop: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button 
            className={`btn ${targetType === 'meta' ? '' : 'btn-outline'}`}
            onClick={() => setTargetType('meta')}
            style={{ borderColor: 'var(--color-accent-green)', color: targetType === 'meta' ? 'var(--color-bg-base)' : 'var(--color-accent-green)', background: targetType === 'meta' ? 'var(--color-accent-green)' : 'transparent' }}
          >
            Meta (Top)
          </button>
          <button 
            className={`btn ${targetType === 'max_ergo' ? '' : 'btn-outline'}`}
            onClick={() => setTargetType('max_ergo')}
          >
            Max Ergonomics
          </button>
          <button 
            className={`btn ${targetType === 'min_recoil' ? '' : 'btn-outline'}`}
            onClick={() => setTargetType('min_recoil')}
          >
            Min Recoil
          </button>
          <button 
            className={`btn ${targetType === 'budget' ? '' : 'btn-outline'}`}
            onClick={() => setTargetType('budget')}
          >
            Budget
          </button>
          <button 
            className={`btn ${targetType === 'custom' ? '' : 'btn-outline'}`}
            onClick={() => setTargetType('custom')}
          >
            Custom
          </button>
        </div>

        {targetType === 'custom' && (
          <div style={{ marginTop: '2rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem' }}>Min Ergonomics</label>
              <input type="number" className="input-field" value={customErgo} onChange={e => setCustomErgo(e.target.value)} />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem' }}>Max Recoil</label>
              <input type="number" className="input-field" value={customRecoil} onChange={e => setCustomRecoil(e.target.value)} />
            </div>
          </div>
        )}

        <div style={{ marginTop: '2rem', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          <button 
            onClick={() => setShowAdditionalOptions(!showAdditionalOptions)}
            style={{ 
              width: '100%', 
              padding: '1rem', 
              background: 'transparent', 
              border: 'none', 
              color: 'var(--color-text)', 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              cursor: 'pointer',
              fontWeight: 'bold'
            }}
          >
            <span>Additional Options</span>
            <span style={{ transform: showAdditionalOptions ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s ease' }}>v</span>
          </button>
          
          {showAdditionalOptions && (
            <div style={{ padding: '1.5rem', borderTop: '1px solid var(--color-border)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem', alignItems: 'end' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                  Suppressor Mode
                </label>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {SUPPRESSOR_MODE_OPTIONS.map(option => {
                    const isSelected = suppressorMode === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`btn ${isSelected ? '' : 'btn-outline'}`}
                        onClick={() => setSuppressorMode(option.value)}
                        style={{
                          flex: '1 1 140px',
                          padding: '0.75rem 1rem',
                          fontSize: '0.85rem',
                          borderColor: 'var(--color-accent-gold-dark)',
                          color: isSelected ? 'var(--color-bg-base)' : 'var(--color-accent-gold)',
                          background: isSelected ? 'var(--color-accent-gold-dark)' : 'transparent',
                        }}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                  Price Mode
                </label>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {PRICE_MODE_OPTIONS.map(option => {
                    const isSelected = priceMode === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`btn ${isSelected ? '' : 'btn-outline'}`}
                        onClick={() => setPriceMode(option.value)}
                        style={{
                          flex: '1 1 140px',
                          padding: '0.75rem 1rem',
                          fontSize: '0.85rem',
                          borderColor: 'var(--color-accent-gold-dark)',
                          color: isSelected ? 'var(--color-bg-base)' : 'var(--color-accent-gold)',
                          background: isSelected ? 'var(--color-accent-gold-dark)' : 'transparent',
                        }}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              
              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>Max Weight (kg)</label>
                <input 
                  type="number" 
                  placeholder="No limit" 
                  value={maxWeight} 
                  onChange={e => setMaxWeight(e.target.value)} 
                  style={{ 
                    width: '100%', 
                    padding: '0.75rem', 
                    backgroundColor: 'rgba(0,0,0,0.5)', 
                    border: '1px solid var(--color-border)', 
                    color: 'var(--color-text)',
                    borderRadius: 'var(--radius-sm)',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }} 
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>Magazine Capacity</label>
                <input 
                  type="number" 
                  placeholder="30" 
                  value={magazineCapacity} 
                  onChange={e => setMagazineCapacity(e.target.value)} 
                  style={{ 
                    width: '100%', 
                    padding: '0.75rem', 
                    backgroundColor: 'rgba(0,0,0,0.5)', 
                    border: '1px solid var(--color-border)', 
                    color: 'var(--color-text)',
                    borderRadius: 'var(--radius-sm)',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }} 
                />
              </div>
            </div>
          )}
        </div>

        <div style={{ marginTop: '2rem' }}>
          <button className="btn" style={{ width: '100%', padding: '1rem', fontSize: '1.2rem' }} onClick={handleGenerate} disabled={generating}>
            {generating ? 'LOADING MODS...' : 'GENERATE BUILD'}
          </button>
        </div>

        {generationError && (
          <div style={{ marginTop: '2rem' }}>
            <InlineMessage type="error" title="Build generation failed">
              {generationError}
            </InlineMessage>
          </div>
        )}

        {buildResult && (() => {
          const hasCalculationError = Boolean(buildResult.error);
          const hasBuildParts = Array.isArray(buildResult.build) && buildResult.build.length > 0;
          const canShowBuildDetails = !hasCalculationError && hasBuildParts;
          const priceDiagnostics = canShowBuildDetails
            ? collectBuildPriceDiagnostics(weapon, buildResult, priceMode)
            : null;

          return (
            <div style={{ marginTop: '2rem', padding: '1rem', background: 'rgba(0,0,0,0.3)', borderRadius: 'var(--radius-md)' }}>
              <h4 style={{ color: 'var(--color-accent-green)', marginBottom: '1rem' }}>Build Results</h4>

              {hasCalculationError && (
                <InlineMessage type="error" title="Build cannot satisfy current constraints">
                  {buildResult.error}
                </InlineMessage>
              )}

              {!hasCalculationError && buildResult.warning && (
                <InlineMessage type="warning" title="Build warning">
                  {buildResult.warning}
                </InlineMessage>
              )}

              {!hasCalculationError && !hasBuildParts && (
                <InlineMessage type="warning" title="No build parts selected">
                  The calculator did not find any compatible parts for the current configuration.
                </InlineMessage>
              )}

              {canShowBuildDetails && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1.5rem' }}>
                    <span>Ergonomics: <strong style={{ color: 'var(--color-accent-gold)' }}>{buildResult.stats.ergonomics}</strong></span>
                    <span>Weight: <strong style={{ color: 'var(--color-accent-gold)' }}>{buildResult.stats.weight} kg</strong></span>
                    <span>V. Recoil: <strong style={{ color: 'var(--color-accent-gold)' }}>{buildResult.stats.recoilVertical}</strong></span>
                    <span>H. Recoil: <strong style={{ color: 'var(--color-accent-gold)' }}>{buildResult.stats.recoilHorizontal}</strong></span>
                    <span style={{ gridColumn: 'span 2' }}>
                      Estimated Price:{' '}
                      <strong style={{ color: 'var(--color-accent-gold)' }}>
                        {formatCurrency(buildResult.stats.price, 'RUB')}
                      </strong>
                      {priceDiagnostics && (
                        <span
                          style={{
                            display: 'block',
                            color: 'var(--color-text-muted)',
                            fontSize: '0.78rem',
                            marginTop: '0.25rem',
                          }}
                        >
                          {priceDiagnostics.summaryLabel}
                        </span>
                      )}
                    </span>
                  </div>

                  {priceDiagnostics?.warningMessages.length > 0 && (
                    <InlineMessage type="warning" title="Price data notice">
                      {priceDiagnostics.warningMessages.join(' ')}
                    </InlineMessage>
                  )}

                  <h5 style={{ marginTop: '1rem', marginBottom: '0.5rem', color: 'var(--color-text-muted)' }}>Parts List</h5>
                  <ul style={{ listStyleType: 'none', padding: 0, maxHeight: '400px', overflowY: 'auto', width: '100%' }}>
                    {buildResult.build.map((part, idx) => {
                      const priceInfo = getSelectedPriceInfo(part.item, priceMode);
                      const priceMetaColor = priceInfo.isMissing
                        ? 'var(--color-accent-red)'
                        : priceInfo.fallbackUsed
                          ? 'var(--color-accent-gold-dark)'
                          : 'var(--color-text-muted)';

                      return (
                        <li
                          key={idx}
                          style={{
                            padding: '0.75rem',
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            display: 'flex',
                            alignItems: 'center',
                            width: '100%',
                            boxSizing: 'border-box',
                          }}
                        >
                          <img
                            src={part.item.image512pxLink || part.item.iconLink || 'https://via.placeholder.com/30'}
                            alt=""
                            style={{
                              width: '40px',
                              height: '40px',
                              objectFit: 'contain',
                              marginRight: '1rem',
                            }}
                          />

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '1rem', fontWeight: 'bold' }}>
                              {formatPartName(part.item.shortName)}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                              Slot: {part.slotName}
                            </div>
                          </div>

                          <div
                            style={{
                              textAlign: 'right',
                              whiteSpace: 'nowrap',
                              marginLeft: '1rem',
                            }}
                          >
                            <div
                              style={{
                                color: priceInfo.isMissing ? 'var(--color-text-muted)' : 'var(--color-accent-gold)',
                                fontSize: '0.9rem',
                                fontWeight: 'bold',
                              }}
                            >
                              {formatCurrency(priceInfo.value, priceInfo.currency)}
                            </div>
                            <div
                              title={`${getPriceConfidenceLabel(priceInfo)} · ${getPriceFieldLabel(priceInfo.field)}`}
                              style={{
                                color: priceMetaColor,
                                fontSize: '0.72rem',
                                marginTop: '0.15rem',
                              }}
                            >
                              {getPartPriceMetaLabel(priceInfo, priceMode)}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export default Configurator;