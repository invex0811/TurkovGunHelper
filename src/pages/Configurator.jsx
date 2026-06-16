import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  PRICE_CONFIDENCE,
  PRICE_MODE_LABELS,
  PRICE_MODE_OPTIONS,
  PRICE_MODES,
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

function calculateSimilarityDistance(node, b, priceMode) {
  const subtreeParts = [];
  function collect(n) {
    if (n && n.item) {
      subtreeParts.push(n.item);
      (n.children || []).forEach(collect);
    }
  }
  collect(node);

  const ergoA = subtreeParts.reduce((sum, item) => sum + (item.ergonomicsModifier || 0), 0);
  const recoilA = subtreeParts.reduce((sum, item) => sum + (item.recoilModifier || 0), 0);
  const weightA = subtreeParts.reduce((sum, item) => sum + (item.weight || 0), 0);

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

  const priceA = subtreeParts.reduce((sum, item) => sum + getPrice(item), 0);

  const ergoB = (b.ergonomicsModifier || 0) + (b.attachedScope ? (b.attachedScope.ergonomicsModifier || 0) : 0);
  const recoilB = (b.recoilModifier || 0) + (b.attachedScope ? (b.attachedScope.recoilModifier || 0) : 0);
  const weightB = (b.weight || 0) + (b.attachedScope ? (b.attachedScope.weight || 0) : 0);
  const priceB = getPrice(b) + (b.attachedScope ? getPrice(b.attachedScope) : 0);

  const dErgo = Math.abs(ergoA - ergoB) * 1.5;
  const dRecoil = Math.abs(recoilA - recoilB) * 4.0;
  const dWeight = Math.abs(weightA - weightB) * 2.0;
  const dPrice = Math.abs(priceA - priceB) * 0.0001;

  return dErgo + dRecoil + dWeight + dPrice;
}

function isValidSightForMode(item, sightMode) {
  const cats = (item.categories || []).map(c => c.name);
  if (cats.includes('Ironsight')) {
    return false;
  }
  if (cats.includes('Thermal Vision') || cats.includes('Night Vision') || cats.includes('Special scope')) {
    return false;
  }

  const mode = sightMode || 'any';
  if (mode === 'none' || mode === 'any') return true;

  const isReflex = cats.includes('Reflex sight') || cats.includes('Compact reflex sight');
  const isMagnified = cats.includes('Scope') || cats.includes('Assault scope');

  if (mode === 'reflex') return isReflex;
  if (mode === 'scope') return isMagnified;

  const parsedMode = Number(mode);
  if (!isNaN(parsedMode)) {
    const zoomLevels = item.properties?.zoomLevels;
    if (zoomLevels) {
      const flatZooms = zoomLevels.flat();
      return flatZooms.includes(parsedMode);
    }
    if (parsedMode === 1) {
      return isReflex;
    }
    return false;
  }

  return true;
}

function scoreScope(item, priceMode) {
  const ergo = item.ergonomicsModifier || 0;
  const recoil = item.recoilModifier || 0;
  const weight = item.weight || 0;
  
  function getRawPrice(it) {
    return it.avg24hPrice
      || it.lastLowPrice
      || it.low24hPrice
      || it.basePrice
      || 0;
  }

  function getPrice(it) {
    if (!priceMode || it.price?.mode === priceMode) {
      return it.price?.value ?? getRawPrice(it);
    }
    return getRawPrice(it);
  }

  const price = getPrice(item);

  return ergo - recoil * 5 - weight * 10 - (price > 0 ? price * 0.0001 : 0);
}

function findCompatibleAlternatives(node, allMods, currentBuild, priceMode, sightMode) {
  if (!node || !node.parent) return [];

  const parentItem = node.parent.item;
  const parentSlot = parentItem.properties?.slots?.find(s => s.name === node.slotName);
  if (!parentSlot) return [];

  const allowedIds = new Set((parentSlot.filters?.allowedItems || []).map(a => a.id));
  
  const subtreeIds = new Set();
  const subtreeParts = [];
  function collectSubtree(n) {
    if (n && n.item) {
      subtreeIds.add(n.item.id);
      subtreeParts.push(n.item);
      (n.children || []).forEach(collectSubtree);
    }
  }
  collectSubtree(node);

  const currentSight = subtreeParts.find(item => 
    (item.categories || []).map(c => c.name).includes('Sights')
  );

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

  const targetCats = (node.item.categories || []).map(c => typeof c === 'string' ? c.toLowerCase() : (c.name || '').toLowerCase());
  const targetIsMount = targetCats.includes('mount');

  const alternatives = [];

  Object.keys(allMods).forEach(modId => {
    if (modId === node.item.id) return;
    if (!allowedIds.has(modId)) return;

    const altItem = allMods[modId];
    if (!altItem) return;

    if (currentSight && altItem.id === currentSight.id) return;

    const altCats = (altItem.categories || []).map(c => typeof c === 'string' ? c.toLowerCase() : (c.name || '').toLowerCase());
    
    if (targetIsMount && !altCats.includes('mount')) return;
    
    const isMount = altCats.includes('mount');
    let sightSlot = null;
    let bestScope = null;
    
    if (isMount && !targetIsMount) {
      const slots = altItem.properties?.slots || [];
      for (const slot of slots) {
        const allowedSights = (slot.filters?.allowedItems || []).filter(a => {
          const allowedItem = allMods[a.id];
          if (!allowedItem) return false;
          const allowedCats = (allowedItem.categories || []).map(c => typeof c === 'string' ? c.toLowerCase() : (c.name || '').toLowerCase());
          return allowedCats.includes('sights');
        });
        if (allowedSights.length > 0) {
          sightSlot = slot;
          break;
        }
      }
      
      if (sightSlot) {
        let bestScopeScore = -Infinity;
        const allowedItems = sightSlot.filters?.allowedItems || [];
        for (const allowed of allowedItems) {
          const scopeItem = allMods[allowed.id];
          if (!scopeItem) continue;
          
          if (!isValidSightForMode(scopeItem, sightMode)) continue;

          if (currentSight && scopeItem.id === currentSight.id) continue;
          
          const score = scoreScope(scopeItem, priceMode);
          if (score > bestScopeScore) {
            bestScopeScore = score;
            bestScope = scopeItem;
          }
        }
      }
      
      if (sightSlot && !bestScope) {
        return;
      }
    }

    if (altCats.includes('sights')) {
      if (!isValidSightForMode(altItem, sightMode)) {
        return;
      }
    }

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

    let altToPush = altItem;
    if (isMount && sightSlot && bestScope) {
      altToPush = {
        ...altItem,
        attachedScope: bestScope,
        attachedScopeSlotName: sightSlot.name
      };
    }
    alternatives.push(altToPush);
  });

  const uniqueAlternatives = new Map();
  alternatives.forEach(alt => {
    const altCats = (alt.categories || []).map(c => typeof c === 'string' ? c.toLowerCase() : (c.name || '').toLowerCase());
    const isSightOrHasAttached = altCats.includes('sights') || alt.attachedScope;
    if (isSightOrHasAttached) {
      const sightId = alt.attachedScope ? alt.attachedScope.id : alt.id;
      const existing = uniqueAlternatives.get(sightId);
      if (!existing) {
        uniqueAlternatives.set(sightId, alt);
      } else {
        const distAlt = calculateSimilarityDistance(node, alt, priceMode);
        const distExisting = calculateSimilarityDistance(node, existing, priceMode);
        if (distAlt < distExisting) {
          uniqueAlternatives.set(sightId, alt);
        }
      }
    } else {
      uniqueAlternatives.set(alt.id, alt);
    }
  });

  const filteredAlternatives = Array.from(uniqueAlternatives.values());

  filteredAlternatives.sort((a, b) => {
    const distA = calculateSimilarityDistance(node, a, priceMode);
    const distB = calculateSimilarityDistance(node, b, priceMode);
    return distA - distB;
  });

  return filteredAlternatives;
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

function getAvailableZoomLevels(allMods) {
  if (!allMods) return [];
  const zooms = new Set();

  Object.values(allMods).forEach(mod => {
    const cats = (mod.categories || []).map(c => c.name);
    if (cats.includes('Ironsight')) return;

    if (cats.includes('Sights')) {
      const zoomLevels = mod.properties?.zoomLevels;
      if (zoomLevels) {
        const flat = zoomLevels.flat();
        flat.forEach(z => {
          if (typeof z === 'number' && z > 0) {
            zooms.add(z);
          }
        });
      } else {
        const isReflex = cats.includes('Reflex sight') || cats.includes('Compact reflex sight');
        if (isReflex) {
          zooms.add(1);
        }
      }
    }
  });

  return Array.from(zooms).sort((a, b) => a - b);
}

const SLOT_GROUP_NAME_MAPPINGS = {
  'reciever': 'Receiver',
  'receiver': 'Receiver',
  'pistolgrip': 'Pistol Grip',
  'pistol grip': 'Pistol Grip',
  'grip': 'Pistol Grip',
  'gasblock': 'Gas Block',
  'front sight': 'Front Sight',
  'rear sight': 'Rear Sight',
  'ubgl': 'Underbarrel Launcher',
  'tactical': 'Tactical Device',
  'foregrip': 'Foregrip',
  'bipod': 'Bipod',
  'launcher': 'Launcher',
  'scope': 'Scope / Sight',
  'mount': 'Mount / Adapter',
  'charge': 'Charging Handle',
  'charging handle': 'Charging Handle',
  'dustcover': 'Dust Cover',
  'dust cover': 'Dust Cover',
  'barrel': 'Barrel',
  'handguard': 'Handguard',
  'muzzle': 'Muzzle Device',
  'stock': 'Stock',
  'magazine': 'Magazine'
};

function getReadableSlotGroupName(slotName) {
  if (!slotName) return 'Other';
  let name = slotName.trim().toLowerCase();
  
  if (name.startsWith('mod_')) {
    name = name.substring(4);
  }
  
  name = name.replace(/[\s_-]+/g, ' ');
  
  if (SLOT_GROUP_NAME_MAPPINGS[name]) {
    return SLOT_GROUP_NAME_MAPPINGS[name];
  }
  
  return name.split(' ')
             .map(word => word.charAt(0).toUpperCase() + word.slice(1))
             .join(' ');
}

const GROUP_ORDER = [
  'Receiver',
  'Charging Handle',
  'Dust Cover',
  'Barrel',
  'Gas Block',
  'Handguard',
  'Foregrip',
  'Muzzle Device',
  'Mount / Adapter',
  'Scope / Sight',
  'Front Sight',
  'Rear Sight',
  'Stock',
  'Pistol Grip',
  'Magazine',
  'Tactical Device',
  'Bipod',
  'Underbarrel Launcher'
];

function Configurator() {
  const { weaponId } = useParams();
  const [weapon, setWeapon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [targetType, setTargetType] = useState(loadTargetTypePreference);
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
  const [includeLaser, setIncludeLaser] = useState(false);
  const [includeFlashlight, setIncludeFlashlight] = useState(false);
  const [sightMode, setSightMode] = useState('any');
  const [partsFilter, setPartsFilter] = useState('');
  
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
    
    const assemblyTree = buildAssemblyTree(weapon, buildResult.build);
    let targetNode = null;
    function findNode(n) {
      if (n.item.id === targetPart.id) {
        targetNode = n;
        return;
      }
      n.children.forEach(findNode);
    }
    findNode(assemblyTree);

    const targetCats = (targetPart.categories || []).map(c => typeof c === 'string' ? c.toLowerCase() : (c.name || '').toLowerCase());
    const targetIsMount = targetCats.includes('mount');

    const subtreeIds = new Set();
    if (targetNode) {
      if (targetIsMount) {
        subtreeIds.add(targetNode.item.id);
      } else {
        function checkCompatibilityAndCollect(nodeToCheck, parentItem) {
          nodeToCheck.children.forEach(child => {
            const slots = parentItem.properties?.slots || [];
            const matchingSlot = slots.find(s => s.name === child.slotName);
            
            let isCompatible = false;
            if (matchingSlot) {
              const allowedIds = new Set((matchingSlot.filters?.allowedItems || []).map(a => a.id));
              if (allowedIds.has(child.item.id)) {
                isCompatible = true;
              }
            }
            
            if (isCompatible) {
              checkCompatibilityAndCollect(child, child.item);
            } else {
              function collectAll(n) {
                subtreeIds.add(n.item.id);
                n.children.forEach(collectAll);
              }
              collectAll(child);
            }
          });
        }
        
        checkCompatibilityAndCollect(targetNode, alternativeItem);
        subtreeIds.add(targetNode.item.id);
      }
    }

    const updatedBuild = [];
    buildResult.build.forEach(part => {
      if (part.item.id === targetPart.id) {
        updatedBuild.push({
          ...part,
          item: alternativeItem
        });
      } else if (!subtreeIds.has(part.item.id)) {
        updatedBuild.push(part);
      }
    });

    if (alternativeItem.attachedScope && alternativeItem.attachedScopeSlotName) {
      updatedBuild.push({
        slotName: alternativeItem.attachedScopeSlotName,
        item: alternativeItem.attachedScope
      });
    }

    const updatedResult = recalculateBuildStats(weapon, updatedBuild, { priceMode });
    
    setBuildResult(updatedResult);
    setActiveReplacePartId(null);
  };

  const handleGenerate = useCallback(async () => {
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
        includeLaser,
        includeFlashlight,
        sightMode,
        requireSight: sightMode !== 'none',
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
  }, [allMods, suppressorMode, maxWeight, maxPrice, magazineCapacity, priceMode, includeLaser, includeFlashlight, sightMode, weapon, targetType, customErgo, customRecoil]);

  const handleReset = () => {
    setTargetType('meta');
    setSuppressorMode('allow');
    setPriceMode(PRICE_MODES.PVP);
    setMaxWeight('');
    setMaxPrice('');
    
    const capacities = getAvailableCapacities(weapon, allMods);
    if (capacities.length > 0) {
      if (capacities.includes(30)) {
        setMagazineCapacity(30);
      } else {
        setMagazineCapacity(capacities[0]);
      }
    }
    
    setSightMode('any');
    setIncludeLaser(false);
    setIncludeFlashlight(false);
    setCustomErgo(50);
    setCustomRecoil(50);
    setBuildResult(null);
    setGenerationError(null);
  };

  // Регистрация слушателя событий от верхней кнопки Generate Build в шапке
  useEffect(() => {
    const onGenerate = () => {
      handleGenerate();
    };
    window.addEventListener('generate-build', onGenerate);
    return () => {
      window.removeEventListener('generate-build', onGenerate);
    };
  }, [handleGenerate]);

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

  const hasCalculationError = buildResult ? Boolean(buildResult.error) : false;
  const hasBuildParts = buildResult ? (Array.isArray(buildResult.build) && buildResult.build.length > 0) : false;
  const canShowBuildDetails = buildResult && !hasCalculationError && hasBuildParts;
  const priceDiagnostics = canShowBuildDetails
    ? collectBuildPriceDiagnostics(weapon, buildResult, priceMode)
    : null;

  // Рассчитываем текущие значения для панели метрик
  const currentErgo = canShowBuildDetails ? buildResult.stats.ergonomics : (weapon.properties?.ergonomics ?? 'N/A');
  const currentWeight = canShowBuildDetails ? `${buildResult.stats.weight} kg` : (weapon.weight ? `${weapon.weight} kg` : 'N/A');
  const currentRecoilV = canShowBuildDetails ? buildResult.stats.recoilVertical : (weapon.properties?.recoilVertical ?? 'N/A');
  const currentRecoilH = canShowBuildDetails ? buildResult.stats.recoilHorizontal : (weapon.properties?.recoilHorizontal ?? 'N/A');
  const currentPrice = canShowBuildDetails 
    ? formatCurrency(buildResult.stats.price, 'RUB') 
    : formatCurrency(getSelectedPriceInfo(weapon, priceMode).value, 'RUB');

  // Группировка деталей сборки
  const partsGroups = [];
  if (canShowBuildDetails) {
    const groupMap = new Map();
    buildResult.build.forEach(part => {
      const slotGroup = getReadableSlotGroupName(part.slotName);
      let group = groupMap.get(slotGroup);
      if (!group) {
        group = {
          rootSlotName: slotGroup,
          parts: []
        };
        groupMap.set(slotGroup, group);
        partsGroups.push(group);
      }
      group.parts.push(part);
    });

    partsGroups.sort((a, b) => {
      let indexA = GROUP_ORDER.indexOf(a.rootSlotName);
      let indexB = GROUP_ORDER.indexOf(b.rootSlotName);
      if (indexA === -1) indexA = 999;
      if (indexB === -1) indexB = 999;
      if (indexA !== indexB) {
        return indexA - indexB;
      }
      return a.rootSlotName.localeCompare(b.rootSlotName);
    });
  }

  // Фильтрация групп деталей для рендеринга
  const renderedGroups = partsGroups.map(group => {
    const filteredParts = group.parts.filter(part => {
      if (!partsFilter.trim()) return true;
      const q = partsFilter.trim().toLowerCase();
      const name = (part.item.name || '').toLowerCase();
      const shortName = (part.item.shortName || '').toLowerCase();
      const slot = (part.slotName || '').toLowerCase();
      const groupName = group.rootSlotName.toLowerCase();
      return name.includes(q) || shortName.includes(q) || slot.includes(q) || groupName.includes(q);
    });
    return {
      ...group,
      parts: filteredParts
    };
  }).filter(group => group.parts.length > 0);

  return (
    <div className="layout">
      {/* Левый сайдбар с конфигурацией сборки */}
      <aside className="config" aria-label="Build Configuration">
        <div className="config__head">
          <h2>Build Configuration</h2>
          <button className="btn btn--ghost" type="button" onClick={handleReset}>Reset</button>
        </div>

        <section className="config__section">
          <label className="field-label">Build Goal</label>
          <div className="segmented">
            {[
              { value: 'meta', label: 'Meta (Top)' },
              { value: 'max_ergo', label: 'Max Ergonomics' },
              { value: 'min_recoil', label: 'Min Recoil' },
              { value: 'budget', label: 'Budget' },
              { value: 'custom', label: 'Custom' }
            ].map(option => (
              <button
                key={option.value}
                className={`segmented__btn ${targetType === option.value ? 'is-active' : ''}`}
                type="button"
                onClick={() => setTargetType(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        {targetType === 'custom' && (
          <section className="config__section" style={{ paddingBottom: '8px' }}>
            <div className="input-grid">
              <div>
                <label className="field-label">Min Ergonomics</label>
                <input 
                  type="number" 
                  value={customErgo} 
                  onChange={e => setCustomErgo(e.target.value)} 
                />
              </div>
              <div>
                <label className="field-label">Max Recoil</label>
                <input 
                  type="number" 
                  value={customRecoil} 
                  onChange={e => setCustomRecoil(e.target.value)} 
                />
              </div>
            </div>
          </section>
        )}

        <section className="config__section">
          <label className="field-label">Suppressor Mode</label>
          <div className="segmented">
            {SUPPRESSOR_MODE_OPTIONS.map(option => (
              <button
                key={option.value}
                className={`segmented__btn ${suppressorMode === option.value ? 'is-active' : ''}`}
                type="button"
                onClick={() => setSuppressorMode(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="config__section">
          <label className="field-label">Price Mode</label>
          <div className="segmented">
            {PRICE_MODE_OPTIONS.map(option => (
              <button
                key={option.value}
                className={`segmented__btn ${priceMode === option.value ? 'is-active' : ''}`}
                type="button"
                onClick={() => setPriceMode(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <section className="config__section">
          <div className="input-grid">
            <div>
              <label className="field-label" htmlFor="maxWeight">Max Weight (kg)</label>
              <input 
                id="maxWeight" 
                type="number" 
                placeholder="No limit" 
                min="0" 
                step="0.01"
                value={maxWeight}
                onChange={e => setMaxWeight(e.target.value)}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="maxBudget">Max Budget (RUB)</label>
              <input 
                id="maxBudget" 
                type="number" 
                placeholder="No limit" 
                min="0" 
                step="1000"
                value={maxPrice}
                onChange={e => setMaxPrice(e.target.value)}
              />
            </div>
          </div>
        </section>

        <section className="config__section">
          <label className="field-label">Magazine Capacity (rounds)</label>
          <div className="segmented segmented--small">
            {getAvailableCapacities(weapon, allMods).map(capacity => (
              <button
                key={capacity}
                className={`segmented__btn ${Number(magazineCapacity) === capacity ? 'is-active' : ''}`}
                type="button"
                onClick={() => setMagazineCapacity(capacity)}
              >
                {capacity}
              </button>
            ))}
          </div>
        </section>

        <section className="config__section">
          <label className="field-label" htmlFor="sightZoom">Sight Zoom / Type</label>
          <select 
            id="sightZoom" 
            value={sightMode} 
            onChange={e => setSightMode(e.target.value)}
          >
            {[
              { value: 'none', label: 'NO SIGHT' },
              { value: 'any', label: 'ANY SIGHT' },
              { value: 'reflex', label: 'REFLEX (1x)' },
              { value: 'scope', label: 'SCOPE (Any zoom)' },
              ...getAvailableZoomLevels(allMods)
                .filter(z => z > 1)
                .map(z => ({ value: String(z), label: `${z}x Zoom` }))
            ].map(option => (
              <option 
                key={option.value} 
                value={option.value}
                style={{ backgroundColor: 'var(--surface-3)', color: 'var(--text)' }}
              >
                {option.label}
              </option>
            ))}
          </select>
        </section>

        <section className="config__section">
          <label className="field-label">Tactical Accessories</label>
          <div className="checks">
            <label className="check">
              <input 
                type="checkbox" 
                checked={includeLaser}
                onChange={e => setIncludeLaser(e.target.checked)}
              /> 
              <span>Laser / TBL</span>
            </label>
            <label className="check">
              <input 
                type="checkbox" 
                checked={includeFlashlight}
                onChange={e => setIncludeFlashlight(e.target.checked)}
              /> 
              <span>Flashlight</span>
            </label>
          </div>
        </section>

        <section className="config__section">
          <button 
            className="btn btn--primary" 
            type="button" 
            style={{ width: '100%' }}
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? 'Calculating...' : 'Generate Build'}
          </button>
        </section>
      </aside>

      {/* Правая основная область */}
      <main>
        {/* Панель метрик сверху */}
        <section className="summary" aria-label="Build Stats">
          <div className="metric">
            <span>Ergonomics</span>
            <strong>{currentErgo}</strong>
          </div>
          <div className="metric">
            <span>Weight</span>
            <strong>{currentWeight}</strong>
          </div>
          <div className="metric">
            <span>V. Recoil / H. Recoil</span>
            <strong>
              {typeof currentRecoilV === 'number' && typeof currentRecoilH === 'number'
                ? `${currentRecoilV} / ${currentRecoilH}`
                : currentRecoilV}
            </strong>
          </div>
          <div className="metric">
            <span>Estimated Price</span>
            <strong>{currentPrice}</strong>
          </div>
        </section>

        {/* Сетка: Карточка оружия и Сводка деталей */}
        <div className="main-grid">
          {/* Левая панель - Оружие */}
          <section className="panel weapon">
            <div className="weapon__head">
              <div>
                <h2>{weapon.shortName}</h2>
                <p>{weapon.name}</p>
              </div>
              <div className="source">
                {priceDiagnostics?.summaryLabel || `${PRICE_MODE_LABELS[priceMode]} · tarkov.dev · primary market prices`}
              </div>
            </div>

            <div className="weapon__image">
              <ImageWithLoader 
                src={weapon.properties?.defaultPreset?.image512pxLink || weapon.image512pxLink || weapon.iconLink} 
                alt={weapon.shortName} 
                style={{ maxWidth: '100%', maxHeight: '250px', objectFit: 'contain' }} 
                containerStyle={{ minHeight: '200px' }}
              />
            </div>

            {/* Шкалы сравнения статов */}
            <div className="stat-compare">
              {(() => {
                const ergoVal = typeof currentErgo === 'number' ? currentErgo : 0;
                const recVal = typeof currentRecoilV === 'number' ? currentRecoilV : 0;
                const recHVal = typeof currentRecoilH === 'number' ? currentRecoilH : 0;
                
                return (
                  <>
                    <div className="stat-row">
                      <span>Ergonomics</span>
                      <div className="bar">
                        <span style={{ '--value': `${Math.min(100, Math.max(0, ergoVal))}%` }} className="is-good"></span>
                      </div>
                      <strong>{currentErgo}</strong>
                    </div>
                    <div className="stat-row">
                      <span>Vertical Recoil</span>
                      <div className="bar">
                        <span style={{ '--value': `${Math.min(100, Math.max(0, recVal))}%` }}></span>
                      </div>
                      <strong>{currentRecoilV}</strong>
                    </div>
                    <div className="stat-row">
                      <span>Horizontal Recoil</span>
                      <div className="bar">
                        <span style={{ '--value': `${Math.min(100, Math.max(0, recHVal))}%` }}></span>
                      </div>
                      <strong>{currentRecoilH}</strong>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Чипсы настроек сборки */}
            <div className="control-state">
              <div className="chip">
                Goal 
                <strong>
                  {targetType === 'meta' ? 'Meta (Top)' : targetType === 'max_ergo' ? 'Max Ergonomics' : targetType === 'min_recoil' ? 'Min Recoil' : targetType === 'budget' ? 'Budget' : 'Custom'}
                </strong>
              </div>
              <div className="chip">
                Suppressor 
                <strong>
                  {suppressorMode === 'allow' ? 'Allow suppressors' : suppressorMode === 'forbid' ? 'Forbid suppressors' : 'Require suppressor'}
                </strong>
              </div>
              <div className="chip">
                Magazine 
                <strong>{magazineCapacity} rounds</strong>
              </div>
              <div className="chip">
                Sight 
                <strong>
                  {sightMode === 'none' ? 'NO SIGHT' : sightMode === 'any' ? 'ANY SIGHT' : sightMode === 'reflex' ? 'REFLEX (1x)' : sightMode === 'scope' ? 'SCOPE (Any zoom)' : `${sightMode}x Zoom`}
                </strong>
              </div>
            </div>
          </section>

          {/* Правая панель - Список деталей */}
          <section className="panel parts-panel">
            {/* Поле поиска */}
            <div className="parts-toolbar">
              <input 
                type="search" 
                placeholder="Filter parts..." 
                value={partsFilter}
                onChange={e => setPartsFilter(e.target.value)}
              />
              <button 
                className="btn btn--ghost" 
                type="button"
                onClick={() => setPartsFilter('')}
              >
                Clear
              </button>
            </div>

            {/* Вывод ошибок при расчете сборки */}
            {generationError && (
              <InlineMessage type="error" title="Build generation failed">
                {generationError}
              </InlineMessage>
            )}

            {buildResult && hasCalculationError && (
              <InlineMessage type="error" title="Constraint satisfaction failed">
                {buildResult.error}
              </InlineMessage>
            )}

            {buildResult && !hasCalculationError && buildResult.warning && (
              <InlineMessage type="warning" title="Build notice">
                {buildResult.warning}
              </InlineMessage>
            )}

            {canShowBuildDetails && priceDiagnostics?.warningMessages.length > 0 && (
              <InlineMessage type="warning" title="Price data notice">
                {priceDiagnostics.warningMessages.join(' ')}
              </InlineMessage>
            )}

            {/* Рендеринг сгруппированных деталей */}
            {!generating && canShowBuildDetails && renderedGroups.map((group, groupIdx) => (
              <div key={groupIdx} className="parts-group">
                <div className="parts-group__head">
                  <h3>{group.rootSlotName}</h3>
                  <span>{group.parts.length} parts</span>
                </div>
                <div className="parts-grid">
                  {group.parts.map(part => {
                    const partPriceInfo = getSelectedPriceInfo(part.item, priceMode);
                    
                    return (
                      <article key={part.item.id} className="part-card">
                        <div className="part-card__media">
                          <ImageWithLoader 
                            src={part.item.image512pxLink || part.item.iconLink || 'https://via.placeholder.com/70'} 
                            alt="" 
                            style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', width: 'auto', height: 'auto' }}
                            containerStyle={{ width: '100%', height: '100%' }}
                          />
                        </div>
                        <div className="part-card__body">
                          <div className="part-card__topline">
                            <span>{part.slotName}</span>
                            <strong>{formatCurrency(partPriceInfo.value, partPriceInfo.currency)}</strong>
                          </div>
                          <h4>{formatPartName(part.item.shortName)}</h4>
                          <button 
                            className={`replace-btn ${activeReplacePartId === part.item.id ? 'active' : ''}`}
                            type="button"
                            onClick={() => setActiveReplacePartId(activeReplacePartId === part.item.id ? null : part.item.id)}
                          >
                            Replace
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}

            {!generating && !buildResult && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '3rem 2rem', border: '1px dashed var(--line)', borderRadius: 'var(--radius)', color: 'var(--muted)', fontSize: '0.95rem' }}>
                Configure parameters and click "Generate Build" to see the optimal parts list here.
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Оверлей бокового слайдера (Drawer) для замены деталей */}
      {activeReplacePartId && (() => {
        const activePart = buildResult?.build.find(p => p.item.id === activeReplacePartId);
        if (!activePart) return null;
        
        const priceInfo = getSelectedPriceInfo(activePart.item, priceMode);
        const assemblyTree = buildAssemblyTree(weapon, buildResult.build);
        
        let targetNode = null;
        function findNode(n) {
          if (n.item.id === activePart.item.id) {
            targetNode = n;
            return;
          }
          n.children.forEach(findNode);
        }
        findNode(assemblyTree);

        const alternatives = targetNode 
          ? findCompatibleAlternatives(targetNode, allMods, buildResult, priceMode, sightMode)
          : [];

        return (
          <div className="drawer is-open" onClick={() => setActiveReplacePartId(null)}>
            <div className="drawer__panel" onClick={e => e.stopPropagation()}>
              <div className="drawer__head">
                <h2>Replace Part</h2>
                <button className="btn btn--ghost" type="button" onClick={() => setActiveReplacePartId(null)}>Close</button>
              </div>
              <div className="drawer__body" style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 100px)', paddingRight: '4px' }}>
                <div className="drawer__part">
                  <ImageWithLoader
                    src={activePart.item.image512pxLink || activePart.item.iconLink || 'https://via.placeholder.com/70'}
                    alt={activePart.item.shortName}
                    style={{ width: '70px', height: '70px', objectFit: 'contain' }}
                    containerStyle={{ width: '70px', height: '70px', background: '#101310', border: '1px solid rgba(204, 194, 158, 0.1)', borderRadius: '6px' }}
                  />
                  <div>
                    <div className="generated-meta">{getReadableSlotGroupName(activePart.slotName)} - Slot: {activePart.slotName}</div>
                    <h3 style={{ margin: '8px 0 6px', fontSize: '1.1rem' }}>{formatPartName(activePart.item.shortName)}</h3>
                    <strong style={{ color: 'var(--color-accent-gold)' }}>{formatCurrency(priceInfo.value, priceInfo.currency)}</strong>
                  </div>
                </div>

                <div style={{ marginTop: '1.5rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-accent-gold)', marginBottom: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    Compatible Alternatives ({alternatives.length})
                  </div>
                  {alternatives.length === 0 ? (
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '1rem 0' }}>
                      {targetNode && targetNode.children.length > 0
                        ? "No fully compatible alternatives found that support all currently installed attachments. Try replacing or removing some attachments first."
                        : "No fully compatible alternative modules found in the database."}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {alternatives.map(alt => {
                        const altPriceInfo = getSelectedPriceInfo(alt, priceMode);
                        const altPriceValue = altPriceInfo.value + 
                          (alt.attachedScope ? getSelectedPriceInfo(alt.attachedScope, priceMode).value : 0);
                        
                        const baselineParts = [];
                        if (targetNode) {
                          baselineParts.push(targetNode.item);
                          if (alt.attachedScope) {
                            function collectChildren(n) {
                              n.children.forEach(c => {
                                baselineParts.push(c.item);
                                collectChildren(c);
                              });
                            }
                            collectChildren(targetNode);
                          }
                        }

                        const baselinePrice = baselineParts.reduce((sum, item) => sum + getSelectedPriceInfo(item, priceMode).value, 0);
                        const baselineErgo = baselineParts.reduce((sum, item) => sum + (item.ergonomicsModifier || 0), 0);
                        const baselineRecoil = baselineParts.reduce((sum, item) => sum + (item.recoilModifier || 0), 0);
                        const baselineWeight = baselineParts.reduce((sum, item) => sum + (item.weight || 0), 0);

                        const ergoDiff = ((alt.ergonomicsModifier || 0) + (alt.attachedScope ? (alt.attachedScope.ergonomicsModifier || 0) : 0)) - baselineErgo;
                        const recoilDiff = ((alt.recoilModifier || 0) + (alt.attachedScope ? (alt.attachedScope.recoilModifier || 0) : 0)) - baselineRecoil;
                        const priceDiff = altPriceValue - baselinePrice;
                        const weightDiff = ((alt.weight || 0) + (alt.attachedScope ? (alt.attachedScope.weight || 0) : 0)) - baselineWeight;
                      
                        const baseRecoilV = weapon.properties?.recoilVertical || 0;
                        const baseRecoilH = weapon.properties?.recoilHorizontal || 0;
                        const recoilDiffV = baseRecoilV * (recoilDiff / 100);
                        const recoilDiffH = baseRecoilH * (recoilDiff / 100);

                        const ergoDiffText = ergoDiff === 0 ? '0' : ergoDiff > 0 ? `+${parseFloat(ergoDiff.toFixed(2))}` : `${parseFloat(ergoDiff.toFixed(2))}`;
                        
                        function formatRecoilDiff(v, h, pct) {
                          const formatNum = (num) => {
                            const rounded = Math.round(num);
                            return rounded > 0 ? `+${rounded}` : `${rounded}`;
                          };
                          const pctText = pct === 0 ? '0%' : pct > 0 ? `+${parseFloat(pct.toFixed(2))}%` : `${parseFloat(pct.toFixed(2))}%`;
                          if (Math.round(v) === 0 && Math.round(h) === 0) return `0 (${pctText})`;
                          return `${formatNum(v)} / ${formatNum(h)} (${pctText})`;
                        }
                        const recoilDiffText = formatRecoilDiff(recoilDiffV, recoilDiffH, recoilDiff);
                        const weightDiffText = weightDiff === 0 ? '0 kg' : weightDiff > 0 ? `+${parseFloat(weightDiff.toFixed(3))} kg` : `${parseFloat(weightDiff.toFixed(3))} kg`;

                        return (
                          <div 
                            key={alt.id}
                            onClick={() => handleReplacePart(activePart.item, alt)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              padding: '0.6rem 0.75rem',
                              background: 'rgba(255,255,255,0.02)',
                              border: '1px solid rgba(204, 194, 158, 0.12)',
                              borderRadius: '6px',
                              cursor: 'pointer',
                              transition: 'all 0.16s ease',
                              boxSizing: 'border-box'
                            }}
                            onMouseEnter={e => {
                              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                              e.currentTarget.style.borderColor = 'rgba(204, 194, 158, 0.42)';
                            }}
                            onMouseLeave={e => {
                              e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                              e.currentTarget.style.borderColor = 'rgba(204, 194, 158, 0.12)';
                            }}
                          >
                            <ImageWithLoader
                              src={
                                (alt.attachedScope && (alt.attachedScope.image512pxLink || alt.attachedScope.iconLink))
                                || alt.image512pxLink 
                                || alt.iconLink 
                                || 'https://via.placeholder.com/30'
                              }
                              alt=""
                              style={{ width: '40px', height: '40px', objectFit: 'contain' }}
                              containerStyle={{ width: '40px', height: '40px', marginRight: '0.75rem', background: '#101310', border: '1px solid rgba(204, 194, 158, 0.1)', borderRadius: '6px' }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '0.85rem', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>
                                {alt.attachedScope 
                                  ? `${formatPartName(alt.shortName)} + ${formatPartName(alt.attachedScope.shortName)}` 
                                  : formatPartName(alt.shortName)}
                              </div>
                              <div style={{ fontSize: '0.72rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', color: 'var(--muted)' }}>
                                <span>
                                  Ergo:{' '}
                                  <strong style={{ color: ergoDiff > 0 ? 'var(--green)' : ergoDiff < 0 ? 'var(--red)' : 'var(--muted)' }}>
                                    {ergoDiffText}
                                  </strong>
                                </span>
                                <span>
                                  Recoil:{' '}
                                  <strong style={{ color: recoilDiff < 0 ? 'var(--green)' : recoilDiff > 0 ? 'var(--red)' : 'var(--muted)' }}>
                                    {recoilDiffText}
                                  </strong>
                                </span>
                                <span>
                                  Weight:{' '}
                                  <strong style={{ color: weightDiff < 0 ? 'var(--green)' : weightDiff > 0 ? 'var(--red)' : 'var(--muted)' }}>
                                    {weightDiffText}
                                  </strong>
                                </span>
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', marginLeft: '0.5rem' }}>
                              <div style={{ fontSize: '0.85rem', color: 'var(--gold)', fontWeight: 'bold' }}>
                                {formatCurrency(altPriceValue, altPriceInfo.currency)}
                              </div>
                              <div style={{ fontSize: '0.7rem', color: priceDiff < 0 ? 'var(--green)' : priceDiff > 0 ? 'var(--red)' : 'var(--muted)' }}>
                                {priceDiff > 0 ? `+${formatCurrency(priceDiff, altPriceInfo.currency)}` : priceDiff < 0 ? formatCurrency(priceDiff, altPriceInfo.currency) : '0 RUB'}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default Configurator;