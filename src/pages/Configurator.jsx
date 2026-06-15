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
  loadTargetTypePreference,
  saveTargetTypePreference,
} from '../data/settings/buildPreferences.js';
import { getWeaponDetails, getAllMods } from '../data/tarkovApi';
import { calculateBestBuild, recalculateBuildStats } from '../domain/calculator.js';

function ImageWithLoader({ src, alt, style, containerStyle }) {
  const [loaded, setLoaded] = useState(false);

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', ...containerStyle }}>
      {!loaded && (
        <div className="shimmer" style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: 'inherit'
        }} />
      )}
      <img
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        style={{
          ...style,
          opacity: loaded ? 1 : 0,
          transition: 'opacity 0.3s ease-in-out'
        }}
      />
    </div>
  );
}

function buildAssemblyTree(weapon, buildParts) {
  const root = {
    item: weapon,
    slotName: 'Root',
    children: [],
    parent: null
  };

  const queue = [root];
  const remainingParts = [...buildParts];

  while (queue.length > 0 && remainingParts.length > 0) {
    const currentNode = queue.shift();
    const slots = currentNode.item.properties?.slots || [];

    slots.forEach(slot => {
      const allowedIds = new Set((slot.filters?.allowedItems || []).map(a => a.id));
      
      const partIdx = remainingParts.findIndex(part => 
        part.slotName === slot.name && allowedIds.has(part.item.id)
      );

      if (partIdx !== -1) {
        const [part] = remainingParts.splice(partIdx, 1);
        const childNode = {
          item: part.item,
          slotName: slot.name,
          children: [],
          parent: currentNode
        };
        currentNode.children.push(childNode);
        queue.push(childNode);
      }
    });
  }

  return root;
}

function calculateSimilarityDistance(a, b, priceMode) {
  const ergoA = a.ergonomicsModifier || 0;
  const ergoB = b.ergonomicsModifier || 0;
  const recoilA = a.recoilModifier || 0;
  const recoilB = b.recoilModifier || 0;
  const weightA = a.weight || 0;
  const weightB = b.weight || 0;
  
  function getRawPrice(item) {
    return item.avg24hPrice
      || item.lastLowPrice
      || item.low24hPrice
      || item.basePrice
      || 0;
  }

  function getPrice(item) {
    if (!priceMode || item.price?.mode === priceMode) {
      return item.price?.value ?? getRawPrice(item);
    }
    return getRawPrice(item);
  }

  const priceA = getPrice(a);
  const priceB = getPrice(b);
  
  const dErgo = Math.abs(ergoA - ergoB) * 1.5;
  const dRecoil = Math.abs(recoilA - recoilB) * 4.0;
  const dWeight = Math.abs(weightA - weightB) * 2.0;
  const dPrice = Math.abs(priceA - priceB) * 0.0001;
  
  return dErgo + dRecoil + dWeight + dPrice;
}

function findCompatibleAlternatives(node, allMods, currentBuild, priceMode) {
  if (!node || !node.parent) return [];

  const parentItem = node.parent.item;
  const parentSlot = parentItem.properties?.slots?.find(s => s.name === node.slotName);
  if (!parentSlot) return [];

  const allowedIds = new Set((parentSlot.filters?.allowedItems || []).map(a => a.id));
  
  const subtreeIds = new Set();
  function collectSubtreeIds(n) {
    subtreeIds.add(n.item.id);
    n.children.forEach(collectSubtreeIds);
  }
  collectSubtreeIds(node);

  const remainingInstalledIds = new Set();
  function collectRemaining(n) {
    if (n !== node) {
      remainingInstalledIds.add(n.item.id);
      n.children.forEach(collectRemaining);
    }
  }
  
  function getRoot(n) {
    let curr = n;
    while (curr.parent) {
      curr = curr.parent;
    }
    return curr;
  }

  collectRemaining(buildAssemblyTree(node.parent.item === node.item ? node.item : getRoot(node).item, currentBuild.build));

  const alternatives = [];

  Object.keys(allMods).forEach(modId => {
    if (modId === node.item.id) return;
    if (!allowedIds.has(modId)) return;

    const altItem = allMods[modId];
    if (!altItem) return;

    let isCompatibleWithChildren = true;
    for (const childNode of node.children) {
      const hasCompatibleSlot = (altItem.properties?.slots || []).some(s => 
        s.name === childNode.slotName && 
        (s.filters?.allowedItems || []).some(a => a.id === childNode.item.id)
      );
      if (!hasCompatibleSlot) {
        isCompatibleWithChildren = false;
        break;
      }
    }
    if (!isCompatibleWithChildren) return;

    let hasConflict = false;
    for (const conflict of altItem.conflictingItems || []) {
      if (remainingInstalledIds.has(conflict.id)) {
        hasConflict = true;
        break;
      }
    }
    if (hasConflict) return;

    for (const installedId of remainingInstalledIds) {
      const installedItem = allMods[installedId] || (installedId === getRoot(node).item.id ? getRoot(node).item : null);
      if (installedItem && installedItem.conflictingItems) {
        const conflictsWithAlt = installedItem.conflictingItems.some(c => c.id === altItem.id);
        if (conflictsWithAlt) {
          hasConflict = true;
          break;
        }
      }
    }
    if (hasConflict) return;

    alternatives.push(altItem);
  });

  alternatives.sort((a, b) => {
    const distA = calculateSimilarityDistance(node.item, a, priceMode);
    const distB = calculateSimilarityDistance(node.item, b, priceMode);
    return distA - distB;
  });

  return alternatives;
}

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

function getAvailableCapacities(weapon, allMods) {
  if (!weapon || !allMods) return [30];

  const magSlot = weapon.properties?.slots?.find(slot => {
    const name = (slot.name || '').toLowerCase();
    const nameId = (slot.nameId || '').toLowerCase();
    return name === 'mag' || name === 'magazine' || nameId === 'mod_magazine';
  });

  if (!magSlot) return [30];

  const allowedIds = magSlot.filters?.allowedItems || [];
  const capacities = allowedIds
    .map(shallowItem => allMods[shallowItem.id])
    .filter(mod => mod && mod.properties?.capacity !== undefined)
    .map(mod => mod.properties.capacity);

  if (capacities.length === 0) return [30];

  return Array.from(new Set(capacities)).sort((a, b) => a - b);
}

function Configurator() {
  const { weaponId } = useParams();
  const [weapon, setWeapon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [targetType, setTargetType] = useState(loadTargetTypePreference); // meta, max_ergo, min_recoil, custom
  const [customErgo, setCustomErgo] = useState(50);
  const [customRecoil, setCustomRecoil] = useState(50);
  const [suppressorMode, setSuppressorMode] = useState('allow');
  const [priceMode, setPriceMode] = useState(loadPriceModePreference);
  const [maxWeight, setMaxWeight] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [activeReplacePartId, setActiveReplacePartId] = useState(null);
  const [magazineCapacity, setMagazineCapacity] = useState(30);
  const [allMods, setAllMods] = useState(null);
  const [buildResult, setBuildResult] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [generationError, setGenerationError] = useState(null);
  const [generating, setGenerating] = useState(false);
  
  useEffect(() => {
    savePriceModePreference(priceMode);
  }, [priceMode]);

  useEffect(() => {
    saveTargetTypePreference(targetType);
  }, [targetType]);
  
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      getWeaponDetails(weaponId, priceMode),
      getAllMods(priceMode)
    ]).then(([weaponData, modsData]) => {
      if (cancelled) return;

      setWeapon(weaponData);
      setAllMods(modsData);
      
      const capacities = getAvailableCapacities(weaponData, modsData);
      if (capacities.length > 0) {
        if (capacities.includes(30)) {
          setMagazineCapacity(30);
        } else {
          setMagazineCapacity(capacities[0]);
        }
      }

      setBuildResult(null);
      setLoadError(null);
      setGenerationError(null);
      setLoading(false);
    }).catch(err => {
      if (cancelled) return;

      console.error(err);
      setWeapon(null);
      setAllMods(null);
      setLoadError('Failed to load weapon details. Please go back to the weapon list and try again.');
      setBuildResult(null);
      setGenerationError(null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [weaponId, priceMode]);

  const handleReplacePart = (targetPart, alternativeItem) => {
    if (!buildResult) return;
    
    const updatedBuild = buildResult.build.map(part => {
      if (part.item.id === targetPart.id) {
        return {
          ...part,
          item: alternativeItem
        };
      }
      return part;
    });

    const updatedResult = recalculateBuildStats(weapon, updatedBuild, { priceMode });
    
    setBuildResult(updatedResult);
    setActiveReplacePartId(null);
  };

  const handleGenerate = async () => {
  if (!allMods) return;
  setGenerating(true);
  setGenerationError(null);
  setBuildResult(null);

  try {
    const options = {
      ...getSuppressorOptions(suppressorMode),
      maxWeight: parseFloat(maxWeight) || 0,
      maxPrice: parseFloat(maxPrice) || 0,
      magazineCapacity: Number(magazineCapacity) || 30,
      priceMode,
    };

    const result = calculateBestBuild(weapon, targetType, customErgo, customRecoil, allMods, options);
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
    return (
      <div id="loader-wrapper">
        <div className="loader">
          <div className="loader-ring"></div>
          <div className="loader-ring"></div>
          <div className="loader-ring"></div>
          <p className="loader-text">Загрузка...</p>
        </div>
      </div>
    );
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
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '2rem' }}>
      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
        <Link to="/" className="btn" style={{ textDecoration: 'none', marginBottom: '1.5rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)' }}>
          <span>&larr;</span> <span>Back to Weapons</span>
        </Link>
        <h2 style={{ color: 'var(--color-accent-gold)' }}>{weapon.shortName}</h2>
        <p style={{ color: 'var(--color-text-muted)' }}>{weapon.name}</p>
        <div style={{ marginTop: '1rem', textAlign: 'center' }}>
          <ImageWithLoader 
            src={weapon.properties?.defaultPreset?.image512pxLink || weapon.image512pxLink || weapon.iconLink} 
            alt={weapon.shortName} 
            style={{ maxWidth: '100%', maxHeight: '250px', objectFit: 'contain' }} 
            containerStyle={{ minHeight: '200px', borderRadius: 'var(--radius-md)' }}
          />
        </div>
        
        <div style={{ marginTop: '2rem' }}>
          <h3>Base Stats</h3>
          <ul style={{ listStyleType: 'none', padding: 0, marginTop: '1rem' }}>
            <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--color-border)' }}>Ergonomics: {weapon.properties?.ergonomics ?? 'N/A'}</li>
            <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--color-border)' }}>Vertical Recoil: {weapon.properties?.recoilVertical ?? 'N/A'}</li>
            <li style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--color-border)' }}>Horizontal Recoil: {weapon.properties?.recoilHorizontal ?? 'N/A'}</li>
          </ul>
        </div>
        <div style={{ marginTop: 'auto', paddingTop: '2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
          <span style={{ 
            display: 'inline-flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            width: '18px', 
            height: '18px', 
            borderRadius: '50%', 
            border: '1px solid var(--color-text-muted)', 
            fontSize: '0.75rem', 
            fontWeight: 'bold',
            fontFamily: 'monospace'
          }}>i</span>
          <span>All data is sourced from <a href="https://tarkov.dev" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent-gold)', textDecoration: 'none', borderBottom: '1px dotted var(--color-accent-gold)' }}>tarkov.dev</a></span>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', minHeight: '500px' }}>
        <h3 style={{ color: 'var(--color-accent-green)', marginTop: 0, marginBottom: '1.5rem', fontSize: '1.5rem', borderBottom: '1px solid var(--color-border)', paddingBottom: '0.75rem' }}>
          Build Results
        </h3>
        
        {generating && (
          <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: 'var(--color-text-muted)' }}>
            Calculating optimal build...
          </div>
        )}

        {!generating && !buildResult && (
          <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '2rem', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', color: 'var(--color-text-muted)', fontSize: '0.95rem' }}>
            Configure parameters and click "GENERATE BUILD" to see the results and parts list here.
          </div>
        )}

        {!generating && buildResult && (() => {
          const hasCalculationError = Boolean(buildResult.error);
          const hasBuildParts = Array.isArray(buildResult.build) && buildResult.build.length > 0;
          const canShowBuildDetails = !hasCalculationError && hasBuildParts;
          const priceDiagnostics = canShowBuildDetails
            ? collectBuildPriceDiagnostics(weapon, buildResult, priceMode)
            : null;

          return (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
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
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.5rem', background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(255,255,255,0.05)' }}>
                    <span>Ergonomics: <strong style={{ color: 'var(--color-accent-gold)' }}>{buildResult.stats.ergonomics}</strong></span>
                    <span>Weight: <strong style={{ color: 'var(--color-accent-gold)' }}>{buildResult.stats.weight} kg</strong></span>
                    <span>V. Recoil: <strong style={{ color: 'var(--color-accent-gold)' }}>{buildResult.stats.recoilVertical}</strong></span>
                    <span>H. Recoil: <strong style={{ color: 'var(--color-accent-gold)' }}>{buildResult.stats.recoilHorizontal}</strong></span>
                    <span style={{ gridColumn: 'span 2', marginTop: '0.25rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.5rem' }}>
                      Estimated Price:{' '}
                      <strong style={{ color: 'var(--color-accent-gold)', fontSize: '1.1rem' }}>
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

                  <h4 style={{ marginTop: '1rem', marginBottom: '0.5rem', color: 'var(--color-accent-gold)', fontSize: '1.1rem' }}>Parts List</h4>
                  <div style={{ overflowY: 'auto', flex: 1, paddingRight: '0.5rem' }}>
                    <ul style={{ listStyleType: 'none', padding: 0, margin: 0, width: '100%' }}>
                      {buildResult.build.map((part, idx) => {
                        const priceInfo = getSelectedPriceInfo(part.item, priceMode);
                        const priceMetaColor = priceInfo.isMissing
                          ? 'var(--color-accent-red)'
                          : priceInfo.fallbackUsed
                            ? 'var(--color-accent-gold-dark)'
                            : 'var(--color-text-muted)';

                        const assemblyTree = buildAssemblyTree(weapon, buildResult.build);
                        let targetNode = null;
                        function findNode(n) {
                          if (n.item.id === part.item.id) {
                            targetNode = n;
                            return;
                          }
                          n.children.forEach(findNode);
                        }
                        findNode(assemblyTree);

                        const alternatives = targetNode 
                          ? findCompatibleAlternatives(targetNode, allMods, buildResult, priceMode).slice(0, 5) 
                          : [];

                        return (
                          <li
                            key={idx}
                            style={{
                              padding: '0.75rem 0',
                              borderBottom: '1px solid rgba(255,255,255,0.05)',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'stretch',
                              width: '100%',
                              boxSizing: 'border-box',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                              <ImageWithLoader
                                src={part.item.image512pxLink || part.item.iconLink || 'https://via.placeholder.com/30'}
                                alt=""
                                style={{
                                  width: '40px',
                                  height: '40px',
                                  objectFit: 'contain'
                                }}
                                containerStyle={{
                                  width: '40px',
                                  height: '40px',
                                  marginRight: '1rem',
                                  background: 'rgba(255,255,255,0.02)',
                                  borderRadius: 'var(--radius-sm)',
                                  border: '1px solid rgba(255,255,255,0.05)'
                                }}
                              />

                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                  <div style={{ fontSize: '0.95rem', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {formatPartName(part.item.shortName)}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setActiveReplacePartId(activeReplacePartId === part.item.id ? null : part.item.id)}
                                    className={`btn-replace-part ${activeReplacePartId === part.item.id ? 'active' : ''}`}
                                    title="Replace this module with compatible alternatives"
                                  >
                                    <span style={{ display: 'inline-flex', transform: 'translateY(-1.5px)' }}>⇄</span>
                                    <span style={{ display: 'inline-flex' }}>Replace</span>
                                  </button>
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
                            </div>

                            {activeReplacePartId === part.item.id && (
                              <div 
                                style={{ 
                                  width: '100%', 
                                  marginTop: '0.5rem', 
                                  padding: '0.75rem', 
                                  background: 'rgba(0, 0, 0, 0.3)', 
                                  borderRadius: 'var(--radius-sm)', 
                                  border: '1px solid var(--color-border)',
                                  boxSizing: 'border-box'
                                }}
                              >
                                <div style={{ fontSize: '0.8rem', color: 'var(--color-accent-gold)', marginBottom: '0.5rem', fontWeight: 'bold', textTransform: 'uppercase', fontFamily: 'var(--font-display)', letterSpacing: '0.5px' }}>
                                  Compatible Alternatives
                                </div>
                                {alternatives.length === 0 ? (
                                  <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
                                    No fully compatible alternative modules found in the database.
                                  </div>
                                ) : (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                    {alternatives.map(alt => {
                                      const altPriceInfo = getSelectedPriceInfo(alt, priceMode);
                                      const currentPriceInfo = getSelectedPriceInfo(part.item, priceMode);
                                      
                                      const ergoDiff = (alt.ergonomicsModifier || 0) - (part.item.ergonomicsModifier || 0);
                                      const recoilDiff = (alt.recoilModifier || 0) - (part.item.recoilModifier || 0);
                                      const priceDiff = altPriceInfo.value - currentPriceInfo.value;
                                      const weightDiff = (alt.weight || 0) - (part.item.weight || 0);

                                      const ergoDiffText = ergoDiff === 0 ? '0' : ergoDiff > 0 ? `+${parseFloat(ergoDiff.toFixed(2))}` : `${parseFloat(ergoDiff.toFixed(2))}`;
                                      const recoilDiffText = recoilDiff === 0 ? '0%' : recoilDiff > 0 ? `+${parseFloat(recoilDiff.toFixed(2))}%` : `${parseFloat(recoilDiff.toFixed(2))}%`;
                                      const weightDiffText = weightDiff === 0 ? '0 kg' : weightDiff > 0 ? `+${parseFloat(weightDiff.toFixed(3))} kg` : `${parseFloat(weightDiff.toFixed(3))} kg`;

                                      return (
                                        <div 
                                          key={alt.id}
                                          onClick={() => handleReplacePart(part.item, alt)}
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            padding: '0.5rem',
                                            background: 'rgba(0,0,0,0.2)',
                                            border: '1px solid rgba(255,255,255,0.03)',
                                            borderRadius: 'var(--radius-sm)',
                                            cursor: 'pointer',
                                            transition: 'all 0.2s ease',
                                            boxSizing: 'border-box'
                                          }}
                                          onMouseEnter={e => {
                                            e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                                            e.currentTarget.style.borderColor = 'var(--color-border-active)';
                                          }}
                                          onMouseLeave={e => {
                                            e.currentTarget.style.background = 'rgba(0,0,0,0.2)';
                                            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.03)';
                                          }}
                                        >
                                          <ImageWithLoader
                                            src={alt.image512pxLink || alt.iconLink || 'https://via.placeholder.com/30'}
                                            alt=""
                                            style={{ width: '30px', height: '30px', objectFit: 'contain' }}
                                            containerStyle={{ width: '30px', height: '30px', marginRight: '0.75rem' }}
                                          />
                                          <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: '0.85rem', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                              {formatPartName(alt.shortName)}
                                            </div>
                                            <div style={{ fontSize: '0.72rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', color: 'var(--color-text-muted)' }}>
                                              <span>
                                                Ergo:{' '}
                                                <strong style={{ color: ergoDiff > 0 ? 'var(--color-accent-green)' : ergoDiff < 0 ? 'var(--color-accent-red)' : 'var(--color-text-muted)' }}>
                                                  {ergoDiffText}
                                                </strong>
                                              </span>
                                              <span>
                                                Recoil:{' '}
                                                <strong style={{ color: recoilDiff < 0 ? 'var(--color-accent-green)' : recoilDiff > 0 ? 'var(--color-accent-red)' : 'var(--color-text-muted)' }}>
                                                  {recoilDiffText}
                                                </strong>
                                              </span>
                                              <span>
                                                Weight:{' '}
                                                <strong style={{ color: weightDiff < 0 ? 'var(--color-accent-green)' : weightDiff > 0 ? 'var(--color-accent-red)' : 'var(--color-text-muted)' }}>
                                                  {weightDiffText}
                                                </strong>
                                              </span>
                                            </div>
                                          </div>
                                          <div style={{ textAlign: 'right', marginLeft: '0.5rem' }}>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--color-accent-gold)', fontWeight: 'bold' }}>
                                              {formatCurrency(altPriceInfo.value, altPriceInfo.currency)}
                                            </div>
                                            <div style={{ fontSize: '0.7rem', color: priceDiff < 0 ? 'var(--color-accent-green)' : priceDiff > 0 ? 'var(--color-accent-red)' : 'var(--color-text-muted)' }}>
                                              {priceDiff > 0 ? `+${formatCurrency(priceDiff, altPriceInfo.currency)}` : priceDiff < 0 ? formatCurrency(priceDiff, altPriceInfo.currency) : '0 RUB'}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </>
              )}
            </div>
          );
        })()}
      </div>

      <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
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

        <div style={{ marginTop: '2.5rem', padding: '1.5rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.02)' }}>
          <h4 style={{ margin: '0 0 1.5rem 0', color: 'var(--color-accent-gold)', fontSize: '1.1rem' }}>Additional Parameters</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem', alignItems: 'end' }}>
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
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>Max Budget (RUB)</label>
              <input 
                type="number" 
                placeholder="No limit" 
                value={maxPrice} 
                onChange={e => setMaxPrice(e.target.value)} 
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
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                Magazine Capacity (rounds)
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {getAvailableCapacities(weapon, allMods).map(capacity => {
                  const isSelected = Number(magazineCapacity) === capacity;
                  return (
                    <button
                      key={capacity}
                      type="button"
                      className={`btn ${isSelected ? '' : 'btn-outline'}`}
                      onClick={() => setMagazineCapacity(capacity)}
                      style={{
                        minWidth: '50px',
                        padding: '0.75rem 1rem',
                        fontSize: '0.85rem',
                        borderColor: 'var(--color-accent-gold-dark)',
                        color: isSelected ? 'var(--color-bg-base)' : 'var(--color-accent-gold)',
                        background: isSelected ? 'var(--color-accent-gold-dark)' : 'transparent',
                      }}
                    >
                      {capacity}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div style={{ marginTop: 'auto', paddingTop: '2rem' }}>
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
      </div>
    </div>
  );
}

export default Configurator;