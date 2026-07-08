import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
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
      
      const partIdx = remainingParts.findIndex(part => {
        if (part.slotName !== slot.name || !allowedIds.has(part.item.id)) {
          return false;
        }
        // Prefer attaching to a more specific parent if one is present in remainingParts
        const hasAlternativeParent = remainingParts.some(otherPart => {
          if (otherPart === part) return false;
          const otherSlots = otherPart.item.properties?.slots || [];
          return otherSlots.some(s => 
            s.name === part.slotName && 
            (s.filters?.allowedItems || []).some(a => a.id === part.item.id)
          );
        });
        return !hasAlternativeParent;
      });

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

function getAlternativeAttachedParts(item) {
  if (Array.isArray(item.attachedParts)) {
    return item.attachedParts.map(part => part.item);
  }

  return item.attachedScope ? [item.attachedScope] : [];
}

function getAlternativePackageItems(item) {
  return [item, ...getAlternativeAttachedParts(item)];
}

function getAlternativeSight(item) {
  if (item.attachedScope) return item.attachedScope;
  return isSightItem(item) ? item : null;
}

function getAlternativeListKey(item) {
  if (Array.isArray(item.attachedParts) && item.attachedParts.length > 0) {
    return [item.id, ...item.attachedParts.map(part => part.item.id)].join('-');
  }

  return item.attachedScope ? `${item.id}-${item.attachedScope.id}` : item.id;
}

function getAlternativeDisplayName(item) {
  if (Array.isArray(item.attachedParts) && item.attachedParts.length > 0) {
    return [item, ...item.attachedParts.map(part => part.item)]
      .map(part => formatPartName(part.shortName))
      .join(' + ');
  }

  return item.attachedScope
    ? `${formatPartName(item.shortName)} + ${formatPartName(item.attachedScope.shortName)}`
    : formatPartName(item.shortName);
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

  const packageItems = getAlternativePackageItems(b);
  const ergoB = packageItems.reduce((sum, item) => sum + (item.ergonomicsModifier || 0), 0);
  const recoilB = packageItems.reduce((sum, item) => sum + (item.recoilModifier || 0), 0);
  const weightB = packageItems.reduce((sum, item) => sum + (item.weight || 0), 0);
  const priceB = packageItems.reduce((sum, item) => sum + getPrice(item), 0);

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

function getCategoryNames(item) {
  if (!item || !item.categories) return [];
  return item.categories.map(c => typeof c === 'string' ? c.toLowerCase() : (c.name || '').toLowerCase());
}

function isSightItem(item) {
  return getCategoryNames(item).includes('sights');
}

function isMountItem(item) {
  return getCategoryNames(item).includes('mount');
}

function subtreeHasSight(node) {
  if (!node) return false;
  if (isSightItem(node.item)) return true;
  return (node.children || []).some(subtreeHasSight);
}

function findSightNode(n) {
  if (!n) return null;
  if (isSightItem(n.item)) return n;
  for (const child of n.children) {
    const res = findSightNode(child);
    if (res) return res;
  }
  return null;
}

function getReplaceTarget(node, mode) {
  if (!node) return null;
  
  if (mode === 'EXACT_ITEM') {
    return node;
  }
  
  if (mode === 'SIGHT_ITEM') {
    const sightNode = findSightNode(node);
    return sightNode || node;
  }
  
  if (mode === 'SIGHT_MOUNT') {
    let curr = node;
    while (curr) {
      if (isMountItem(curr.item)) {
        return curr;
      }
      curr = curr.parent;
    }
    return node;
  }
  
  if (mode === 'SIGHT_ASSEMBLY') {
    let curr = node;
    let assemblyRoot = node;
    while (curr.parent && curr.parent.item) {
      if (isMountItem(curr.parent.item) || isSightItem(curr.parent.item)) {
        assemblyRoot = curr.parent;
        curr = curr.parent;
      } else {
        break;
      }
    }
    return assemblyRoot;
  }
  
  return node;
}

function findCompatibleAlternatives(node, allMods, currentBuild, priceMode, sightMode, mode = 'EXACT_ITEM') {
  if (!node) return [];

  // Находим реальную цель для замены
  const targetNode = getReplaceTarget(node, mode);
  if (!targetNode || !targetNode.parent) return [];

  const parentItem = targetNode.parent.item;
  const parentSlot = parentItem.properties?.slots?.find(s => s.name === targetNode.slotName);
  if (!parentSlot) return [];

  const allowedIds = new Set((parentSlot.filters?.allowedItems || []).map(a => a.id));

  // Собираем текущий прицел (если он есть в поддереве targetNode)
  const subtreeParts = [];
  function collectSubtree(n) {
    if (n && n.item) {
      subtreeParts.push(n.item);
      (n.children || []).forEach(collectSubtree);
    }
  }
  collectSubtree(targetNode);

  const currentSight = subtreeParts.find(isSightItem);

  // Находим корень всего оружия, чтобы построить дерево сборки и собрать остальную часть оружия
  function getRoot(n) {
    let curr = n;
    while (curr.parent) {
      curr = curr.parent;
    }
    return curr;
  }
  const rootNode = getRoot(targetNode);

  const remainingInstalledIds = new Set();
  function collectRemaining(n) {
    if (n !== targetNode) {
      remainingInstalledIds.add(n.item.id);
      n.children.forEach(collectRemaining);
    }
  }
  collectRemaining(buildAssemblyTree(rootNode.item, currentBuild.build));

  const targetIsSight = isSightItem(targetNode.item);
  const targetIsMount = isMountItem(targetNode.item);

  const alternatives = [];

  function collectRemainingIdsExcluding(excludedNode) {
    const excludedIds = new Set();
    function collectExcluded(n) {
      if (!n) return;
      excludedIds.add(n.item.id);
      n.children.forEach(collectExcluded);
    }
    collectExcluded(excludedNode);

    const ids = new Set();
    function collectRemainingNode(n) {
      if (!excludedIds.has(n.item.id)) {
        ids.add(n.item.id);
        n.children.forEach(collectRemainingNode);
      }
    }
    collectRemainingNode(buildAssemblyTree(rootNode.item, currentBuild.build));
    return ids;
  }

  function itemConflictsWithInstalled(item, installedIds) {
    for (const conflict of item.conflictingItems || []) {
      if (installedIds.has(conflict.id)) return true;
    }

    for (const installedId of installedIds) {
      const installedItem = allMods[installedId] || (installedId === rootNode.item.id ? rootNode.item : null);
      if (installedItem?.conflictingItems?.some(conflict => conflict.id === item.id)) {
        return true;
      }
    }

    return false;
  }

  function itemsConflictWithEachOther(a, b) {
    return (a.conflictingItems || []).some(conflict => conflict.id === b.id)
      || (b.conflictingItems || []).some(conflict => conflict.id === a.id);
  }

  function collectSightPackages(rootItem, remainingIds, currentSightItem, pathItems = [rootItem]) {
    const packages = [];
    const pathIds = new Set(pathItems.map(item => item.id));

    (rootItem.properties?.slots || []).forEach(slot => {
      (slot.filters?.allowedItems || []).forEach(allowed => {
        const childItem = allMods[allowed.id];
        if (!childItem || pathIds.has(childItem.id)) return;
        if (itemConflictsWithInstalled(childItem, remainingIds)) return;
        if (pathItems.some(pathItem => itemsConflictWithEachOther(pathItem, childItem))) return;

        if (isSightItem(childItem)) {
          if (currentSightItem && childItem.id === currentSightItem.id) return;
          if (!isValidSightForMode(childItem, sightMode)) return;

          packages.push({
            sight: childItem,
            attachedParts: [{
              slotName: slot.name,
              item: childItem
            }]
          });
          return;
        }

        if (!isMountItem(childItem)) return;

        const childPackages = collectSightPackages(
          childItem,
          remainingIds,
          currentSightItem,
          [...pathItems, childItem]
        );

        childPackages.forEach(pkg => {
          packages.push({
            sight: pkg.sight,
            attachedParts: [{
              slotName: slot.name,
              item: childItem
            }, ...pkg.attachedParts]
          });
        });
      });
    });

    return packages;
  }

  Object.keys(allMods).forEach(modId => {
    if (modId === targetNode.item.id) return;
    if (!allowedIds.has(modId)) return;

    const altItem = allMods[modId];
    if (!altItem) return;

    if (currentSight && altItem.id === currentSight.id) return;

    // 5. For SIGHT_ITEM alternatives, only show items allowed by the selected optic's parent slot.
    if (mode === 'SIGHT_ITEM' && !isSightItem(altItem)) return;

    // 6. For SIGHT_MOUNT alternatives, only show mount items allowed by the selected mount's parent slot.
    if (mode === 'SIGHT_MOUNT' && !isMountItem(altItem)) return;

    // Для EXACT_ITEM сохраняем категорию исходного элемента прицела/крепления
    if (mode === 'EXACT_ITEM') {
      if (targetIsSight && !isSightItem(altItem)) return;
      if (targetIsMount && !isMountItem(altItem)) return;
    }

    const isMount = isMountItem(altItem);
    let sightSlot = null;
    let bestScope = null;

    // 7. For SIGHT_ASSEMBLY alternatives, generate mount + compatible optic pairs.
    // Автоматическая сборка крепления с прицелом происходит только в режиме SIGHT_ASSEMBLY
    if (mode === 'SIGHT_ASSEMBLY' && isMount) {
      const slots = altItem.properties?.slots || [];
      for (const slot of slots) {
        const allowedSights = (slot.filters?.allowedItems || []).filter(a => {
          const allowedItem = allMods[a.id];
          return allowedItem && isSightItem(allowedItem);
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

      // Если в режиме сборки для крепления не нашлось подходящего прицела, пропускаем это крепление
      if (sightSlot && !bestScope) {
        return;
      }
    }

    // Если альтернатива является прицелом, проверим режим sightMode
    if (isSightItem(altItem)) {
      if (!isValidSightForMode(altItem, sightMode)) {
        return;
      }
    }

    // Проверяем совместимость с дочерними элементами
    let isCompatibleWithChildren = true;
    // Для EXACT_ITEM для не-прицельных деталей мы сохраняем совместимость с детьми
    if (mode === 'EXACT_ITEM' && !targetIsSight && !targetIsMount) {
      for (const childNode of targetNode.children) {
        const hasCompatibleSlot = (altItem.properties?.slots || []).some(s => 
          s.name === childNode.slotName && 
          (s.filters?.allowedItems || []).some(a => a.id === childNode.item.id)
        );
        if (!hasCompatibleSlot) {
          isCompatibleWithChildren = false;
          break;
        }
      }
    }
    if (!isCompatibleWithChildren) return;

    // Проверка конфликтов
    let hasConflict = false;
    for (const conflict of altItem.conflictingItems || []) {
      if (remainingInstalledIds.has(conflict.id)) {
        hasConflict = true;
        break;
      }
    }
    if (hasConflict) return;

    for (const installedId of remainingInstalledIds) {
      const installedItem = allMods[installedId] || (installedId === rootNode.item.id ? rootNode.item : null);
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
    if (mode === 'SIGHT_ASSEMBLY' && isMount && sightSlot && bestScope) {
      altToPush = {
        ...altItem,
        attachedScope: bestScope,
        attachedScopeSlotName: sightSlot.name
      };
    }
    alternatives.push(altToPush);
  });

  if (mode === 'SIGHT_ITEM' && isSightItem(targetNode.item)) {
    const assemblyRoot = getReplaceTarget(targetNode, 'SIGHT_ASSEMBLY');
    const assemblyParentItem = assemblyRoot?.parent?.item;
    const assemblyParentSlot = assemblyParentItem?.properties?.slots?.find(s => s.name === assemblyRoot.slotName);
    const assemblyAllowedItems = assemblyParentSlot?.filters?.allowedItems || [];

    if (assemblyRoot && assemblyParentSlot) {
      const remainingIdsForAssembly = collectRemainingIdsExcluding(assemblyRoot);

      assemblyAllowedItems.forEach(allowed => {
        const mountOrSight = allMods[allowed.id];
        if (!mountOrSight) return;

        if (isSightItem(mountOrSight)) {
          if (currentSight && mountOrSight.id === currentSight.id) return;
          if (!isValidSightForMode(mountOrSight, sightMode)) return;
          if (itemConflictsWithInstalled(mountOrSight, remainingIdsForAssembly)) return;

          alternatives.push({
            ...mountOrSight,
            replacementMode: 'SIGHT_ASSEMBLY'
          });
          return;
        }

        if (!isMountItem(mountOrSight)) return;
        if (itemConflictsWithInstalled(mountOrSight, remainingIdsForAssembly)) return;

        collectSightPackages(mountOrSight, remainingIdsForAssembly, currentSight).forEach(pkg => {
          alternatives.push({
            ...mountOrSight,
            attachedParts: pkg.attachedParts,
            attachedScope: pkg.sight,
            attachedScopeSlotName: pkg.attachedParts[pkg.attachedParts.length - 1]?.slotName,
            replacementMode: 'SIGHT_ASSEMBLY'
          });
        });
      });
    }
  }

  const uniqueAlternatives = new Map();
  const getDistanceNode = alt => (
    alt.replacementMode === 'SIGHT_ASSEMBLY'
      ? getReplaceTarget(targetNode, 'SIGHT_ASSEMBLY')
      : targetNode
  );
  alternatives.forEach(alt => {
    const isSightOrHasAttached = isSightItem(alt) || alt.attachedScope;
    if (isSightOrHasAttached) {
      const sightId = alt.attachedScope ? alt.attachedScope.id : alt.id;
      const existing = uniqueAlternatives.get(sightId);
      if (!existing) {
        uniqueAlternatives.set(sightId, alt);
      } else {
        const distAlt = calculateSimilarityDistance(getDistanceNode(alt), alt, priceMode);
        const distExisting = calculateSimilarityDistance(getDistanceNode(existing), existing, priceMode);
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
    const distA = calculateSimilarityDistance(getDistanceNode(a), a, priceMode);
    const distB = calculateSimilarityDistance(getDistanceNode(b), b, priceMode);
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
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return 'N/A';
  return `${Math.round(value).toLocaleString()} ${currency}`;
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

function getModuleCategoryLabel(item) {
  const categories = (item.categories || [])
    .map(category => category.name)
    .filter(Boolean);

  const preferred = categories.find(category => !['Item', 'Weapon mod', 'Gear mod', 'Functional mod', 'Essential mod', 'Compound item'].includes(category));
  return preferred || categories[0] || 'Module';
}

function getModuleSearchText(item) {
  return [
    item.name,
    item.shortName,
    item.id,
    ...(item.categories || []).map(category => category.name),
  ].filter(Boolean).join(' ').toLowerCase();
}

function getRequiredModuleSearchResults(allMods, query, selectedIds) {
  if (!allMods || query.trim().length < 2) return [];

  const normalizedQuery = query.trim().toLowerCase();
  return Object.values(allMods)
    .filter(item => !selectedIds.includes(item.id))
    .filter(item => getModuleSearchText(item).includes(normalizedQuery))
    .sort((a, b) => {
      const aName = (a.shortName || a.name || '').toLowerCase();
      const bName = (b.shortName || b.name || '').toLowerCase();
      const aStarts = aName.startsWith(normalizedQuery) ? 0 : 1;
      const bStarts = bName.startsWith(normalizedQuery) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return aName.localeCompare(bName);
    })
    .slice(0, 12);
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
  const [replaceMode, setReplaceMode] = useState('EXACT_ITEM');
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
  const [configTab, setConfigTab] = useState('basic');
  const [requiredModuleSearch, setRequiredModuleSearch] = useState('');
  const [requiredModuleIds, setRequiredModuleIds] = useState([]);
  
  useEffect(() => {
    savePriceModePreference(priceMode);
  }, [priceMode]);

  useEffect(() => {
    saveTargetTypePreference(targetType);
  }, [targetType]);
  
  useEffect(() => {
    let cancelled = false;

    Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true);
      return Promise.all([
        getWeaponDetails(weaponId, priceMode),
        getAllMods(priceMode)
      ]);
    }).then(result => {
      if (cancelled || !result) return;

      const [weaponData, modsData] = result;

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
      setRequiredModuleIds([]);
      setRequiredModuleSearch('');
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

  const handleReplacePart = (targetPart, alternativeItem, mode = 'EXACT_ITEM') => {
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

    const actualTargetNode = getReplaceTarget(targetNode, mode);
    if (!actualTargetNode) return;

    const subtreeIds = new Set();
    
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

    if (mode === 'SIGHT_ASSEMBLY') {
      function collectAll(n) {
        subtreeIds.add(n.item.id);
        n.children.forEach(collectAll);
      }
      collectAll(actualTargetNode);
    } else {
      checkCompatibilityAndCollect(actualTargetNode, alternativeItem);
      subtreeIds.add(actualTargetNode.item.id);
    }

    const updatedBuild = [];
    buildResult.build.forEach(part => {
      if (part.item.id === actualTargetNode.item.id) {
        updatedBuild.push({
          ...part,
          item: alternativeItem
        });
      } else if (!subtreeIds.has(part.item.id)) {
        updatedBuild.push(part);
      }
    });

    if (Array.isArray(alternativeItem.attachedParts) && alternativeItem.attachedParts.length > 0) {
      alternativeItem.attachedParts.forEach(attachedPart => {
        updatedBuild.push({
          slotName: attachedPart.slotName,
          item: attachedPart.item
        });
      });
    } else if (alternativeItem.attachedScope && alternativeItem.attachedScopeSlotName) {
      updatedBuild.push({
        slotName: alternativeItem.attachedScopeSlotName,
        item: alternativeItem.attachedScope
      });
    }

    const updatedResult = recalculateBuildStats(weapon, updatedBuild, { priceMode });
    
    setBuildResult(updatedResult);
    setActiveReplacePartId(null);
  };

  const handleOpenReplaceDrawer = (part) => {
    if (activeReplacePartId === part.item.id) {
      setActiveReplacePartId(null);
    } else {
      if (isSightItem(part.item)) {
        setReplaceMode('SIGHT_ITEM');
      } else if (isMountItem(part.item)) {
        setReplaceMode('SIGHT_MOUNT');
      } else {
        setReplaceMode('EXACT_ITEM');
      }
      setActiveReplacePartId(part.item.id);
    }
  };

  const handleAddRequiredModule = (item) => {
    setRequiredModuleIds(prev => {
      if (prev.includes(item.id)) return prev;
      return [...prev, item.id];
    });
    setRequiredModuleSearch('');
  };

  const handleRemoveRequiredModule = (itemId) => {
    setRequiredModuleIds(prev => prev.filter(id => id !== itemId));
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
        requiredItemIds: requiredModuleIds,
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
  }, [allMods, suppressorMode, maxWeight, maxPrice, magazineCapacity, priceMode, includeLaser, includeFlashlight, sightMode, requiredModuleIds, weapon, targetType, customErgo, customRecoil]);

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

  const selectedRequiredModules = requiredModuleIds
    .map(itemId => allMods?.[itemId])
    .filter(Boolean);
  const requiredModuleResults = getRequiredModuleSearchResults(allMods, requiredModuleSearch, requiredModuleIds);

  return (
    <div className="layout">
      {/* Левый сайдбар с конфигурацией сборки */}
      <aside className="config" aria-label="Build Configuration">
        <div className="config__head">
          <h2>Build Configuration</h2>
        </div>

        <section className="config__section config__section--tabs">
          <div className="segmented segmented--tabs">
            {[
              { value: 'basic', label: 'Basic' },
              { value: 'advanced', label: 'Advanced' }
            ].map(option => (
              <button
                key={option.value}
                className={`segmented__btn ${configTab === option.value ? 'is-active' : ''}`}
                type="button"
                onClick={() => setConfigTab(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        {configTab === 'basic' && (
          <>
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
          </>
        )}

        {configTab === 'advanced' && (
          <section className="config__section advanced-builder">
            <label className="field-label" htmlFor="requiredModuleSearch">Must Include Modules</label>
            <input
              id="requiredModuleSearch"
              type="search"
              placeholder="Search modules..."
              value={requiredModuleSearch}
              onChange={e => setRequiredModuleSearch(e.target.value)}
            />

            {requiredModuleResults.length > 0 && (
              <div className="module-search-list">
                {requiredModuleResults.map(item => {
                  const priceInfo = getSelectedPriceInfo(item, priceMode);

                  return (
                    <button
                      key={item.id}
                      className="module-search-item"
                      type="button"
                      onClick={() => handleAddRequiredModule(item)}
                    >
                      <span className="module-search-item__media">
                        <ImageWithLoader
                          src={item.image512pxLink || item.iconLink || 'https://via.placeholder.com/48'}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                          containerStyle={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}
                        />
                      </span>
                      <span className="module-search-item__body">
                        <strong>{formatPartName(item.shortName || item.name)}</strong>
                        <span>{getModuleCategoryLabel(item)} В· {formatCurrency(priceInfo.value, priceInfo.currency)}</span>
                      </span>
                      <span className="module-search-item__action">Add</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="required-modules">
              {selectedRequiredModules.length === 0 ? (
                <div className="required-modules__empty">No required modules selected.</div>
              ) : (
                selectedRequiredModules.map(item => (
                  <div key={item.id} className="required-module">
                    <div className="required-module__media">
                      <ImageWithLoader
                        src={item.image512pxLink || item.iconLink || 'https://via.placeholder.com/48'}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        containerStyle={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}
                      />
                    </div>
                    <div className="required-module__body">
                      <strong>{formatPartName(item.shortName || item.name)}</strong>
                      <span>{getModuleCategoryLabel(item)}</span>
                    </div>
                    <button
                      className="required-module__remove"
                      type="button"
                      onClick={() => handleRemoveRequiredModule(item.id)}
                      aria-label={`Remove ${item.shortName || item.name}`}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

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
                        <span style={{ '--value': `${Math.min(100, Math.max(0, recVal))}%` }} className="is-good"></span>
                      </div>
                      <strong>{currentRecoilV}</strong>
                    </div>
                    <div className="stat-row">
                      <span>Horizontal Recoil</span>
                      <div className="bar">
                        <span style={{ '--value': `${Math.min(100, Math.max(0, recHVal))}%` }} className="is-good"></span>
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
              {selectedRequiredModules.length > 0 && (
                <div className="chip">
                  Required
                  <strong>{selectedRequiredModules.length} modules</strong>
                </div>
              )}
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
                            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            containerStyle={{ width: '100%', height: '100%', minWidth: 0, minHeight: 0 }}
                          />
                        </div>
                        <div className="part-card__body">
                          <div className="part-card__topline">
                            <h4>{formatPartName(part.item.shortName)}</h4>
                            <strong>{formatCurrency(partPriceInfo.value, partPriceInfo.currency)}</strong>
                          </div>
                          <button 
                            className={`replace-btn ${activeReplacePartId === part.item.id ? 'active' : ''}`}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenReplaceDrawer(part);
                            }}
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

        const assemblyRoot = targetNode ? getReplaceTarget(targetNode, 'SIGHT_ASSEMBLY') : null;
        const hasSightChain = assemblyRoot ? subtreeHasSight(assemblyRoot) : false;

        let hasMountInChain = false;
        if (targetNode && hasSightChain) {
          let curr = targetNode;
          while (curr) {
            if (isMountItem(curr.item)) {
              hasMountInChain = true;
              break;
            }
            curr = curr.parent;
          }
          if (!hasMountInChain && assemblyRoot) {
            function walk(n) {
              if (isMountItem(n.item)) {
                hasMountInChain = true;
                return;
              }
              n.children.forEach(walk);
            }
            walk(assemblyRoot);
          }
        }

        const alternatives = targetNode 
          ? findCompatibleAlternatives(targetNode, allMods, buildResult, priceMode, sightMode, replaceMode)
          : [];

        return (
          <div className="drawer is-open" onClick={() => setActiveReplacePartId(null)}>
            <div className="drawer__panel" onClick={e => e.stopPropagation()}>
              <div className="drawer__head">
                <h2>Replace Part</h2>
                <button className="btn btn--ghost" type="button" onClick={() => setActiveReplacePartId(null)}>Close</button>
              </div>
              <div className="drawer__body" style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 100px)', paddingRight: '4px' }}>
                
                {hasSightChain && (
                  <div className="segmented" style={{ marginBottom: '1.25rem', display: 'flex', width: '100%' }}>
                    <button
                      className={`segmented__btn ${replaceMode === 'SIGHT_ITEM' ? 'is-active' : ''}`}
                      type="button"
                      onClick={() => setReplaceMode('SIGHT_ITEM')}
                      style={{ flex: 1 }}
                    >
                      Replace Optic
                    </button>
                    {hasMountInChain && (
                      <button
                        className={`segmented__btn ${replaceMode === 'SIGHT_MOUNT' ? 'is-active' : ''}`}
                        type="button"
                        onClick={() => setReplaceMode('SIGHT_MOUNT')}
                        style={{ flex: 1 }}
                      >
                        Replace Mount
                      </button>
                    )}
                    <button
                      className={`segmented__btn ${replaceMode === 'SIGHT_ASSEMBLY' ? 'is-active' : ''}`}
                      type="button"
                      onClick={() => setReplaceMode('SIGHT_ASSEMBLY')}
                      style={{ flex: 1 }}
                    >
                      Replace Assembly
                    </button>
                  </div>
                )}

                <div className="drawer__part">
                  <ImageWithLoader
                    src={activePart.item.image512pxLink || activePart.item.iconLink || 'https://via.placeholder.com/70'}
                    alt={activePart.item.shortName}
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    containerStyle={{ width: '70px', height: '70px', minWidth: 0, minHeight: 0, padding: '6px', background: '#101310', border: '1px solid rgba(204, 194, 158, 0.1)', borderRadius: '6px', boxSizing: 'border-box' }}
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
                        const altPackageItems = getAlternativePackageItems(alt);
                        const altPriceValue = altPackageItems
                          .reduce((sum, item) => sum + getSelectedPriceInfo(item, priceMode).value, 0);
                        
                        const effectiveReplaceMode = alt.replacementMode || replaceMode;
                        const actualReplaceTarget = getReplaceTarget(targetNode, effectiveReplaceMode);
                        const baselineParts = [];
                        if (actualReplaceTarget) {
                          baselineParts.push(actualReplaceTarget.item);
                          if (alt.attachedScope || (Array.isArray(alt.attachedParts) && alt.attachedParts.length > 0)) {
                            function collectChildren(n) {
                              n.children.forEach(c => {
                                baselineParts.push(c.item);
                                collectChildren(c);
                              });
                            }
                            collectChildren(actualReplaceTarget);
                          }
                        }

                        const baselinePrice = baselineParts.reduce((sum, item) => sum + getSelectedPriceInfo(item, priceMode).value, 0);
                        const baselineErgo = baselineParts.reduce((sum, item) => sum + (item.ergonomicsModifier || 0), 0);
                        const baselineRecoil = baselineParts.reduce((sum, item) => sum + (item.recoilModifier || 0), 0);
                        const baselineWeight = baselineParts.reduce((sum, item) => sum + (item.weight || 0), 0);

                        const altErgo = altPackageItems.reduce((sum, item) => sum + (item.ergonomicsModifier || 0), 0);
                        const altRecoil = altPackageItems.reduce((sum, item) => sum + (item.recoilModifier || 0), 0);
                        const altWeight = altPackageItems.reduce((sum, item) => sum + (item.weight || 0), 0);
                        const ergoDiff = altErgo - baselineErgo;
                        const recoilDiff = altRecoil - baselineRecoil;
                        const priceDiff = altPriceValue - baselinePrice;
                        const weightDiff = altWeight - baselineWeight;
                      
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
                            key={getAlternativeListKey(alt)}
                            onClick={(e) => {
                              e.stopPropagation();
                              const effectiveMode = alt.replacementMode || replaceMode;
                              const actualReplaceTarget = getReplaceTarget(targetNode, effectiveMode);
                              handleReplacePart(actualReplaceTarget.item, alt, effectiveMode);
                            }}
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
                                (getAlternativeSight(alt) && (getAlternativeSight(alt).image512pxLink || getAlternativeSight(alt).iconLink))
                                || alt.image512pxLink 
                                || alt.iconLink 
                                || 'https://via.placeholder.com/30'
                              }
                              alt=""
                              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                              containerStyle={{ width: '40px', height: '40px', minWidth: 0, minHeight: 0, padding: '4px', marginRight: '0.75rem', background: '#101310', border: '1px solid rgba(204, 194, 158, 0.1)', borderRadius: '6px', boxSizing: 'border-box' }}
                            />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '0.85rem', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>
                                {getAlternativeDisplayName(alt)}
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
