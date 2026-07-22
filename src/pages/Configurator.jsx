import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  PRICE_CONFIDENCE,
  PRICE_MODE_OPTIONS,
  PRICE_SOURCE_TYPE,
} from '../data/price/priceModes.js';
import {
  getPurchasePriceValue,
  selectPurchasePrice,
  sumPurchasePrices,
} from '../data/price/priceMapper.js';
import {
  loadIncludeTraderPricesPreference,
  loadPriceModePreference,
  saveIncludeTraderPricesPreference,
  savePriceModePreference,
  loadTargetTypePreference,
  normalizeTargetType,
  saveTargetTypePreference,
} from '../data/settings/buildPreferences.js';
import { getWeaponDetails, getAllMods, isAbortError } from '../data/tarkovApi';
import { useI18n } from '../i18n/useI18n.js';
import {
  createBuildSnapshot,
  getSavedBuild,
  restoreBuildParts,
  saveBuildSnapshot,
} from '../data/savedBuilds.js';
import { recalculateBuildStats } from '../domain/calculator.js';
import { categoryMatches, hasItemCategory } from '../domain/itemCategories.js';
import {
  buildWeaponAssemblyTree as buildAssemblyTree,
  rebindBuildPartsToCatalog,
} from '../domain/weaponAssembly.js';
import {
  DEFAULT_CUSTOM_EXACT_TARGETS,
  normalizeCustomExactTargets,
} from '../domain/customExactTargets.js';
import CustomBuildRadar from '../ui/CustomBuildRadar.jsx';
import WeaponBuildDiagramModal from '../ui/WeaponBuildDiagramModal.jsx';
import {
  CUSTOM_BUILD_DEFAULT_PROFILE,
  createCustomBuildProfileFromSettings,
  normalizeCustomBuildProfile,
} from '../ui/customBuildRadar.js';
import {
  WEAPON_STAT_UI_RANGES,
  normalizeStatPercent,
  toFiniteStatNumber,
  withBaseStatMaximum,
} from '../ui/weaponStatMeters.js';
import {
  getModuleDisplayRank,
  getModuleDisplayState,
  isCriticalSlot,
  sortModuleDisplayItems,
} from '../ui/criticalModules.js';
import { TarkovDevItemLink } from '../ui/TarkovDevItemLink.js';

function WarningIcon({ className = '' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      aria-hidden="true"
    >
      <path d="M10.3 3.7 2.4 17.4A1.8 1.8 0 0 0 4 20h16a1.8 1.8 0 0 0 1.6-2.6L13.7 3.7a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function CriticalModuleBadge({ t }) {
  return (
    <span className="critical-module-badge" title={t('config.critical')}>
      <WarningIcon className="critical-module-badge__icon" />
      {t('config.critical')}
    </span>
  );
}

function createCancelledCalculationError() {
  const error = new Error('A newer build calculation replaced this request.');
  error.name = 'AbortError';
  return error;
}

function ImageWithLoader({ src, alt, style, containerStyle }) {
  return (
    <ImageWithLoaderContent
      key={src || 'missing-image'}
      src={src}
      alt={alt}
      style={style}
      containerStyle={containerStyle}
    />
  );
}

function ImageWithLoaderContent({ src, alt, style, containerStyle }) {
  const { t } = useI18n();
  const [imageState, setImageState] = useState(src ? 'loading' : 'error');
  const isLoading = Boolean(src) && imageState === 'loading';
  const canDisplayImage = Boolean(src) && imageState !== 'error';

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', ...containerStyle }}>
      {isLoading && (
        <div className="shimmer" style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: 'inherit'
        }} />
      )}
      {canDisplayImage ? (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setImageState('loaded')}
          onError={() => setImageState('error')}
          style={{
            ...style,
            opacity: imageState === 'loaded' ? 1 : 0,
            transition: 'opacity 0.3s ease-in-out'
          }}
        />
      ) : (
        <span style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>{t('image.unavailable')}</span>
      )}
    </div>
  );
}

function getBuildModuleDisplayItems(weapon, buildParts) {
  const assemblyTree = buildAssemblyTree(weapon, buildParts);
  const nodeByBuildPart = new Map();
  const emptyCriticalItems = [];

  function visit(parentNode) {
    parentNode.children.forEach(childNode => {
      if (childNode.buildPart) nodeByBuildPart.set(childNode.buildPart, childNode);
      visit(childNode);
    });

    const slots = parentNode.item.properties?.slots || [];
    slots.forEach((slot, slotIndex) => {
      if (!isCriticalSlot(slot)) return;

      const hasInstalledItem = parentNode.children.some(child => child.sourceSlot === slot);
      if (hasInstalledItem) return;

      emptyCriticalItems.push({
        ...getModuleDisplayState(slot, null),
        key: `empty:${parentNode.item.id}:${slot.id || slot.name}:${slotIndex}`,
        item: null,
        parentItem: parentNode.item,
        slot,
        slotName: slot.name,
      });
    });
  }

  visit(assemblyTree);

  const installedItems = buildParts.map((part, originalIndex) => {
    const node = nodeByBuildPart.get(part);
    const slot = node?.sourceSlot || null;

    return {
      ...part,
      ...getModuleDisplayState(slot, part.item),
      key: `installed:${part.item.id}:${part.slotName}:${originalIndex}`,
      parentItem: node?.parent?.item || weapon,
      slot,
    };
  });

  return [...installedItems, ...emptyCriticalItems];
}

function findTreeNodeByItemId(root, itemId) {
  if (!root) return null;
  if (root.item.id === itemId) return root;

  for (const child of root.children) {
    const match = findTreeNodeByItemId(child, itemId);
    if (match) return match;
  }

  return null;
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

const MISSING_PRICE_COMPARISON_VALUE = 1_000_000_000_000;

function getItemsMetrics(items, priceMode, includeTraderPrices) {
  return items.reduce((metrics, item) => ({
    ergonomics: metrics.ergonomics + (item.ergonomicsModifier || 0),
    recoil: metrics.recoil + (item.recoilModifier || 0),
    weight: metrics.weight + (item.weight || 0),
    price: metrics.price + getPurchasePriceValue(item, {
      priceMode,
      includeTraderPrices,
    }, MISSING_PRICE_COMPARISON_VALUE),
  }), {
    ergonomics: 0,
    recoil: 0,
    weight: 0,
    price: 0,
  });
}

function getNodeMetrics(node, priceMode, includeTraderPrices) {
  const items = [];
  function collect(currentNode) {
    if (!currentNode?.item) return;
    items.push(currentNode.item);
    currentNode.children.forEach(collect);
  }
  collect(node);
  return getItemsMetrics(items, priceMode, includeTraderPrices);
}

function getSimilarityDistance(referenceMetrics, item, priceMode, includeTraderPrices) {
  const candidateMetrics = getItemsMetrics(
    getAlternativePackageItems(item),
    priceMode,
    includeTraderPrices,
  );

  return (Math.abs(referenceMetrics.ergonomics - candidateMetrics.ergonomics) * 1.5)
    + (Math.abs(referenceMetrics.recoil - candidateMetrics.recoil) * 4.0)
    + (Math.abs(referenceMetrics.weight - candidateMetrics.weight) * 2.0)
    + (Math.abs(referenceMetrics.price - candidateMetrics.price) * 0.0001);
}

function isValidSightForMode(item, sightMode) {
  if (hasItemCategory(item, 'Ironsight')) {
    return false;
  }
  if (hasItemCategory(item, 'Thermal Vision') || hasItemCategory(item, 'Night Vision') || hasItemCategory(item, 'Special scope')) {
    return false;
  }

  const mode = sightMode || 'any';
  if (mode === 'none') return false;
  if (mode === 'any') return true;

  const isReflex = hasItemCategory(item, 'Reflex sight') || hasItemCategory(item, 'Compact reflex sight');
  const isMagnified = hasItemCategory(item, 'Scope') || hasItemCategory(item, 'Assault scope');

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

function scoreScope(item, priceMode, includeTraderPrices) {
  const ergo = item.ergonomicsModifier || 0;
  const recoil = item.recoilModifier || 0;
  const weight = item.weight || 0;
  const price = getPurchasePriceValue(item, {
    priceMode,
    includeTraderPrices,
  }, MISSING_PRICE_COMPARISON_VALUE);

  return ergo - recoil * 5 - weight * 10 - (price > 0 ? price * 0.0001 : 0);
}

function isSightItem(item) {
  return hasItemCategory(item, 'Sights');
}

function isMountItem(item) {
  return hasItemCategory(item, 'Mount');
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

function findCompatibleAlternatives(
  node,
  allMods,
  priceMode,
  includeTraderPrices,
  sightMode,
  t,
  mode = 'EXACT_ITEM',
) {
  if (!node) return [];

  // Находим реальную цель для замены
  const targetNode = getReplaceTarget(node, mode);
  if (!targetNode || !targetNode.parent) return [];

  const parentItem = targetNode.parent.item;
  const parentSlot = targetNode.sourceSlot
    || parentItem.properties?.slots?.find(s => s.name === targetNode.slotName);
  if (!parentSlot) return [];

  const allowedItems = parentSlot.filters?.allowedItems || [];

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
  collectRemaining(rootNode);

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
    collectRemainingNode(rootNode);
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

  function isPackageCompatibleWithInstalled(packageItems, installedIds) {
    const packageIds = new Set();

    for (const packageItem of packageItems) {
      if (!packageItem || packageIds.has(packageItem.id)) return false;
      if (installedIds.has(packageItem.id)) return false;
      if (itemConflictsWithInstalled(packageItem, installedIds)) return false;

      for (const existingItem of packageItems) {
        if (existingItem === packageItem) break;
        if (itemsConflictWithEachOther(packageItem, existingItem)) return false;
      }

      packageIds.add(packageItem.id);
    }

    return true;
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

  allowedItems.forEach(allowedItem => {
    const altItem = allMods[allowedItem.id];
    if (!altItem) return;
    if (altItem.id === targetNode.item.id) return;

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
          if (!isPackageCompatibleWithInstalled([altItem, scopeItem], remainingInstalledIds)) continue;

          const score = scoreScope(scopeItem, priceMode, includeTraderPrices);
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
    if (!isPackageCompatibleWithInstalled(getAlternativePackageItems(altToPush), remainingInstalledIds)) return;
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

          const alternative = {
            ...mountOrSight,
            replacementMode: 'SIGHT_ASSEMBLY'
          };
          if (isPackageCompatibleWithInstalled(getAlternativePackageItems(alternative), remainingIdsForAssembly)) {
            alternatives.push(alternative);
          }
          return;
        }

        if (!isMountItem(mountOrSight)) return;
        if (itemConflictsWithInstalled(mountOrSight, remainingIdsForAssembly)) return;

        collectSightPackages(mountOrSight, remainingIdsForAssembly, currentSight).forEach(pkg => {
          const alternative = {
            ...mountOrSight,
            attachedParts: pkg.attachedParts,
            attachedScope: pkg.sight,
            attachedScopeSlotName: pkg.attachedParts[pkg.attachedParts.length - 1]?.slotName,
            replacementMode: 'SIGHT_ASSEMBLY'
          };
          if (isPackageCompatibleWithInstalled(getAlternativePackageItems(alternative), remainingIdsForAssembly)) {
            alternatives.push(alternative);
          }
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
  const referenceMetricsByNode = new Map();
  const distanceByAlternative = new Map();
  const getDistance = alt => {
    if (distanceByAlternative.has(alt)) return distanceByAlternative.get(alt);

    const distanceNode = getDistanceNode(alt);
    let referenceMetrics = referenceMetricsByNode.get(distanceNode);
    if (!referenceMetrics) {
      referenceMetrics = getNodeMetrics(distanceNode, priceMode, includeTraderPrices);
      referenceMetricsByNode.set(distanceNode, referenceMetrics);
    }

    const distance = getSimilarityDistance(
      referenceMetrics,
      alt,
      priceMode,
      includeTraderPrices,
    );
    distanceByAlternative.set(alt, distance);
    return distance;
  };
  alternatives.forEach(alt => {
    const isSightOrHasAttached = isSightItem(alt) || alt.attachedScope;
    if (isSightOrHasAttached) {
      const sightId = alt.attachedScope ? alt.attachedScope.id : alt.id;
      const existing = uniqueAlternatives.get(sightId);
      if (!existing) {
        uniqueAlternatives.set(sightId, alt);
      } else {
        const distAlt = getDistance(alt);
        const distExisting = getDistance(existing);
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
    const distA = getDistance(a);
    const distB = getDistance(b);
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

function formatCurrency(value, currency = 'RUB', unavailable = '—') {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return unavailable;
  return `${Math.round(value).toLocaleString()} ${currency}`;
}

function getItemDisplayName(item, fallbackLabel = 'Item') {
  return item?.shortName || item?.name || fallbackLabel;
}

function getSelectedPriceInfo(item, selectedPriceMode, includeTraderPrices) {
  const priceInfo = selectPurchasePrice(item, {
    priceMode: selectedPriceMode,
    includeTraderPrices,
  });

  return {
    ...priceInfo,
    isMissing: priceInfo.confidence === PRICE_CONFIDENCE.MISSING
      || !isPositivePrice(priceInfo.value),
    modeMismatch: Boolean(
      item?.purchaseOffers?.mode
      && selectedPriceMode
      && item.purchaseOffers.mode !== selectedPriceMode,
    ),
  };
}

function formatPriceSource(priceInfo, t) {
  if (priceInfo?.sourceLabel) return priceInfo.sourceLabel;
  if (priceInfo?.sourceType !== PRICE_SOURCE_TYPE.TRADER) return '';

  const level = isPositivePrice(priceInfo.traderLevel)
    ? t('config.price.traderLevel', { level: priceInfo.traderLevel })
    : t('config.price.traderLevelUnknown');
  return [
    priceInfo.vendorName || t('config.price.trader'),
    level,
    priceInfo.barterOnly ? t('config.price.barterOnly') : priceInfo.isBarter ? t('config.price.barter') : null,
    priceInfo.questRequired ? t('config.price.questRequired') : null,
  ].filter(Boolean).join(' · ');
}

function ItemPrice({ priceInfo, className = '' }) {
  const { t } = useI18n();
  const sourceLabel = formatPriceSource(priceInfo, t);

  return (
    <span className={`item-price ${className}`.trim()}>
      <strong>{formatCurrency(priceInfo?.value, priceInfo?.currency, t('config.notAvailable'))}</strong>
      {sourceLabel && <span className="item-price__source">{sourceLabel}</span>}
    </span>
  );
}

function PriceSource({ priceInfo }) {
  const { t } = useI18n();
  const sourceLabel = formatPriceSource(priceInfo, t);
  return sourceLabel
    ? <span className="item-price__source">{sourceLabel}</span>
    : null;
}

function getPackagePriceInfo(items, selectedPriceMode, includeTraderPrices, t) {
  const packagePrice = sumPurchasePrices(items, {
    priceMode: selectedPriceMode,
    includeTraderPrices,
  });
  const sourceLabels = Array.from(new Set(
    packagePrice.priceInfos.map(priceInfo => formatPriceSource(priceInfo, t)).filter(Boolean),
  ));

  return {
    ...packagePrice,
    sourceLabel: sourceLabels.join(' + '),
  };
}

function formatDiagnosticsList(entries, t, limit = 3) {
  const names = entries
    .slice(0, limit)
    .map(entry => entry.label);

  const remainingCount = entries.length - names.length;

  if (remainingCount > 0) {
    return t('config.andMore', { items: names.join(', '), count: remainingCount });
  }

  return names.join(', ');
}

function getPriceSummaryStatus(diagnostics, includeTraderPrices, t) {
  if (diagnostics.missingEntries.length > 0) return t('config.price.missingStatus');
  if (diagnostics.fallbackEntries.length > 0) return t('config.price.fallbackStatus');
  return includeTraderPrices ? t('config.price.fleaTrader') : t('config.price.fleaOnly');
}

function collectBuildPriceDiagnostics(weapon, buildResult, selectedPriceMode, includeTraderPrices, t) {
  const entries = [
    {
      label: t('config.weapon'),
      item: weapon,
    },
    ...buildResult.build.map(part => ({
      label: getItemDisplayName(part.item, part.slotName),
      item: part.item,
    })),
  ].map(entry => ({
    ...entry,
    priceInfo: getSelectedPriceInfo(entry.item, selectedPriceMode, includeTraderPrices),
  }));

  const fallbackEntries = entries.filter(entry => (
    entry.priceInfo.fallbackUsed
    && !entry.priceInfo.isMissing
  ));
  const missingEntries = entries.filter(entry => entry.priceInfo.isMissing);
  const modeMismatchEntries = entries.filter(entry => entry.priceInfo.modeMismatch);
  const barterOnlyEntries = entries.filter(entry => entry.priceInfo.barterOnly);
  const sourceLabels = Array.from(new Set(
    entries
      .filter(entry => !entry.priceInfo.isMissing)
      .map(entry => entry.priceInfo.source)
      .filter(Boolean),
  ));

  const warningMessages = [];

  if (missingEntries.length > 0) {
    warningMessages.push(
      t('config.price.missing', { items: formatDiagnosticsList(missingEntries, t) }),
    );
  }

  if (fallbackEntries.length > 0) {
    warningMessages.push(
      t('config.price.fallback', { items: formatDiagnosticsList(fallbackEntries, t) }),
    );
  }

  if (modeMismatchEntries.length > 0) {
    warningMessages.push(
      t('config.price.modeFallback', { items: formatDiagnosticsList(modeMismatchEntries, t) }),
    );
  }

  if (barterOnlyEntries.length > 0) {
    warningMessages.push(
      t('config.price.barterOnlyWarning', { items: formatDiagnosticsList(barterOnlyEntries, t) }),
    );
  }

  if (sourceLabels.length > 1) {
    warningMessages.push(t('config.price.mixedSources', { sources: sourceLabels.join(', ') }));
  }

  const modeLabel = t(`config.price.${selectedPriceMode}Short`);
  const sourceLabel = sourceLabels.length > 0 ? sourceLabels.join(' + ') : t('config.price.noSource');
  const summaryStatus = getPriceSummaryStatus({
    fallbackEntries,
    missingEntries,
  }, includeTraderPrices, t);

  return {
    entries,
    fallbackEntries,
    missingEntries,
    modeMismatchEntries,
    barterOnlyEntries,
    sourceLabels,
    warningMessages,
    summaryStatus,
    summaryLabel: `${modeLabel} · ${sourceLabel} · ${summaryStatus}`,
  };
}

const SUPPRESSOR_MODE_OPTIONS = [
  { value: 'allow', label: 'config.suppressorAllow' },
  { value: 'forbid', label: 'config.suppressorForbid' },
  { value: 'require', label: 'config.suppressorRequire' },
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

function isSuppressorItem(item) {
  return hasItemCategory(item, 'Silencer');
}

function getReplacementConstraintErrors({
  weapon,
  buildParts,
  priceMode,
  includeTraderPrices,
  maxWeight,
  maxPrice,
  requiredItemIds,
  suppressorMode,
  sightMode,
  t,
}) {
  const errors = [];
  const items = [weapon, ...buildParts.map(part => part.item)];
  const itemsById = new Map();

  for (const item of items) {
    if (!item?.id) {
      errors.push(t('config.invalidReplacementItem'));
      continue;
    }

    if (itemsById.has(item.id)) {
      errors.push(t('config.duplicateReplacement', { item: getItemDisplayName(item, t('config.item')) }));
      continue;
    }

    itemsById.set(item.id, item);
  }

  for (const item of itemsById.values()) {
    const conflictingItem = (item.conflictingItems || [])
      .map(conflict => itemsById.get(conflict.id))
      .find(Boolean);

    if (conflictingItem) {
      errors.push(t('config.itemConflict', { item: getItemDisplayName(item, t('config.item')), conflict: getItemDisplayName(conflictingItem, t('config.item')) }));
      break;
    }
  }

  const requiredIds = new Set((requiredItemIds || []).map(String));
  const missingRequiredIds = [...requiredIds].filter(itemId => !itemsById.has(itemId));
  if (missingRequiredIds.length > 0) {
    errors.push(t('config.requiredRemoved'));
  }

  const suppressorCount = [...itemsById.values()].filter(isSuppressorItem).length;
  if (suppressorMode === 'require' && suppressorCount === 0) {
    errors.push(t('config.requiredSuppressorRemoved'));
  }
  if (suppressorMode === 'forbid' && suppressorCount > 0) {
    errors.push(t('config.forbiddenSuppressor'));
  }

  const installedSights = [...itemsById.values()].filter(isSightItem);
  if (sightMode === 'none' && installedSights.length > 0) {
    errors.push(t('config.sightWhenNone'));
  } else if (sightMode !== 'none' && !installedSights.some(item => isValidSightForMode(item, sightMode))) {
    errors.push(t('config.sightRequirement'));
  }

  const stats = recalculateBuildStats(weapon, buildParts, {
    priceMode,
    includeTraderPrices,
  });
  const parsedMaxWeight = Number(maxWeight) || 0;
  const parsedMaxPrice = Number(maxPrice) || 0;

  if (parsedMaxWeight > 0 && Number(stats.weight) > parsedMaxWeight + 0.0001) {
    errors.push(t('config.weightLimit', { weight: parsedMaxWeight }));
  }
  if (parsedMaxPrice > 0 && !isPositivePrice(stats.price)) {
    errors.push(t('config.priceUnavailable'));
  } else if (parsedMaxPrice > 0 && stats.price > parsedMaxPrice) {
    errors.push(t('config.budgetLimit', { price: parsedMaxPrice }));
  }

  return { errors, stats };
}

function getUnattachedBuildPartError(weapon, buildParts, t) {
  const tree = buildAssemblyTree(weapon, buildParts);
  let attachedPartCount = 0;

  function countAttachedParts(node) {
    node.children.forEach(child => {
      attachedPartCount += 1;
      countAttachedParts(child);
    });
  }

  countAttachedParts(tree);
  return attachedPartCount === buildParts.length
    ? null
    : t('config.unattached');
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
    if (hasItemCategory(mod, 'Ironsight')) return;

    if (hasItemCategory(mod, 'Sights')) {
      const zoomLevels = mod.properties?.zoomLevels;
      if (zoomLevels) {
        const flat = zoomLevels.flat();
        flat.forEach(z => {
          if (typeof z === 'number' && z > 0) {
            zooms.add(z);
          }
        });
      } else {
        const isReflex = hasItemCategory(mod, 'Reflex sight') || hasItemCategory(mod, 'Compact reflex sight');
        if (isReflex) {
          zooms.add(1);
        }
      }
    }
  });

  return Array.from(zooms).sort((a, b) => a - b);
}

function getModuleCategoryLabel(item, t) {
  const categories = (item.categories || []).filter(category => category?.name);
  const genericCategories = ['Item', 'Weapon mod', 'Gear mod', 'Functional mod', 'Essential mod', 'Compound item'];
  const preferred = categories.find(category => !genericCategories.some(name => categoryMatches(category, name)));
  return preferred?.name || categories[0]?.name || t('config.module');
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
  const selectedIdSet = new Set(selectedIds);
  return Object.values(allMods)
    .filter(item => !selectedIdSet.has(item.id))
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
  'reciever': 'config.slotGroup.receiver',
  'receiver': 'config.slotGroup.receiver',
  'pistolgrip': 'config.slotGroup.pistolGrip',
  'pistol grip': 'config.slotGroup.pistolGrip',
  'grip': 'config.slotGroup.pistolGrip',
  'gasblock': 'config.slotGroup.gasBlock',
  'front sight': 'config.slotGroup.frontSight',
  'rear sight': 'config.slotGroup.rearSight',
  'ubgl': 'config.slotGroup.underbarrelLauncher',
  'tactical': 'config.slotGroup.tacticalDevice',
  'foregrip': 'config.slotGroup.foregrip',
  'bipod': 'config.slotGroup.bipod',
  'launcher': 'config.slotGroup.launcher',
  'scope': 'config.slotGroup.scope',
  'mount': 'config.slotGroup.mount',
  'charge': 'config.slotGroup.chargingHandle',
  'charging handle': 'config.slotGroup.chargingHandle',
  'dustcover': 'config.slotGroup.dustCover',
  'dust cover': 'config.slotGroup.dustCover',
  'barrel': 'config.slotGroup.barrel',
  'handguard': 'config.slotGroup.handguard',
  'muzzle': 'config.slotGroup.muzzle',
  'stock': 'config.slotGroup.stock',
  'magazine': 'config.slotGroup.magazine'
};

function getReadableSlotGroupName(slotName, t) {
  if (!slotName) return t('config.other');
  let name = slotName.trim().toLowerCase();
  
  if (name.startsWith('mod_')) {
    name = name.substring(4);
  }
  
  name = name.replace(/[\s_-]+/g, ' ');
  
  if (SLOT_GROUP_NAME_MAPPINGS[name]) {
    return t(SLOT_GROUP_NAME_MAPPINGS[name]);
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

function StatMeterRow({ label, value, displayValue = value, range, t }) {
  const hasNumericValue = typeof value === 'number' && Number.isFinite(value);
  const percent = normalizeStatPercent(value, range.min, range.max);
  const accessibleValue = hasNumericValue
    ? Math.min(range.max, Math.max(range.min, value))
    : undefined;

  return (
    <div className={`stat-row stat-row--${range.direction}`}>
      <span>{label}</span>
      <div
        className="bar"
        role="meter"
        aria-label={label}
        aria-valuemin={range.min}
        aria-valuemax={range.max}
        aria-valuenow={accessibleValue}
        aria-valuetext={hasNumericValue ? undefined : t('config.notAvailable')}
      >
        <span
          className="bar__gradient"
          style={{ '--meter-value': `${percent}%` }}
          aria-hidden="true"
        />
      </div>
      <strong>{displayValue}</strong>
    </div>
  );
}

function getBuildResultErrorMessage(buildResult, language, t) {
  if (buildResult.errorCode === 'CUSTOM_EXACT_TARGETS_UNMET') {
    return t('config.exactTargetsUnmet');
  }

  return language === 'ru' ? t('config.constraintMessage') : buildResult.error;
}

function getBuildResultWarningMessage(buildResult, language, t) {
  return language === 'ru' ? t('config.buildWarningMessage') : buildResult.warning;
}

function Configurator() {
  const { language, t } = useI18n();
  const { weaponId } = useParams();
  const [searchParams] = useSearchParams();
  const requestedSavedBuildId = searchParams.get('build');
  const requestedSavedBuild = useMemo(
    () => getSavedBuild(requestedSavedBuildId),
    [requestedSavedBuildId],
  );
  const [weapon, setWeapon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [targetType, setTargetType] = useState(loadTargetTypePreference);
  const [customProfile, setCustomProfile] = useState(CUSTOM_BUILD_DEFAULT_PROFILE);
  const [customExactTargets, setCustomExactTargets] = useState(DEFAULT_CUSTOM_EXACT_TARGETS);
  const [suppressorMode, setSuppressorMode] = useState('allow');
  const [priceMode, setPriceMode] = useState(
    () => requestedSavedBuild?.settings.priceMode || loadPriceModePreference(),
  );
  const [includeTraderPrices, setIncludeTraderPrices] = useState(
    () => requestedSavedBuild?.settings.includeTraderPrices
      ?? loadIncludeTraderPricesPreference(),
  );
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
  const [isBuildDiagramOpen, setIsBuildDiagramOpen] = useState(false);
  const [sightMode, setSightMode] = useState('none');
  const [isSightSelectOpen, setIsSightSelectOpen] = useState(false);
  const [partsFilter, setPartsFilter] = useState('');
  const [configTab, setConfigTab] = useState('basic');
  const [requiredModuleSearch, setRequiredModuleSearch] = useState('');
  const [requiredModuleIds, setRequiredModuleIds] = useState([]);
  const [replacementError, setReplacementError] = useState(null);
  const [pricePolicyWarning, setPricePolicyWarning] = useState(null);
  const [activeSavedBuildId, setActiveSavedBuildId] = useState(requestedSavedBuildId);
  const [saveName, setSaveName] = useState(requestedSavedBuild?.name || '');
  const [saveFeedback, setSaveFeedback] = useState(null);
  const maxWeight = customProfile.weight > 0 ? String(customProfile.weight) : '';
  const maxPrice = customProfile.price > 0 ? String(customProfile.price) : '';
  const calculatorWorkerRef = useRef(null);
  const calculatorDataRef = useRef({ modMap: null, version: 0 });
  const nextCalculationRequestIdRef = useRef(0);
  const latestCalculationRequestIdRef = useRef(0);
  const pendingCalculationsRef = useRef(new Map());
  const lastLoadedRequestRef = useRef(null);
  const lastLoadedWeaponRef = useRef(null);

  const cancelPendingCalculations = useCallback((exceptRequestId = null) => {
    const worker = calculatorWorkerRef.current;

    pendingCalculationsRef.current.forEach((pendingCalculation, requestId) => {
      if (requestId === exceptRequestId) return;
      worker?.postMessage({ type: 'cancel', requestId });
      pendingCalculation.reject(createCancelledCalculationError());
      pendingCalculationsRef.current.delete(requestId);
    });
  }, []);

  useEffect(() => {
    const pendingCalculations = pendingCalculationsRef.current;
    const worker = new Worker(
      new URL('../workers/buildCalculator.worker.js', import.meta.url),
      { type: 'module' },
    );

    calculatorWorkerRef.current = worker;
    calculatorDataRef.current = {
      modMap: null,
      version: calculatorDataRef.current.version + 1,
    };

    worker.onmessage = ({ data }) => {
      const pendingCalculation = pendingCalculations.get(data.requestId);
      if (!pendingCalculation) return;

      pendingCalculations.delete(data.requestId);
      if (data.type === 'result') {
        pendingCalculation.resolve(data.result);
        return;
      }

      const error = new Error(data.error?.message ?? 'Build calculation failed in the worker.');
      error.name = data.error?.name ?? 'CalculatorWorkerError';
      pendingCalculation.reject(error);
    };

    worker.onerror = event => {
      const error = new Error(event.message || 'Build calculation worker failed to start.');
      pendingCalculations.forEach(pendingCalculation => pendingCalculation.reject(error));
      pendingCalculations.clear();
    };

    return () => {
      worker.terminate();
      if (calculatorWorkerRef.current === worker) {
        calculatorWorkerRef.current = null;
      }
      pendingCalculations.forEach(pendingCalculation => (
        pendingCalculation.reject(createCancelledCalculationError())
      ));
      pendingCalculations.clear();
    };
  }, []);

  const runBuildCalculation = useCallback((calculationInput) => {
    const worker = calculatorWorkerRef.current;
    if (!worker) {
      const error = new Error('Build calculation worker is not ready yet. Please try again.');
      error.name = 'CalculatorWorkerUnavailableError';
      return {
        requestId: latestCalculationRequestIdRef.current,
        promise: Promise.reject(error),
      };
    }

    const requestId = nextCalculationRequestIdRef.current + 1;
    nextCalculationRequestIdRef.current = requestId;
    latestCalculationRequestIdRef.current = requestId;
    cancelPendingCalculations(requestId);

    if (calculatorDataRef.current.modMap !== calculationInput.allMods) {
      calculatorDataRef.current = {
        modMap: calculationInput.allMods,
        version: calculatorDataRef.current.version + 1,
      };
      worker.postMessage({
        type: 'initialize',
        modMap: calculationInput.allMods,
        modMapVersion: calculatorDataRef.current.version,
      });
    }

    const promise = new Promise((resolve, reject) => {
      pendingCalculationsRef.current.set(requestId, { resolve, reject });
    });

    worker.postMessage({
      type: 'calculate',
      requestId,
      modMapVersion: calculatorDataRef.current.version,
      weapon: calculationInput.weapon,
      targetType: calculationInput.targetType,
      customProfile: calculationInput.customProfile,
      customExactTargets: calculationInput.customExactTargets,
      options: calculationInput.options,
    });

    return { requestId, promise };
  }, [cancelPendingCalculations]);
  
  useEffect(() => {
    savePriceModePreference(priceMode);
  }, [priceMode]);

  useEffect(() => {
    saveIncludeTraderPricesPreference(includeTraderPrices);
  }, [includeTraderPrices]);

  useEffect(() => {
    saveTargetTypePreference(targetType);
  }, [targetType]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const previousRequest = lastLoadedRequestRef.current;
    const isCatalogReload = previousRequest
      && previousRequest.weaponId === weaponId
      && previousRequest.savedBuildId === requestedSavedBuildId
      && previousRequest.priceMode === priceMode;

    Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true);
      return Promise.all([
        getWeaponDetails(weaponId, priceMode, { signal: controller.signal, language }),
        getAllMods(priceMode, { signal: controller.signal, language }),
      ]);
    }).then(result => {
      if (cancelled || !result) return;

      const [weaponData, modsData] = result;

      setWeapon(weaponData);
      setAllMods(modsData);

      if (isCatalogReload) {
        setBuildResult(current => {
          if (!current?.build) return current;

          const localizedBuild = rebindBuildPartsToCatalog(
            lastLoadedWeaponRef.current,
            current.build,
            weaponData,
            modsData,
          );

          return {
            ...current,
            build: localizedBuild,
          };
        });
        setLoadError(null);
        setLoading(false);
        lastLoadedRequestRef.current = {
          weaponId,
          savedBuildId: requestedSavedBuildId,
          priceMode,
          language,
        };
        lastLoadedWeaponRef.current = weaponData;
        return;
      }
      
      const capacities = getAvailableCapacities(weaponData, modsData);
      if (capacities.length > 0) {
        if (capacities.includes(30)) {
          setMagazineCapacity(30);
        } else {
          setMagazineCapacity(capacities[0]);
        }
      }

      if (requestedSavedBuild && requestedSavedBuild.weapon.id === weaponData.id) {
        const restored = restoreBuildParts(requestedSavedBuild, modsData);
        const settings = requestedSavedBuild.settings;
        const restoredIncludeTraderPrices = settings.includeTraderPrices !== false;
        const restoredResult = recalculateBuildStats(weaponData, restored.build, {
          priceMode,
          includeTraderPrices: restoredIncludeTraderPrices,
        });

        setBuildResult({
          build: restored.build,
          stats: restoredResult.stats,
          warning: restored.missingItemIds.length > 0
            ? t('config.savedModulesSkipped', { count: restored.missingItemIds.length })
            : undefined,
        });
        setTargetType(normalizeTargetType(settings.targetType));
        setCustomProfile(createCustomBuildProfileFromSettings(settings, weaponData));
        setCustomExactTargets(normalizeCustomExactTargets(settings.customExactTargets));
        setSuppressorMode(settings.suppressorMode || 'allow');
        setIncludeTraderPrices(restoredIncludeTraderPrices);
        setMagazineCapacity(Number(settings.magazineCapacity) || capacities[0] || 30);
        setIncludeLaser(settings.includeLaser === true);
        setIncludeFlashlight(settings.includeFlashlight === true);
        setSightMode(settings.sightMode || 'none');
        setRequiredModuleIds(
          (settings.requiredModuleIds || []).filter(itemId => Boolean(modsData[itemId])),
        );
        setActiveSavedBuildId(requestedSavedBuild.id);
        setSaveName(requestedSavedBuild.name);
      } else {
        setBuildResult(null);
        setCustomExactTargets(DEFAULT_CUSTOM_EXACT_TARGETS);
        setRequiredModuleIds([]);
        setActiveSavedBuildId(null);
        setSaveName(t('config.defaultBuildName', { weapon: weaponData.shortName || weaponData.name }));
      }
      setRequiredModuleSearch('');
      setLoadError(null);
      setGenerationError(
        requestedSavedBuildId && !requestedSavedBuild
          ? t('config.savedBuildMissing')
          : null,
      );
      setReplacementError(null);
      setSaveFeedback(null);
      setLoading(false);
      lastLoadedRequestRef.current = {
        weaponId,
        savedBuildId: requestedSavedBuildId,
        priceMode,
        language,
      };
      lastLoadedWeaponRef.current = weaponData;
    }).catch(err => {
      if (cancelled || controller.signal.aborted || isAbortError(err)) return;

      console.error(err);
      setWeapon(null);
      setAllMods(null);
      setLoadError(t('config.error'));
      setBuildResult(null);
      setGenerationError(null);
      setReplacementError(null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [weaponId, priceMode, requestedSavedBuild, requestedSavedBuildId, language, t]);

  const handleReplacePart = (targetNode, alternativeItem, mode = 'EXACT_ITEM') => {
    if (!buildResult || !targetNode) return;

    const actualTargetNode = getReplaceTarget(targetNode, mode);
    if (!actualTargetNode) return;

    const subtreeIds = new Set();
    
    function checkCompatibilityAndCollect(nodeToCheck, parentItem) {
      nodeToCheck.children.forEach(child => {
        const slots = parentItem.properties?.slots || [];
        const matchingSlot = child.sourceSlot || slots.find(s => s.name === child.slotName);
        
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

    const attachmentError = getUnattachedBuildPartError(weapon, updatedBuild, t);
    const { errors, stats } = getReplacementConstraintErrors({
      weapon,
      buildParts: updatedBuild,
      priceMode,
      includeTraderPrices,
      maxWeight,
      maxPrice,
      requiredItemIds: requiredModuleIds,
      suppressorMode,
      sightMode,
      t,
    });

    if (attachmentError) errors.unshift(attachmentError);
    if (errors.length > 0) {
      setReplacementError(errors.join(' '));
      return;
    }

    setReplacementError(null);
    setBuildResult(stats);
    setActiveReplacePartId(null);
  };

  const handleOpenReplaceDrawer = (part) => {
    setReplacementError(null);
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

  const handleCloseBuildDiagram = useCallback(() => {
    setIsBuildDiagramOpen(false);
  }, []);

  const handleDiagramBuildChange = useCallback((nextBuildParts) => {
    if (!weapon || !buildResult) return [t('config.currentBuildUnavailable')];

    const attachmentError = getUnattachedBuildPartError(weapon, nextBuildParts, t);
    const { errors, stats: recalculatedResult } = getReplacementConstraintErrors({
      weapon,
      buildParts: nextBuildParts,
      priceMode,
      includeTraderPrices,
      maxWeight,
      maxPrice,
      requiredItemIds: requiredModuleIds,
      suppressorMode,
      sightMode,
      t,
    });
    if (attachmentError) errors.unshift(attachmentError);
    if (errors.length > 0) return errors;

    setReplacementError(null);
    setBuildResult(current => current ? {
      ...current,
      ...recalculatedResult,
      error: null,
    } : current);
    return [];
  }, [
    buildResult,
    includeTraderPrices,
    maxPrice,
    maxWeight,
    priceMode,
    requiredModuleIds,
    sightMode,
    suppressorMode,
    weapon,
    t,
  ]);

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

  const handleIncludeTraderPricesChange = (nextValue) => {
    setIncludeTraderPrices(nextValue);

    if (!weapon || !buildResult || !Array.isArray(buildResult.build)) return;

    const recalculated = recalculateBuildStats(weapon, buildResult.build, {
      priceMode,
      includeTraderPrices: nextValue,
    });
    const budgetLimit = Number(maxPrice) || 0;

    setBuildResult(current => current ? {
      ...current,
      stats: recalculated.stats,
    } : current);
    setPricePolicyWarning(
      budgetLimit > 0 && !isPositivePrice(recalculated.stats.price)
        ? t('config.currentPriceUnavailable')
        : budgetLimit > 0 && recalculated.stats.price > budgetLimit
          ? t('config.currentBudgetExceeded', { price: budgetLimit })
          : null,
    );
  };

  const handleGenerate = useCallback(async () => {
    if (!allMods) return;
    setGenerating(true);
    setGenerationError(null);
    setReplacementError(null);
    setPricePolicyWarning(null);
    setBuildResult(null);
    let requestId = null;

    try {
      const options = {
        ...getSuppressorOptions(suppressorMode),
        maxWeight: customProfile.weight,
        maxPrice: customProfile.price,
        magazineCapacity: Number(magazineCapacity) || 30,
        priceMode,
        includeTraderPrices,
        includeLaser,
        includeFlashlight,
        sightMode,
        requireSight: sightMode !== 'none',
        requiredItemIds: requiredModuleIds,
      };

      const calculation = runBuildCalculation({
        weapon,
        targetType,
        customProfile,
        customExactTargets,
        allMods,
        options,
      });
      requestId = calculation.requestId;
      const result = await calculation.promise;
      if (requestId !== latestCalculationRequestIdRef.current) return;
      setBuildResult(result);
    } catch (err) {
      if (err?.name === 'AbortError') return;
      if (requestId !== null && requestId !== latestCalculationRequestIdRef.current) return;
      console.error(err);
      setGenerationError(t('config.generateFailed'));
    } finally {
      if (requestId === latestCalculationRequestIdRef.current) {
        setGenerating(false);
      }
    }
  }, [allMods, suppressorMode, magazineCapacity, priceMode, includeTraderPrices, includeLaser, includeFlashlight, sightMode, requiredModuleIds, weapon, targetType, customProfile, customExactTargets, runBuildCalculation, t]);

  const handleSaveBuild = () => {
    if (!weapon || !buildResult || buildResult.error || !Array.isArray(buildResult.build) || buildResult.build.length === 0) {
      setSaveFeedback({ type: 'error', message: t('config.saveValidFirst') });
      return;
    }

    try {
      const savedBuild = saveBuildSnapshot(createBuildSnapshot({
        id: activeSavedBuildId,
        name: saveName.trim() || t('config.saveNameDefault', { weapon: weapon.shortName || weapon.name }),
        weapon,
        buildResult,
        settings: {
          targetType,
          customProfile,
          customExactTargets,
          customErgonomics: customProfile.ergonomics,
          customVerticalRecoil: customProfile.verticalRecoil,
          customHorizontalRecoil: customProfile.horizontalRecoil,
          customMaxWeight: customProfile.weight,
          customMaxPrice: customProfile.price,
          customErgo: customProfile.ergonomics,
          customRecoil: customProfile.verticalRecoil,
          suppressorMode,
          priceMode,
          includeTraderPrices,
          maxWeight: customProfile.weight,
          maxPrice: customProfile.price,
          magazineCapacity,
          includeLaser,
          includeFlashlight,
          sightMode,
          requiredModuleIds,
        },
      }));

      setActiveSavedBuildId(savedBuild.id);
      setSaveName(savedBuild.name);
      setSaveFeedback({ type: 'success', message: activeSavedBuildId ? t('config.saveUpdated') : t('config.saveLocal') });
  } catch {
      setSaveFeedback({
        type: 'error',
        message: t('config.saveFailed'),
      });
    }
  };

  const hasCalculationError = buildResult ? Boolean(buildResult.error) : false;
  const hasBuildParts = buildResult ? (Array.isArray(buildResult.build) && buildResult.build.length > 0) : false;
  const canShowBuildDetails = Boolean(buildResult && !hasCalculationError && hasBuildParts);
  const availableCapacities = useMemo(
    () => getAvailableCapacities(weapon, allMods),
    [weapon, allMods],
  );
  const availableZoomLevels = useMemo(
    () => getAvailableZoomLevels(allMods),
    [allMods],
  );
  const selectedRequiredModules = useMemo(
    () => requiredModuleIds.map(itemId => allMods?.[itemId]).filter(Boolean),
    [allMods, requiredModuleIds],
  );
  const requiredModuleResults = useMemo(
    () => getRequiredModuleSearchResults(allMods, requiredModuleSearch, requiredModuleIds),
    [allMods, requiredModuleSearch, requiredModuleIds],
  );
  const replacementContext = useMemo(() => {
    if (!weapon || !buildResult || !hasBuildParts || !activeReplacePartId) return null;

    const assemblyTree = buildAssemblyTree(weapon, buildResult.build);
    const activePart = buildResult.build.find(part => part.item.id === activeReplacePartId);
    const targetNode = activePart
      ? findTreeNodeByItemId(assemblyTree, activePart.item.id)
      : null;

    if (!activePart || !targetNode) return null;

    const assemblyRoot = getReplaceTarget(targetNode, 'SIGHT_ASSEMBLY');
    const hasSightChain = Boolean(assemblyRoot && subtreeHasSight(assemblyRoot));
    let hasMountInChain = false;

    if (hasSightChain) {
      let currentNode = targetNode;
      while (currentNode) {
        if (isMountItem(currentNode.item)) {
          hasMountInChain = true;
          break;
        }
        currentNode = currentNode.parent;
      }

      if (!hasMountInChain && assemblyRoot) {
        const stack = [assemblyRoot];
        while (stack.length > 0) {
          const currentNode = stack.pop();
          if (isMountItem(currentNode.item)) {
            hasMountInChain = true;
            break;
          }
          stack.push(...currentNode.children);
        }
      }
    }

    return {
      activePart,
      targetNode,
      hasSightChain,
      hasMountInChain,
      alternatives: findCompatibleAlternatives(
        targetNode,
        allMods,
        priceMode,
        includeTraderPrices,
        sightMode,
        t,
        replaceMode,
      ),
    };
  }, [weapon, buildResult, hasBuildParts, activeReplacePartId, allMods, priceMode, includeTraderPrices, sightMode, t, replaceMode]);

  const isLoading = loading || (weapon && weapon.id !== weaponId);

  if (isLoading) {
    return (
      <div id="loader-wrapper">
        <div className="loader">
          <div className="loader-ring"></div>
          <div className="loader-ring"></div>
          <div className="loader-ring"></div>
          <p className="loader-text">{t('config.loader')}</p>
        </div>
      </div>
    );
  }

  if (!weapon) {
    return (
      <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center' }}>
        {loadError ? (
          <InlineMessage type="error" title={t('config.loadingFailed')}>
            {loadError}
          </InlineMessage>
        ) : (
          t('config.notFound')
        )}
      </div>
    );
  }

  const priceDiagnostics = canShowBuildDetails
    ? collectBuildPriceDiagnostics(weapon, buildResult, priceMode, includeTraderPrices, t)
    : {
      summaryLabel: `${t(`config.price.${priceMode}Short`)} · tarkov.dev · ${includeTraderPrices ? t('config.price.fleaTrader') : t('config.price.fleaOnly')}`,
      summaryStatus: includeTraderPrices ? t('config.price.fleaTrader') : t('config.price.fleaOnly'),
      warningMessages: [],
    };

  // Рассчитываем текущие значения для панели метрик
  const currentErgo = canShowBuildDetails ? buildResult.stats.ergonomics : (weapon.properties?.ergonomics ?? t('config.notAvailable'));
  const currentWeightValue = toFiniteStatNumber(
    canShowBuildDetails ? buildResult.stats.weight : weapon.weight,
  );
  const currentWeight = canShowBuildDetails ? `${buildResult.stats.weight} kg` : (weapon.weight ? `${weapon.weight} kg` : t('config.notAvailable'));
  const currentRecoilV = canShowBuildDetails ? buildResult.stats.recoilVertical : (weapon.properties?.recoilVertical ?? t('config.notAvailable'));
  const currentRecoilH = canShowBuildDetails ? buildResult.stats.recoilHorizontal : (weapon.properties?.recoilHorizontal ?? t('config.notAvailable'));
  const currentPrice = canShowBuildDetails 
    ? formatCurrency(buildResult.stats.price, 'RUB', t('config.notAvailable'))
    : formatCurrency(
      getSelectedPriceInfo(weapon, priceMode, includeTraderPrices).value,
      'RUB',
      t('config.notAvailable'),
    );
  const statMeters = [
    {
      key: 'weight',
      label: t('config.stat.weight'),
      value: currentWeightValue,
      displayValue: currentWeight,
      range: WEAPON_STAT_UI_RANGES.weight,
    },
    {
      key: 'ergonomics',
      label: t('config.stat.ergonomics'),
      value: currentErgo,
      range: WEAPON_STAT_UI_RANGES.ergonomics,
    },
    {
      key: 'vertical-recoil',
      label: t('config.stat.verticalRecoil'),
      value: currentRecoilV,
      range: withBaseStatMaximum(
        WEAPON_STAT_UI_RANGES.verticalRecoil,
        weapon.properties?.recoilVertical,
      ),
    },
    {
      key: 'horizontal-recoil',
      label: t('config.stat.horizontalRecoil'),
      value: currentRecoilH,
      range: withBaseStatMaximum(
        WEAPON_STAT_UI_RANGES.horizontalRecoil,
        weapon.properties?.recoilHorizontal,
      ),
    },
  ];

  // Группировка деталей сборки
  const partsGroups = [];
  if (canShowBuildDetails) {
    const groupMap = new Map();
    getBuildModuleDisplayItems(weapon, buildResult.build).forEach(part => {
      const slotGroup = getReadableSlotGroupName(part.slotName, t);
      const displayRank = getModuleDisplayRank(part);
      const groupKey = `${displayRank}:${slotGroup}`;
      let group = groupMap.get(groupKey);
      if (!group) {
        group = {
          displayRank,
          rootSlotName: slotGroup,
          parts: []
        };
        groupMap.set(groupKey, group);
        partsGroups.push(group);
      }
      group.parts.push(part);
    });

    partsGroups.sort((a, b) => {
      if (a.displayRank !== b.displayRank) {
        return a.displayRank - b.displayRank;
      }

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
    const filteredParts = sortModuleDisplayItems(group.parts).filter(part => {
      if (!partsFilter.trim()) return true;
      const q = partsFilter.trim().toLowerCase();
      const name = (part.item?.name || '').toLowerCase();
      const shortName = (part.item?.shortName || '').toLowerCase();
      const slot = (part.slotName || '').toLowerCase();
      const parentName = (part.parentItem?.name || part.parentItem?.shortName || '').toLowerCase();
      const groupName = group.rootSlotName.toLowerCase();
      return name.includes(q)
        || shortName.includes(q)
        || slot.includes(q)
        || parentName.includes(q)
        || groupName.includes(q);
    });
    return {
      ...group,
      parts: filteredParts
    };
  }).filter(group => group.parts.length > 0);

  return (
    <div className="layout">
      {/* Левый сайдбар с конфигурацией сборки */}
      <aside className="config" aria-label={t('config.buildConfiguration')}>
        <div className="config__head">
          <h2>{t('config.buildConfiguration')}</h2>
        </div>

        <section className="config__section config__section--tabs">
          <div className="segmented segmented--tabs">
            {[
              { value: 'basic', label: t('config.basic') },
              { value: 'advanced', label: t('config.advanced') }
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
          <label className="field-label">{t('config.goal')}</label>
          <div className="segmented segmented--goals">
            {[
              { value: 'meta', label: t('config.meta') },
              { value: 'custom', label: t('config.custom') }
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

        <div
          className={`custom-radar-collapse ${targetType === 'custom' ? 'is-open' : ''}`}
          aria-hidden={targetType !== 'custom'}
          inert={targetType !== 'custom'}
        >
          <div className="custom-radar-collapse__inner">
            <CustomBuildRadar
              profile={customProfile}
              weapon={weapon}
              onChange={setCustomProfile}
              exactTargets={customExactTargets}
              onExactChange={(axisKey, enabled) => setCustomExactTargets(current => ({
                ...current,
                [axisKey]: enabled,
              }))}
            />
          </div>
        </div>

        <section className="config__section">
          <label className="field-label">{t('config.suppressor')}</label>
          <div className="segmented segmented--three">
            {SUPPRESSOR_MODE_OPTIONS.map(option => (
              <button
                key={option.value}
                className={`segmented__btn ${suppressorMode === option.value ? 'is-active' : ''}`}
                type="button"
                onClick={() => setSuppressorMode(option.value)}
              >
                {t(option.label)}
              </button>
            ))}
          </div>
        </section>

        <section className="config__section">
          <label className="field-label">{t('config.priceMode')}</label>
          <div className="segmented segmented--two">
            {PRICE_MODE_OPTIONS.map(option => (
              <button
                key={option.value}
                className={`segmented__btn ${priceMode === option.value ? 'is-active' : ''}`}
                type="button"
                onClick={() => setPriceMode(option.value)}
              >
                {t(`config.price.${option.value}`)}
              </button>
            ))}
          </div>
          <div className="checks price-source-checks">
            <label className="check" htmlFor="includeTraderPrices">
              <input
                id="includeTraderPrices"
                type="checkbox"
                checked={includeTraderPrices}
                onChange={event => handleIncludeTraderPricesChange(event.target.checked)}
                aria-describedby="includeTraderPricesHelp"
              />
              <span>{t('config.includeTraders')}</span>
            </label>
            <span id="includeTraderPricesHelp" className="field-help">
              {t('config.helpPrices')}
            </span>
          </div>
        </section>

        {targetType !== 'custom' && <section className="config__section">
          <div className="input-grid">
            <div>
              <label className="field-label" htmlFor="maxWeight">{t('config.maxWeight')}</label>
              <input 
                id="maxWeight" 
                type="number" 
                placeholder={t('config.noLimit')}
                min="0" 
                max={WEAPON_STAT_UI_RANGES.weight.max}
                step="0.05"
                value={maxWeight}
                onChange={e => setCustomProfile(current => normalizeCustomBuildProfile({
                  ...current,
                  weight: e.target.value === '' ? 0 : Number(e.target.value),
                }, weapon))}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="maxBudget">{t('config.maxBudget')}</label>
              <input 
                id="maxBudget" 
                type="number" 
                placeholder={t('config.noLimit')}
                min="0" 
                max={WEAPON_STAT_UI_RANGES.price.max}
                step="1000"
                value={maxPrice}
                onChange={e => setCustomProfile(current => normalizeCustomBuildProfile({
                  ...current,
                  price: e.target.value === '' ? 0 : Number(e.target.value),
                }, weapon))}
              />
            </div>
          </div>
        </section>}

        <section className="config__section">
          <label className="field-label">{t('config.magazine')}</label>
          <div className="segmented segmented--capacity">
            {availableCapacities.map(capacity => (
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
          <label className="field-label" htmlFor="sightZoom">{t('config.sight')}</label>
          <div className={`config-select-wrap ${isSightSelectOpen ? 'is-open' : ''}`}>
            <select
              id="sightZoom"
              className="config-select"
              value={sightMode}
              onChange={e => {
                setSightMode(e.target.value);
                setIsSightSelectOpen(false);
              }}
              onFocus={() => setIsSightSelectOpen(true)}
              onBlur={() => setIsSightSelectOpen(false)}
              onKeyDown={e => {
                if (e.key === 'Escape') setIsSightSelectOpen(false);
              }}
            >
              {[
                { value: 'none', label: t('config.sight.none') },
                { value: 'any', label: t('config.sight.any') },
                { value: 'reflex', label: t('config.sight.reflex') },
                { value: 'scope', label: t('config.sight.scope') },
                ...availableZoomLevels
                  .filter(z => z > 1)
                  .map(z => ({ value: String(z), label: t('config.sight.zoom', { zoom: z }) }))
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
          </div>
        </section>

        <section className="config__section">
          <label className="field-label">{t('config.accessories')}</label>
          <div className="checks">
            <label className="check">
              <input 
                type="checkbox" 
                checked={includeLaser}
                onChange={e => setIncludeLaser(e.target.checked)}
              /> 
              <span>{t('config.laser')}</span>
            </label>
            <label className="check">
              <input 
                type="checkbox" 
                checked={includeFlashlight}
                onChange={e => setIncludeFlashlight(e.target.checked)}
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
              onChange={e => setRequiredModuleSearch(e.target.value)}
            />

            {requiredModuleResults.length > 0 && (
              <div className="module-search-list">
                {requiredModuleResults.map(item => {
                  const priceInfo = getSelectedPriceInfo(item, priceMode, includeTraderPrices);

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
                        <span>{getModuleCategoryLabel(item, t)} · {formatCurrency(priceInfo.value, priceInfo.currency, t('config.notAvailable'))}</span>
                        <PriceSource priceInfo={priceInfo} />
                      </span>
                      <span className="module-search-item__action">{t('config.add')}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="required-modules">
              {selectedRequiredModules.length === 0 ? (
                <div className="required-modules__empty">{t('config.noRequiredModules')}</div>
              ) : (
                selectedRequiredModules.map(item => {
                  const priceInfo = getSelectedPriceInfo(item, priceMode, includeTraderPrices);

                  return <div key={item.id} className="required-module">
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
                      <span>{getModuleCategoryLabel(item, t)} · {formatCurrency(priceInfo.value, priceInfo.currency, t('config.notAvailable'))}</span>
                      <PriceSource priceInfo={priceInfo} />
                    </div>
                    <button
                      className="required-module__remove"
                      type="button"
                      onClick={() => handleRemoveRequiredModule(item.id)}
                      aria-label={t('config.removeModule', { name: item.shortName || item.name })}
                    >
                      {t('config.remove')}
                    </button>
                  </div>;
                })
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
            {generating ? t('config.calculating') : t('config.generateBuild')}
          </button>
        </section>
      </aside>

      {/* Правая основная область */}
      <main>
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
                <span>{t(`config.price.${priceMode}Short`)}</span>
                <span className="source__separator" aria-hidden="true">·</span>
                <TarkovDevItemLink
                  weapon={weapon}
                  title={t('config.tarkovDevLinkTitle')}
                  ariaLabel={t('config.tarkovDevLinkAria', { weapon: weapon.name || weapon.shortName || t('config.weapon') })}
                  fallbackWeaponName={t('config.weapon')}
                />
                <span className="source__separator" aria-hidden="true">·</span>
                <span>{priceDiagnostics.summaryStatus}</span>
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
                {statMeters.map(({ key, ...stat }) => (
                  <StatMeterRow key={key} {...stat} t={t} />
                ))}
            </div>

            <div className="weapon-diagram-trigger">
              <button
                className="btn btn--ghost"
                type="button"
                onClick={() => setIsBuildDiagramOpen(true)}
              >
                {t('config.diagram')}
              </button>
            </div>

            <div className="weapon__actions">
              <div className="price-box">
                <span className="price-title">{t('config.price')}</span>
                <span className="price-amount">{currentPrice}</span>
              </div>
              {selectedRequiredModules.length > 0 && (
                <div className="chip">
                  {t('config.required')}
                  <strong>{t('config.modulesCount', { count: selectedRequiredModules.length })}</strong>
                </div>
              )}

              {canShowBuildDetails && (
                <div className="save-build-bar">
                  <label htmlFor="saveBuildName">
                    <span>{t('config.buildName')}</span>
                    <input
                      id="saveBuildName"
                      type="text"
                      maxLength={80}
                      value={saveName}
                      onChange={event => {
                        setSaveName(event.target.value);
                        setSaveFeedback(null);
                      }}
                      placeholder={t('config.saveNameDefault', { weapon: weapon.shortName || weapon.name })}
                    />
                  </label>
                  <button className="btn btn--primary" type="button" onClick={handleSaveBuild}>
                    {activeSavedBuildId ? t('config.update') : t('config.save')}
                  </button>
                </div>
              )}

              {saveFeedback && (
                <InlineMessage
                  type={saveFeedback.type}
                  title={saveFeedback.type === 'error' ? t('config.saveFailedTitle') : t('config.savedLocalTitle')}
                >
                  {saveFeedback.message}
                </InlineMessage>
              )}
            </div>

          </section>

          {/* Правая панель - Список деталей */}
          <section className="panel parts-panel">
            {/* Поле поиска */}
            <div className="parts-toolbar">
              <input 
                type="search" 
                placeholder={t('config.filterParts')}
                value={partsFilter}
                onChange={e => setPartsFilter(e.target.value)}
              />
              <button 
                className="btn btn--ghost" 
                type="button"
                onClick={() => setPartsFilter('')}
              >
                {t('config.clear')}
              </button>
            </div>

            {/* Вывод ошибок при расчете сборки */}
            {generationError && (
              <InlineMessage type="error" title={t('config.generationFailedTitle')}>
                {generationError}
              </InlineMessage>
            )}

            {pricePolicyWarning && (
              <InlineMessage type="warning" title={t('config.pricePolicyTitle')}>
                {pricePolicyWarning}
              </InlineMessage>
            )}

            {replacementError && (
              <InlineMessage type="error" title={t('config.replacementRejected')}>
                {replacementError}
              </InlineMessage>
            )}

            {buildResult && hasCalculationError && (
              <InlineMessage type="error" title={t('config.constraintFailed')}>
                {getBuildResultErrorMessage(buildResult, language, t)}
              </InlineMessage>
            )}

            {buildResult && !hasCalculationError && buildResult.warning && (
              <InlineMessage type="warning" title={t('config.buildNotice')}>
                {getBuildResultWarningMessage(buildResult, language, t)}
              </InlineMessage>
            )}

            {canShowBuildDetails && priceDiagnostics?.warningMessages.length > 0 && (
              <InlineMessage type="warning" title={t('config.priceDataNotice')}>
                {priceDiagnostics.warningMessages.join(' ')}
              </InlineMessage>
            )}

            {/* Рендеринг сгруппированных деталей */}
            {!generating && canShowBuildDetails && renderedGroups.map(group => (
              <div key={`${group.displayRank}:${group.rootSlotName}`} className="parts-group">
                <div className="parts-group__head">
                  <h3>{group.rootSlotName}</h3>
                  <span>{t('config.parts', { count: group.parts.length })}</span>
                </div>
                <div className="parts-grid">
                  {group.parts.map(part => {
                    if (part.isEmpty) {
                      return (
                        <article key={part.key} className="part-card part-card--critical part-card--empty-critical">
                          <div className="part-card__media part-card__media--warning">
                            <WarningIcon className="part-card__warning-icon" />
                          </div>
                          <div className="part-card__body">
                            <div className="part-card__title-wrap">
                              <h4 className="part-card__empty-warning">{part.emptyWarning}</h4>
                              <span className="part-card__slot-context">
                                {part.slotName} · {formatPartName(part.parentItem?.shortName || part.parentItem?.name)}
                              </span>
                            </div>
                            <div className="part-card__badges">
                            <CriticalModuleBadge t={t} />
                            </div>
                          </div>
                        </article>
                      );
                    }

                    const partPriceInfo = getSelectedPriceInfo(
                      part.item,
                      priceMode,
                      includeTraderPrices,
                    );

                    return (
                      <article
                        key={part.key}
                        className={`part-card ${part.isCritical ? 'part-card--critical' : ''}`}
                      >
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
                            <div className="part-card__title-wrap">
                              <h4>{formatPartName(part.item.shortName)}</h4>
                              {part.isCritical && (
                                <div className="part-card__badges">
                                  <CriticalModuleBadge t={t} />
                                </div>
                              )}
                            </div>
                            <ItemPrice priceInfo={partPriceInfo} />
                          </div>
                          <button
                            className={`replace-btn ${activeReplacePartId === part.item.id ? 'active' : ''}`}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenReplaceDrawer(part);
                            }}
                          >
                            {t('config.replace')}
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
                {t('config.emptyBuild')}
              </div>
            )}
          </section>
        </div>
      </main>

      {isBuildDiagramOpen && (
        <WeaponBuildDiagramModal
          weapon={weapon}
          buildParts={canShowBuildDetails ? buildResult.build : []}
          allMods={allMods}
          stats={statMeters}
          priceMode={priceMode}
          includeTraderPrices={includeTraderPrices}
          onBuildChange={handleDiagramBuildChange}
          onClose={handleCloseBuildDiagram}
        />
      )}

      {/* Оверлей бокового слайдера (Drawer) для замены деталей */}
      {replacementContext && (() => {
        const {
          activePart,
          targetNode,
          hasSightChain,
          hasMountInChain,
          alternatives,
        } = replacementContext;
        const priceInfo = getSelectedPriceInfo(
          activePart.item,
          priceMode,
          includeTraderPrices,
        );

        return (
          <div className="drawer is-open" onClick={() => setActiveReplacePartId(null)}>
            <div className="drawer__panel" onClick={e => e.stopPropagation()}>
              <div className="drawer__head">
                <h2>{t('config.replacePart')}</h2>
                <button className="btn btn--ghost" type="button" onClick={() => setActiveReplacePartId(null)}>{t('common.close')}</button>
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
                      {t('config.replaceOptic')}
                    </button>
                    {hasMountInChain && (
                      <button
                        className={`segmented__btn ${replaceMode === 'SIGHT_MOUNT' ? 'is-active' : ''}`}
                        type="button"
                        onClick={() => setReplaceMode('SIGHT_MOUNT')}
                        style={{ flex: 1 }}
                      >
                        {t('config.replaceMount')}
                      </button>
                    )}
                    <button
                      className={`segmented__btn ${replaceMode === 'SIGHT_ASSEMBLY' ? 'is-active' : ''}`}
                      type="button"
                      onClick={() => setReplaceMode('SIGHT_ASSEMBLY')}
                      style={{ flex: 1 }}
                    >
                      {t('config.replaceAssembly')}
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
                    <div className="generated-meta">{getReadableSlotGroupName(activePart.slotName, t)} · {t('config.slot', { slot: activePart.slotName })}</div>
                    <h3 style={{ margin: '8px 0 6px', fontSize: '1.1rem' }}>{formatPartName(activePart.item.shortName)}</h3>
                    <ItemPrice priceInfo={priceInfo} />
                  </div>
                </div>

                <div style={{ marginTop: '1.5rem' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--color-accent-gold)', marginBottom: '0.75rem', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {t('config.compatibleAlternatives', { count: alternatives.length })}
                  </div>
                  {alternatives.length === 0 ? (
                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', fontStyle: 'italic', padding: '1rem 0' }}>
                      {targetNode && targetNode.children.length > 0
                        ? t('config.noCompatibleAttachments')
                        : t('config.noCompatibleModules')}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {alternatives.map(alt => {
                        const altPackageItems = getAlternativePackageItems(alt);
                        const altPriceInfo = getPackagePriceInfo(
                          altPackageItems,
                          priceMode,
                          includeTraderPrices,
                          t,
                        );
                        const altPriceValue = altPriceInfo.value;
                        
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

                        const baselinePriceInfo = getPackagePriceInfo(
                          baselineParts,
                          priceMode,
                          includeTraderPrices,
                          t,
                        );
                        const baselinePrice = baselinePriceInfo.value;
                        const baselineErgo = baselineParts.reduce((sum, item) => sum + (item.ergonomicsModifier || 0), 0);
                        const baselineRecoil = baselineParts.reduce((sum, item) => sum + (item.recoilModifier || 0), 0);
                        const baselineWeight = baselineParts.reduce((sum, item) => sum + (item.weight || 0), 0);

                        const altErgo = altPackageItems.reduce((sum, item) => sum + (item.ergonomicsModifier || 0), 0);
                        const altRecoil = altPackageItems.reduce((sum, item) => sum + (item.recoilModifier || 0), 0);
                        const altWeight = altPackageItems.reduce((sum, item) => sum + (item.weight || 0), 0);
                        const ergoDiff = altErgo - baselineErgo;
                        const recoilDiff = altRecoil - baselineRecoil;
                        const priceDiff = isPositivePrice(altPriceValue)
                          && isPositivePrice(baselinePrice)
                          ? altPriceValue - baselinePrice
                          : null;
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
                              handleReplacePart(targetNode, alt, effectiveMode);
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
                                  {t('config.ergo')}:{' '}
                                  <strong style={{ color: ergoDiff > 0 ? 'var(--green)' : ergoDiff < 0 ? 'var(--red)' : 'var(--muted)' }}>
                                    {ergoDiffText}
                                  </strong>
                                </span>
                                <span>
                                  {t('config.recoil')}:{' '}
                                  <strong style={{ color: recoilDiff < 0 ? 'var(--green)' : recoilDiff > 0 ? 'var(--red)' : 'var(--muted)' }}>
                                    {recoilDiffText}
                                  </strong>
                                </span>
                                <span>
                                  {t('config.weight')}:{' '}
                                  <strong style={{ color: weightDiff < 0 ? 'var(--green)' : weightDiff > 0 ? 'var(--red)' : 'var(--muted)' }}>
                                    {weightDiffText}
                                  </strong>
                                </span>
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', marginLeft: '0.5rem' }}>
                              <ItemPrice priceInfo={altPriceInfo} className="item-price--drawer" />
                              <div style={{ fontSize: '0.7rem', color: priceDiff < 0 ? 'var(--green)' : priceDiff > 0 ? 'var(--red)' : 'var(--muted)' }}>
                                {priceDiff === null
                                  ? t('config.priceDifferenceUnavailable')
                                  : priceDiff > 0
                                    ? `+${formatCurrency(priceDiff, altPriceInfo.currency, t('config.notAvailable'))}`
                                    : priceDiff < 0
                                      ? formatCurrency(priceDiff, altPriceInfo.currency, t('config.notAvailable'))
                                      : '0 RUB'}
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
