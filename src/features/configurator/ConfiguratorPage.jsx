import {
  useState,
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { PRICE_CONFIDENCE } from '../../data/price/priceModes.js';
import {
  selectPurchasePrice,
  selectWeaponPurchasePrice,
  sumPurchasePrices,
} from '../../data/price/priceMapper.js';
import {
  loadBuildGoalModePreference,
  loadIncludeTraderPricesPreference,
  loadLastSelectedFlashlightId,
  loadLastSelectedTblId,
  loadRememberTacticalDeviceSelectionPreference,
  saveIncludeTraderPricesPreference,
  saveLastSelectedFlashlightId,
  saveLastSelectedTblId,
  saveBuildGoalModePreference,
} from '../../data/settings/buildPreferences.js';
import { useI18n } from '../../i18n/useI18n.js';
import {
  getSavedBuild,
  restoreBuildParts,
} from '../../data/savedBuilds.js';
import { recalculateBuildStats } from '../../domain/calculator.js';
import {
  calculateBuildCostSummary,
  createBuildAssemblySnapshot,
  getBuildItemInstances,
  reconcileOwnedItems,
  toggleOwnedItem,
} from '../../domain/ownedItems.js';
import { categoryMatches, hasItemCategory } from '../../domain/itemCategories.js';
import {
  buildWeaponAssemblyTree as buildAssemblyTree,
  rebindBuildPartsToCatalog,
} from '../../domain/weaponAssembly.js';
import {
  DEFAULT_CUSTOM_EXACT_TARGETS,
  normalizeCustomExactTargets,
} from '../../domain/customExactTargets.js';
import {
  movePriorityAttribute,
  normalizePriorityAttributes,
  normalizePrioritySelectionMode,
  normalizePriorityWeights,
  PRIORITY_SELECTION_MODES,
  togglePriorityAttribute,
} from '../../domain/customPriorityAttributes.js';
import { rebalancePriorityWeights } from './priorityWeightControls.js';
import {
  normalizeBuildMaxPrice,
  resolveSharedMaxPrice,
} from '../../domain/buildMaxPrice.js';
import WeaponBuildDiagramModal from '../../ui/WeaponBuildDiagramModal.jsx';
import {
  CUSTOM_BUILD_DEFAULT_PROFILE,
  createCustomBuildProfileFromSettings,
  normalizeCustomBuildProfile,
} from '../../ui/customBuildRadar.js';
import {
  WEAPON_STAT_UI_RANGES,
  formatAccuracyMoa,
  toFiniteStatNumber,
  withBaseStatMaximum,
} from '../../ui/weaponStatMeters.js';
import {
  getModuleDisplayRank,
  getModuleDisplayState,
  isCriticalSlot,
  sortModuleDisplayItems,
} from '../../ui/criticalModules.js';
import AsyncImage from '../../ui/AsyncImage.jsx';
import ModalDialog from '../../ui/ModalDialog.jsx';
import useBuildCalculation from './hooks/useBuildCalculation.js';
import useConfiguratorCatalog from './hooks/useConfiguratorCatalog.js';
import useSavedBuild from './hooks/useSavedBuild.js';
import { getLocalizedBuildWarnings } from './configuratorNotifications.js';
import {
  getTacticalDeviceOptions,
  isTacticalDeviceReachable,
  TACTICAL_DEVICE_TYPES,
} from './tacticalDeviceOptions.js';
import {
  getPrimaryManualModuleType,
  getUniqueItemIds,
  PRIMARY_MANUAL_MODULE_TYPES,
  replacePrimaryManualModuleId,
} from './primaryManualModules.js';
import {
  getScopeOptions,
  getScopeZoomOptions,
  isSelectableScope,
} from './scopeOptions.js';
import {
  getScopeSightMode,
  normalizeScopeSelection,
  SCOPE_MODES,
  SCOPE_NONE_OPTION_ID,
} from './scopeSelection.js';
import { usePriceMode } from '../priceMode/usePriceMode.js';
import { useTraderLevels } from '../traderLevels/useTraderLevels.js';
import {
  ItemPrice,
} from './components/PriceDisplay.jsx';
import {
  formatCurrency,
  formatPriceSource,
  isPositivePrice,
} from './formatters.js';
import BuildParts from './components/BuildParts.jsx';
import BuildSettings from './components/BuildSettings.jsx';
import {
  getBuildGoalModeFromSettings,
  getCalculatorGoalState,
} from './buildGoalModes.js';
import BuildWarnings from './components/BuildWarnings.jsx';
import {
  ConfiguratorLoading,
  ConfiguratorUnavailable,
} from './components/ConfiguratorPageState.jsx';
import WeaponSummary from './components/WeaponSummary.jsx';
import {
  applyReplacement,
  findTreeNodeByItemId,
  formatPartName,
  getAlternativeDisplayName,
  getAlternativeListKey,
  getAlternativePackageItems,
  getAlternativeSight,
  getReplaceTarget,
  isMountItem,
  isSightItem,
  isValidSightForMode,
  scoreScope,
  selectReplacementCandidates,
  subtreeHasSight,
} from './services/replacementService.js';

function getBuildModuleDisplayItems(weapon, buildParts, assemblyTree = null) {
  const tree = assemblyTree || buildAssemblyTree(weapon, buildParts);
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

  visit(tree);

  const installedItems = buildParts.map((part, originalIndex) => {
    const node = nodeByBuildPart.get(part);
    const slot = node?.sourceSlot || null;

    return {
      ...part,
      ...getModuleDisplayState(slot, part.item),
      key: `installed:${part.item.id}:${part.slotName}:${originalIndex}`,
      ownershipKey: node?.instanceId || null,
      parentItem: node?.parent?.item || weapon,
      slot,
    };
  });

  return [...installedItems, ...emptyCriticalItems];
}

function findCompatibleAlternatives(
  node,
  allMods,
  priceMode,
  includeTraderPrices,
  traderLevels,
  strictTraderLevels,
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

          const score = scoreScope(
            scopeItem,
            priceMode,
            includeTraderPrices,
            traderLevels,
            strictTraderLevels,
          );
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

  return selectReplacementCandidates({
    alternatives,
    targetNode,
    priceMode,
    includeTraderPrices,
    traderLevels,
    strictTraderLevels,
  });
}

function getItemDisplayName(item, fallbackLabel = 'Item') {
  return item?.shortName || item?.name || fallbackLabel;
}

function getSelectedPriceInfo(
  item,
  selectedPriceMode,
  includeTraderPrices,
  traderLevels,
  strictTraderLevels,
  useWeaponFallback = false,
) {
  const priceInfo = (useWeaponFallback ? selectWeaponPurchasePrice : selectPurchasePrice)(item, {
    priceMode: selectedPriceMode,
    includeTraderPrices,
    traderLevels,
    strictTraderLevels,
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

function getPackagePriceInfo(
  items,
  selectedPriceMode,
  includeTraderPrices,
  traderLevels,
  strictTraderLevels,
  t,
) {
  const packagePrice = sumPurchasePrices(items, {
    priceMode: selectedPriceMode,
    includeTraderPrices,
    traderLevels,
    strictTraderLevels,
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

function collectBuildPriceDiagnostics(
  weapon,
  buildResult,
  selectedPriceMode,
  includeTraderPrices,
  traderLevels,
  strictTraderLevels,
  ownedItems,
  t,
  instances = null,
) {
  const ownedKeys = new Set((ownedItems || []).map(item => item.key));
  const entries = (instances || getBuildItemInstances(weapon, buildResult.build)).map(instance => ({
    label: instance.isWeapon
      ? t('config.weapon')
      : getItemDisplayName(instance.item, instance.buildPart?.slotName),
    item: instance.item,
    instanceKey: instance.key,
    isOwned: ownedKeys.has(instance.key),
    priceInfo: getSelectedPriceInfo(
      instance.item,
      selectedPriceMode,
      includeTraderPrices,
      traderLevels,
      strictTraderLevels,
      instance.isWeapon,
    ),
  }));

  const fallbackEntries = entries.filter(entry => (
    !entry.isOwned
    &&
    entry.priceInfo.fallbackUsed
    && !entry.priceInfo.isMissing
  ));
  const missingEntries = entries.filter(entry => !entry.isOwned && entry.priceInfo.isMissing);
  const modeMismatchEntries = entries.filter(entry => entry.priceInfo.modeMismatch);
  const barterOnlyEntries = entries.filter(entry => entry.priceInfo.barterOnly);
  const sourceLabels = Array.from(new Set(
    entries
      .filter(entry => !entry.priceInfo.isMissing)
      .map(entry => entry.priceInfo.source)
      .filter(Boolean),
  ));

  const warningMessages = [];
  const infoMessages = [];

  missingEntries.forEach(entry => warningMessages.push(
    t('config.notification.priceMissingItem', { item: entry.label }),
  ));

  fallbackEntries.forEach(entry => infoMessages.push(
    t('config.notification.priceFallbackItem', { item: entry.label }),
  ));

  if (modeMismatchEntries.length > 0) {
    warningMessages.push(
      t('config.notification.priceModeMismatch', {
        items: formatDiagnosticsList(modeMismatchEntries, t),
      }),
    );
  }

  if (barterOnlyEntries.length > 0) {
    infoMessages.push(
      t('config.notification.priceBarterOnly', {
        items: formatDiagnosticsList(barterOnlyEntries, t),
      }),
    );
  }

  if (sourceLabels.length > 1) {
    infoMessages.push(
      t('config.notification.priceMixedSources', { sources: sourceLabels.join(', ') }),
    );
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
    infoMessages,
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
  traderLevels,
  strictTraderLevels,
  ownedItems,
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
    traderLevels,
    strictTraderLevels,
  });
  const parsedMaxWeight = Number(maxWeight) || 0;
  const parsedMaxPrice = Number(maxPrice) || 0;
  const costSummary = calculateBuildCostSummary({
    weapon,
    buildParts,
    ownedItems,
    priceOptions: {
      priceMode,
      includeTraderPrices,
      traderLevels,
      strictTraderLevels,
    },
  });

  if (parsedMaxWeight > 0 && Number(stats.weight) > parsedMaxWeight + 0.0001) {
    errors.push(t('config.weightLimit', { weight: parsedMaxWeight }));
  }
  if (parsedMaxPrice > 0 && !isPositivePrice(costSummary.remainingTotal)) {
    errors.push(t('config.priceUnavailable'));
  } else if (parsedMaxPrice > 0 && costSummary.remainingTotal > parsedMaxPrice) {
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
  'ств кор': 'config.slotGroup.receiver',
  'ствольная коробка': 'config.slotGroup.receiver',
  'pistolgrip': 'config.slotGroup.pistolGrip',
  'pistol grip': 'config.slotGroup.pistolGrip',
  'grip': 'config.slotGroup.pistolGrip',
  'gasblock': 'config.slotGroup.gasBlock',
  'gas block': 'config.slotGroup.gasBlock',
  'газ кам': 'config.slotGroup.gasBlock',
  'газовая камера': 'config.slotGroup.gasBlock',
  'front sight': 'config.slotGroup.frontSight',
  'rear sight': 'config.slotGroup.rearSight',
  'ubgl': 'config.slotGroup.underbarrelLauncher',
  'tactical': 'config.slotGroup.tacticalDevice',
  'foregrip': 'config.slotGroup.foregrip',
  'front grip': 'config.slotGroup.foregrip',
  'перед рук': 'config.slotGroup.foregrip',
  'передняя рукоятка': 'config.slotGroup.foregrip',
  'bipod': 'config.slotGroup.bipod',
  'launcher': 'config.slotGroup.launcher',
  'scope': 'config.slotGroup.scope',
  'mount': 'config.slotGroup.mount',
  'charge': 'config.slotGroup.chargingHandle',
  'charging handle': 'config.slotGroup.chargingHandle',
  'рук затв': 'config.slotGroup.chargingHandle',
  'рукоятка затвора': 'config.slotGroup.chargingHandle',
  'рукоятка взведения': 'config.slotGroup.chargingHandle',
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
  name = name.replace(/[.\s_-]+/g, ' ').trim();
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

function getBuildResultErrorMessage(buildResult, language, t) {
  if (buildResult.errorCode === 'CUSTOM_EXACT_TARGETS_UNMET') {
    return t('config.exactTargetsUnmet');
  }

  return language === 'ru' ? t('config.constraintMessage') : buildResult.error;
}

function Configurator() {
  const { language, t } = useI18n();
  const { priceMode, setPriceMode } = usePriceMode();
  const {
    traderLevels,
    strictTraderLevels,
  } = useTraderLevels();
  const activeTraderLevels = useMemo(
    () => traderLevels.profiles?.[priceMode] || {},
    [priceMode, traderLevels],
  );
  const { weaponId } = useParams();
  const [searchParams] = useSearchParams();
  const requestedSavedBuildId = searchParams.get('build');
  const requestedSavedBuild = useMemo(
    () => getSavedBuild(requestedSavedBuildId),
    [requestedSavedBuildId],
  );
  const [weapon, setWeapon] = useState(null);
  const [loading, setLoading] = useState(true);
  const [buildGoalMode, setBuildGoalMode] = useState(loadBuildGoalModePreference);
  const { targetType, characteristicMode } = getCalculatorGoalState(buildGoalMode);
  const [customProfile, setCustomProfile] = useState(CUSTOM_BUILD_DEFAULT_PROFILE);
  const [customExactTargets, setCustomExactTargets] = useState(DEFAULT_CUSTOM_EXACT_TARGETS);
  const effectiveCustomExactTargets = useMemo(() => ({
    ...customExactTargets,
    price: false,
  }), [customExactTargets]);
  const [priorityAttributes, setPriorityAttributes] = useState([]);
  const [prioritySelectionMode, setPrioritySelectionMode] = useState(PRIORITY_SELECTION_MODES.ORDERED);
  const [priorityWeights, setPriorityWeights] = useState(() => normalizePriorityWeights());
  const [maxPrice, setMaxPrice] = useState(
    () => resolveSharedMaxPrice(requestedSavedBuild?.settings),
  );
  const [suppressorMode, setSuppressorMode] = useState('allow');
  const [includeTraderPrices, setIncludeTraderPrices] = useState(
    () => requestedSavedBuild?.settings.includeTraderPrices
      ?? loadIncludeTraderPricesPreference(),
  );
  const [activeReplacePartId, setActiveReplacePartId] = useState(null);
  const replacementTriggerRef = useRef(null);
  const [replaceMode, setReplaceMode] = useState('EXACT_ITEM');
  const [magazineCapacity, setMagazineCapacity] = useState(30);
  const [allMods, setAllMods] = useState(null);
  const [buildResult, setBuildResult] = useState(null);
  const [ownedItems, setOwnedItems] = useState(
    () => requestedSavedBuild?.ownedItems || [],
  );
  const currentBuildParts = buildResult?.build;
  const currentBuildSnapshot = useMemo(
    () => weapon && currentBuildParts
      ? createBuildAssemblySnapshot(weapon, currentBuildParts)
      : null,
    [weapon, currentBuildParts],
  );
  const reconciledOwnedItems = useMemo(
    () => weapon && currentBuildParts
      ? reconcileOwnedItems(
        ownedItems,
        weapon,
        currentBuildParts,
        currentBuildSnapshot?.instances,
      )
      : [],
    [currentBuildParts, currentBuildSnapshot, ownedItems, weapon],
  );
  const [loadError, setLoadError] = useState(null);
  const [generationError, setGenerationError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [includeLaser, setIncludeLaser] = useState(false);
  const [includeFlashlight, setIncludeFlashlight] = useState(false);
  const [rememberTacticalDeviceSelection] = useState(
    loadRememberTacticalDeviceSelectionPreference,
  );
  const [flashlightItemId, setFlashlightItemId] = useState(null);
  const [tblItemId, setTblItemId] = useState(null);
  const [scopeMode, setScopeMode] = useState(SCOPE_MODES.NONE);
  const [scopeItemId, setScopeItemId] = useState(null);
  const [scopeZoom, setScopeZoom] = useState(null);
  const [isBuildDiagramOpen, setIsBuildDiagramOpen] = useState(false);
  const sightMode = useMemo(
    () => getScopeSightMode(scopeMode, scopeZoom),
    [scopeMode, scopeZoom],
  );
  const [partsFilter, setPartsFilter] = useState('');
  const [requiredModuleSearch, setRequiredModuleSearch] = useState('');
  const [requiredModuleIds, setRequiredModuleIds] = useState([]);
  const requiredItemIds = useMemo(() => getUniqueItemIds([
    ...requiredModuleIds,
    ...(includeFlashlight && flashlightItemId ? [flashlightItemId] : []),
    ...(includeLaser && tblItemId ? [tblItemId] : []),
    ...(scopeMode === SCOPE_MODES.MANUAL && scopeItemId ? [scopeItemId] : []),
  ]), [flashlightItemId, includeFlashlight, includeLaser, requiredModuleIds, scopeItemId, scopeMode, tblItemId]);
  const [replacementError, setReplacementError] = useState(null);
  const [pricePolicyWarning, setPricePolicyWarning] = useState(null);
  const [priceModeNotice, setPriceModeNotice] = useState(null);
  const [maxPriceDraft, setMaxPriceDraft] = useState(null);
  const maxWeight = customProfile.weight > 0 ? String(customProfile.weight) : '';
  const {
    cancelPendingCalculations,
    latestCalculationRequestIdRef,
    runBuildCalculation,
  } = useBuildCalculation();
  const {
    activeSavedBuildId,
    saveFeedback,
    saveName,
    saveBuild: handleSaveBuild,
    setActiveSavedBuildId,
    setSaveFeedback,
    setSaveName,
  } = useSavedBuild({
    requestedSavedBuild,
    requestedSavedBuildId,
    weapon,
    buildResult,
    ownedItems: reconciledOwnedItems,
    settings: {
      buildGoalMode,
      targetType,
      customProfile,
      customExactTargets: effectiveCustomExactTargets,
      characteristicMode,
      priorityAttributes,
      prioritySelectionMode,
      priorityWeights: normalizePriorityWeights(priorityWeights),
      maxPrice,
      suppressorMode,
      priceMode,
      includeTraderPrices,
      strictTraderLevels,
      traderLevelsSnapshot: activeTraderLevels,
      magazineCapacity,
      includeLaser,
      includeFlashlight,
      flashlightItemId,
      tblItemId,
      scopeMode,
      scopeItemId,
      scopeZoom,
      sightMode,
      requiredModuleIds,
    },
    t,
  });

  useLayoutEffect(() => {
    if (requestedSavedBuild?.settings.priceMode
      && requestedSavedBuild.settings.priceMode !== priceMode) {
      setPriceMode(requestedSavedBuild.settings.priceMode);
    }
  }, [priceMode, requestedSavedBuild, setPriceMode]);

  useEffect(() => {
    cancelPendingCalculations();
  }, [cancelPendingCalculations, priceMode]);

  useEffect(() => {
    saveIncludeTraderPricesPreference(includeTraderPrices);
  }, [includeTraderPrices]);

  useEffect(() => {
    saveBuildGoalModePreference(buildGoalMode);
  }, [buildGoalMode]);

  useConfiguratorCatalog({
    weaponId,
    priceMode,
    savedBuildId: requestedSavedBuildId,
    language,
    onLoading: ({ isCatalogReload }) => {
      if (!isCatalogReload) setLoading(true);
    },
    onLoaded: ({
      weapon: weaponData,
      allMods: modsData,
      isCatalogReload,
      reloadReason,
      previousWeapon,
    }) => {
      setWeapon(weaponData);
      setAllMods(modsData);

      if (isCatalogReload) {
        setBuildResult(current => {
          if (!current?.build) return current;

          const localizedBuild = rebindBuildPartsToCatalog(
            previousWeapon,
            current.build,
            weaponData,
            modsData,
          );

          const recalculated = recalculateBuildStats(weaponData, localizedBuild, {
            priceMode,
            includeTraderPrices,
            traderLevels: activeTraderLevels,
            strictTraderLevels,
          });
          return {
            ...current,
            build: localizedBuild,
            stats: {
              ...current.stats,
              price: recalculated.stats.price,
            },
          };
        });
        if (reloadReason === 'price-mode') {
          const budgetLimit = Number(maxPrice) || 0;
          const currentBuild = buildResult?.build;
          const localizedBuild = currentBuild
            ? rebindBuildPartsToCatalog(previousWeapon, currentBuild, weaponData, modsData)
            : null;
          const nextPrice = localizedBuild
            ? calculateBuildCostSummary({
              weapon: weaponData,
              buildParts: localizedBuild,
              ownedItems,
              priceOptions: {
                priceMode,
                includeTraderPrices,
                traderLevels: activeTraderLevels,
                strictTraderLevels,
              },
            }).remainingTotal
            : null;
          setPricePolicyWarning(
            budgetLimit > 0 && !isPositivePrice(nextPrice)
              ? t('config.currentPriceUnavailable')
              : budgetLimit > 0 && nextPrice > budgetLimit
                ? t('config.currentBudgetExceeded', { price: budgetLimit })
                : null,
          );
          if (currentBuild) setPriceModeNotice(t('priceMode.recalculateNotice'));
        }
        setLoadError(null);
        setLoading(false);
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
          traderLevels: activeTraderLevels,
          strictTraderLevels,
        });

        setBuildResult({
          build: restored.build,
          stats: restoredResult.stats,
          warningCode: restored.missingItemIds.length > 0
            ? 'SAVED_MODULES_SKIPPED'
            : undefined,
          warningParams: restored.missingItemIds.length > 0
            ? { count: restored.missingItemIds.length }
            : undefined,
          warning: restored.missingItemIds.length > 0
            ? t('config.savedModulesSkipped', { count: restored.missingItemIds.length })
            : undefined,
        });
        setOwnedItems(requestedSavedBuild.ownedItems || []);
        setBuildGoalMode(getBuildGoalModeFromSettings(settings));
        setCustomProfile(createCustomBuildProfileFromSettings(settings, weaponData));
        setCustomExactTargets(normalizeCustomExactTargets(settings.customExactTargets));
        setPriorityAttributes(normalizePriorityAttributes(settings.priorityAttributes));
        setPrioritySelectionMode(normalizePrioritySelectionMode(settings.prioritySelectionMode));
        setPriorityWeights(normalizePriorityWeights(settings.priorityWeights));
        setMaxPrice(resolveSharedMaxPrice(settings));
        setMaxPriceDraft(null);
        setSuppressorMode(settings.suppressorMode || 'allow');
        setIncludeTraderPrices(restoredIncludeTraderPrices);
        setMagazineCapacity(Number(settings.magazineCapacity) || capacities[0] || 30);
        const restoredFlashlightItemId = settings.flashlightItemId && modsData[settings.flashlightItemId]
          ? settings.flashlightItemId
          : null;
        const restoredTblItemId = settings.tblItemId && modsData[settings.tblItemId]
          ? settings.tblItemId
          : null;
        const restoredScopeSelection = normalizeScopeSelection(
          settings,
          itemId => isSelectableScope(modsData[itemId]),
        );
        setIncludeLaser(settings.includeLaser === true || Boolean(restoredTblItemId));
        setIncludeFlashlight(settings.includeFlashlight === true || Boolean(restoredFlashlightItemId));
        setFlashlightItemId(restoredFlashlightItemId);
        setTblItemId(restoredTblItemId);
        setScopeMode(restoredScopeSelection.mode);
        setScopeItemId(restoredScopeSelection.itemId);
        setScopeZoom(restoredScopeSelection.zoom);
        setRequiredModuleIds(getUniqueItemIds([
          ...(settings.requiredModuleIds || []).filter(itemId => Boolean(modsData[itemId])),
          restoredFlashlightItemId,
          restoredTblItemId,
          restoredScopeSelection.mode === SCOPE_MODES.MANUAL
            ? restoredScopeSelection.itemId
            : null,
        ]));
        setActiveSavedBuildId(requestedSavedBuild.id);
        setSaveName(requestedSavedBuild.name);
      } else {
        setBuildResult(null);
        setOwnedItems([]);
        setCustomExactTargets(DEFAULT_CUSTOM_EXACT_TARGETS);
        setRequiredModuleIds([]);
        const savedFlashlightItemId = rememberTacticalDeviceSelection
          ? loadLastSelectedFlashlightId()
          : undefined;
        const savedTblItemId = rememberTacticalDeviceSelection
          ? loadLastSelectedTblId()
          : undefined;
        const restoredFlashlightItemId = typeof savedFlashlightItemId === 'string'
          && isTacticalDeviceReachable(weaponData, modsData, savedFlashlightItemId)
          ? savedFlashlightItemId
          : null;
        const restoredTblItemId = typeof savedTblItemId === 'string'
          && isTacticalDeviceReachable(weaponData, modsData, savedTblItemId)
          ? savedTblItemId
          : null;
        setIncludeFlashlight(savedFlashlightItemId === null
          ? false
          : savedFlashlightItemId !== undefined);
        setIncludeLaser(savedTblItemId === null ? false : savedTblItemId !== undefined);
        setFlashlightItemId(restoredFlashlightItemId);
        setTblItemId(restoredTblItemId);
        setRequiredModuleIds(getUniqueItemIds([
          restoredFlashlightItemId,
          restoredTblItemId,
        ]));
        setScopeMode(SCOPE_MODES.NONE);
        setScopeItemId(null);
        setScopeZoom(null);
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
    },
    onError: (error, { isCatalogReload }) => {
      console.error(error);
      if (isCatalogReload) {
        setPricePolicyWarning(t('priceMode.refreshFailed'));
        return;
      }
      setWeapon(null);
      setAllMods(null);
      setLoadError(t('config.error'));
      setBuildResult(null);
      setGenerationError(null);
      setReplacementError(null);
      setLoading(false);
    },
  });

  const handleReplacePart = (targetNode, alternativeItem, mode = 'EXACT_ITEM') => {
    if (!buildResult || !targetNode) return;

    const updatedBuild = applyReplacement(
      buildResult.build,
      targetNode,
      alternativeItem,
      mode,
    );

    const attachmentError = getUnattachedBuildPartError(weapon, updatedBuild, t);
    const { errors, stats } = getReplacementConstraintErrors({
      weapon,
      buildParts: updatedBuild,
      priceMode,
      includeTraderPrices,
      traderLevels: activeTraderLevels,
      strictTraderLevels,
      ownedItems: reconciledOwnedItems,
      maxWeight,
      maxPrice,
      requiredItemIds,
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
    setOwnedItems(current => reconcileOwnedItems(current, weapon, updatedBuild));
    setBuildResult(stats);
    setActiveReplacePartId(null);
  };

  const handleOpenReplaceDrawer = (part, trigger) => {
    setReplacementError(null);
    if (activeReplacePartId === part.item.id) {
      setActiveReplacePartId(null);
    } else {
      replacementTriggerRef.current = trigger;
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
      traderLevels: activeTraderLevels,
      strictTraderLevels,
      ownedItems: reconciledOwnedItems,
      maxWeight,
      maxPrice,
      requiredItemIds,
      suppressorMode,
      sightMode,
      t,
    });
    if (attachmentError) errors.unshift(attachmentError);
    if (errors.length > 0) return errors;

    setReplacementError(null);
    setOwnedItems(current => reconcileOwnedItems(current, weapon, nextBuildParts));
    setBuildResult(current => current ? {
      ...current,
      ...recalculatedResult,
      error: null,
    } : current);
    return [];
  }, [
    activeTraderLevels,
    buildResult,
    includeTraderPrices,
    strictTraderLevels,
    maxPrice,
    maxWeight,
    priceMode,
    reconciledOwnedItems,
    requiredItemIds,
    sightMode,
    suppressorMode,
    weapon,
    t,
  ]);

  const handleScopeSelection = (itemId) => {
    const nextItemId = itemId === SCOPE_NONE_OPTION_ID || itemId === null ? null : itemId;
    setRequiredModuleIds(current => replacePrimaryManualModuleId(current, scopeItemId, nextItemId));

    if (itemId === SCOPE_NONE_OPTION_ID) {
      setScopeMode(SCOPE_MODES.NONE);
      setScopeItemId(null);
      setScopeZoom(null);
    } else if (itemId === null) {
      setScopeMode(SCOPE_MODES.AUTO);
      setScopeItemId(null);
    } else {
      setScopeMode(SCOPE_MODES.MANUAL);
      setScopeItemId(itemId);
    }
  };

  const handleFlashlightSelection = (itemId) => {
    setRequiredModuleIds(current => replacePrimaryManualModuleId(current, flashlightItemId, itemId));
    setFlashlightItemId(itemId);
    if (rememberTacticalDeviceSelection && itemId) saveLastSelectedFlashlightId(itemId);
  };

  const handleTblSelection = (itemId) => {
    setRequiredModuleIds(current => replacePrimaryManualModuleId(current, tblItemId, itemId));
    setTblItemId(itemId);
    if (rememberTacticalDeviceSelection && itemId) saveLastSelectedTblId(itemId);
  };

  const handleIncludeFlashlightChange = (checked) => {
    setIncludeFlashlight(checked);
    if (!checked) {
      handleFlashlightSelection(null);
      if (rememberTacticalDeviceSelection) saveLastSelectedFlashlightId(null);
    }
  };

  const handleIncludeLaserChange = (checked) => {
    setIncludeLaser(checked);
    if (!checked) {
      handleTblSelection(null);
      if (rememberTacticalDeviceSelection) saveLastSelectedTblId(null);
    }
  };

  const handleAddRequiredModule = (item) => {
    const moduleType = getPrimaryManualModuleType(item);

    if (moduleType === PRIMARY_MANUAL_MODULE_TYPES.SCOPE) {
      handleScopeSelection(item.id);
    } else if (moduleType === PRIMARY_MANUAL_MODULE_TYPES.FLASHLIGHT) {
      setIncludeFlashlight(true);
      handleFlashlightSelection(item.id);
    } else if (moduleType === PRIMARY_MANUAL_MODULE_TYPES.TBL) {
      setIncludeLaser(true);
      handleTblSelection(item.id);
    } else {
      setRequiredModuleIds(current => getUniqueItemIds([...current, item.id]));
    }
    setRequiredModuleSearch('');
  };

  const handleRemoveRequiredModule = (itemId) => {
    setRequiredModuleIds(prev => prev.filter(id => id !== itemId));
    if (scopeMode === SCOPE_MODES.MANUAL && scopeItemId === itemId) {
      setScopeMode(SCOPE_MODES.AUTO);
      setScopeItemId(null);
    }
    if (flashlightItemId === itemId) setFlashlightItemId(null);
    if (tblItemId === itemId) setTblItemId(null);
  };

  const handleIncludeTraderPricesChange = (nextValue) => {
    setIncludeTraderPrices(nextValue);

    if (!weapon || !buildResult || !Array.isArray(buildResult.build)) return;

    const recalculated = recalculateBuildStats(weapon, buildResult.build, {
      priceMode,
      includeTraderPrices: nextValue,
      traderLevels: activeTraderLevels,
      strictTraderLevels,
    });
    const budgetLimit = Number(maxPrice) || 0;
    const remainingTotal = calculateBuildCostSummary({
      weapon,
      buildParts: buildResult.build,
      ownedItems,
      assemblySnapshot: currentBuildSnapshot,
      priceOptions: {
        priceMode,
        includeTraderPrices: nextValue,
        traderLevels: activeTraderLevels,
        strictTraderLevels,
      },
    }).remainingTotal;

    setBuildResult(current => current ? {
      ...current,
      stats: recalculated.stats,
    } : current);
    setPricePolicyWarning(
      budgetLimit > 0 && !isPositivePrice(remainingTotal)
        ? t('config.currentPriceUnavailable')
        : budgetLimit > 0 && remainingTotal > budgetLimit
          ? t('config.currentBudgetExceeded', { price: budgetLimit })
          : null,
    );
  };

  const handleGenerate = useCallback(async () => {
    if (!allMods) return;
    const canonicalPriorityWeights = normalizePriorityWeights(priorityWeights);
    const isWeightedPrioritySelection = characteristicMode === 'priorities'
      && prioritySelectionMode === PRIORITY_SELECTION_MODES.WEIGHTED;
    const priorityWeightTotal = Object.values(priorityWeights).reduce((total, value) => {
      if (value == null || String(value).trim() === '') return Number.NaN;
      const numericValue = Number(value);
      return Number.isFinite(numericValue) ? total + numericValue : Number.NaN;
    }, 0);
    const priorityWeightsAreInRange = Object.values(priorityWeights).every(value => {
      if (value == null || String(value).trim() === '') return false;
      const numericValue = Number(value);
      return Number.isFinite(numericValue) && numericValue >= 0 && numericValue <= 100;
    });
    if (isWeightedPrioritySelection && (priorityWeightTotal !== 100 || !priorityWeightsAreInRange)) return;
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
        maxPrice,
        magazineCapacity: Number(magazineCapacity) || 30,
        priceMode,
        includeTraderPrices,
        traderLevels: activeTraderLevels,
        strictTraderLevels,
        includeLaser,
        includeFlashlight,
        sightMode,
        requireSight: sightMode !== 'none',
        requiredItemIds,
      };

      const calculation = runBuildCalculation({
        weapon,
        targetType,
        customProfile: {
          ...customProfile,
          price: maxPrice,
        },
        customExactTargets: effectiveCustomExactTargets,
        characteristicMode,
        priorityAttributes,
        prioritySelectionMode,
        priorityWeights: canonicalPriorityWeights,
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
  }, [
    activeTraderLevels,
    allMods,
    characteristicMode,
    effectiveCustomExactTargets,
    customProfile,
    priorityAttributes,
    prioritySelectionMode,
    priorityWeights,
    maxPrice,
    includeFlashlight,
    includeLaser,
    includeTraderPrices,
    latestCalculationRequestIdRef,
    magazineCapacity,
    priceMode,
    requiredItemIds,
    runBuildCalculation,
    sightMode,
    strictTraderLevels,
    suppressorMode,
    t,
    targetType,
    weapon,
  ]);

  const hasCalculationError = buildResult ? Boolean(buildResult.error) : false;
  const flashlightItems = useMemo(
    () => getTacticalDeviceOptions(allMods, TACTICAL_DEVICE_TYPES.FLASHLIGHT)
      .filter(item => isTacticalDeviceReachable(weapon, allMods, item.id)),
    [allMods, weapon],
  );
  const tblItems = useMemo(
    () => getTacticalDeviceOptions(allMods, TACTICAL_DEVICE_TYPES.TBL)
      .filter(item => isTacticalDeviceReachable(weapon, allMods, item.id)),
    [allMods, weapon],
  );
  const scopeItems = useMemo(() => getScopeOptions(allMods), [allMods]);
  const scopeZoomLevels = useMemo(() => getScopeZoomOptions(scopeItems), [scopeItems]);
  const hasBuildParts = buildResult ? (Array.isArray(buildResult.build) && buildResult.build.length > 0) : false;
  const canShowBuildDetails = Boolean(buildResult && !hasCalculationError && hasBuildParts);
  const buildCostSummary = useMemo(
    () => canShowBuildDetails
      ? calculateBuildCostSummary({
        weapon,
        buildParts: buildResult.build,
        ownedItems: reconciledOwnedItems,
        assemblySnapshot: currentBuildSnapshot,
        priceOptions: {
          priceMode,
          includeTraderPrices,
          traderLevels: activeTraderLevels,
          strictTraderLevels,
        },
      })
      : null,
    [
      activeTraderLevels,
      buildResult,
      canShowBuildDetails,
      includeTraderPrices,
      reconciledOwnedItems,
      currentBuildSnapshot,
      priceMode,
      strictTraderLevels,
      weapon,
    ],
  );
  const availableCapacities = useMemo(
    () => getAvailableCapacities(weapon, allMods),
    [weapon, allMods],
  );
  const selectedRequiredModules = useMemo(
    () => requiredModuleIds.map(itemId => allMods?.[itemId]).filter(Boolean),
    [allMods, requiredModuleIds],
  );
  const requiredModuleResults = useMemo(
    () => getRequiredModuleSearchResults(allMods, requiredModuleSearch, requiredModuleIds),
    [allMods, requiredModuleSearch, requiredModuleIds],
  );
  const toModuleView = item => {
    const priceInfo = getSelectedPriceInfo(
      item,
      priceMode,
      includeTraderPrices,
      activeTraderLevels,
      strictTraderLevels,
    );
    return {
      item,
      name: formatPartName(item.shortName || item.name, item),
      meta: `${getModuleCategoryLabel(item, t)} · ${formatCurrency(
        priceInfo.value,
        priceInfo.currency,
        t('config.notAvailable'),
      )}`,
      priceInfo,
    };
  };
  const requiredModuleResultViews = requiredModuleResults.map(toModuleView);
  const selectedRequiredModuleViews = selectedRequiredModules.map(toModuleView);
  const replacementContext = useMemo(() => {
    if (!weapon || !buildResult || !hasBuildParts || !activeReplacePartId) return null;

    const assemblyTree = currentBuildSnapshot?.tree;
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
        activeTraderLevels,
        strictTraderLevels,
        sightMode,
        t,
        replaceMode,
      ),
    };
  }, [weapon, buildResult, currentBuildSnapshot, hasBuildParts, activeReplacePartId, allMods, priceMode, includeTraderPrices, activeTraderLevels, strictTraderLevels, sightMode, t, replaceMode]);

  const isLoading = loading || (weapon && weapon.id !== weaponId);

  if (isLoading) {
    return <ConfiguratorLoading label={t('config.loader')} />;
  }

  if (!weapon) {
    return (
      <ConfiguratorUnavailable
        error={loadError}
        errorTitle={t('config.loadingFailed')}
        notFoundLabel={t('config.notFound')}
      />
    );
  }

  const priceDiagnostics = canShowBuildDetails
    ? collectBuildPriceDiagnostics(
      weapon,
      buildResult,
      priceMode,
      includeTraderPrices,
      activeTraderLevels,
      strictTraderLevels,
      reconciledOwnedItems,
      t,
      currentBuildSnapshot?.instances,
    )
    : {
      summaryLabel: `${t(`config.price.${priceMode}Short`)} · tarkov.dev · ${includeTraderPrices ? t('config.price.fleaTrader') : t('config.price.fleaOnly')}`,
      summaryStatus: includeTraderPrices ? t('config.price.fleaTrader') : t('config.price.fleaOnly'),
      warningMessages: [],
      infoMessages: [],
      fallbackEntries: [],
    };

  // Рассчитываем текущие значения для панели метрик
  const currentErgo = canShowBuildDetails ? buildResult.stats.ergonomics : (weapon.properties?.ergonomics ?? t('config.notAvailable'));
  const currentWeightValue = toFiniteStatNumber(
    canShowBuildDetails ? buildResult.stats.weight : weapon.weight,
  );
  const currentWeight = canShowBuildDetails ? `${buildResult.stats.weight} kg` : (weapon.weight ? `${weapon.weight} kg` : t('config.notAvailable'));
  const currentRecoilV = canShowBuildDetails ? buildResult.stats.recoilVertical : (weapon.properties?.recoilVertical ?? t('config.notAvailable'));
  const currentRecoilH = canShowBuildDetails ? buildResult.stats.recoilHorizontal : (weapon.properties?.recoilHorizontal ?? t('config.notAvailable'));
  const currentAccuracyMoa = toFiniteStatNumber(
    canShowBuildDetails ? buildResult.stats.accuracyMoa : null,
  );
  const currentAccuracy = formatAccuracyMoa(currentAccuracyMoa, language);
  const currentPrice = canShowBuildDetails
    ? buildCostSummary?.remainingTotal === 0
      ? t('ownedItems.allPurchased')
      : formatCurrency(buildCostSummary?.remainingTotal, 'RUB', t('config.notAvailable'))
    : formatCurrency(
      getSelectedPriceInfo(
        weapon,
        priceMode,
        includeTraderPrices,
        activeTraderLevels,
        strictTraderLevels,
        true,
      ).value,
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
    ...(currentAccuracy ? [{
      key: 'accuracy-moa',
      label: t('config.stat.accuracy'),
      value: currentAccuracyMoa,
      displayValue: currentAccuracy,
      range: WEAPON_STAT_UI_RANGES.accuracyMoa,
    }] : []),
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
    getBuildModuleDisplayItems(weapon, buildResult.build, currentBuildSnapshot?.tree).forEach(part => {
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
  const weaponInstance = buildCostSummary?.instances.find(instance => instance.isWeapon) || null;
  const renderedGroups = partsGroups.map(group => {
    const filteredParts = sortModuleDisplayItems(group.parts)
      .filter(part => {
        if (!partsFilter.trim()) return true;
        const q = partsFilter.trim().toLowerCase();
        const name = (part.item?.name || '').toLowerCase();
        const shortName = (part.item?.shortName || '').toLowerCase();
        const slot = (part.slotName || '').toLowerCase();
        const parentName = (part.parentItem?.name || part.parentItem?.shortName || '').toLowerCase();
        const groupName = group.rootSlotName.toLowerCase();
        const itemId = (part.item?.id || '').toLowerCase();
        return name.includes(q)
          || shortName.includes(q)
          || itemId.includes(q)
          || slot.includes(q)
          || parentName.includes(q)
          || groupName.includes(q);
      })
      .map(part => ({
        ...part,
        isOwned: reconciledOwnedItems.some(item => item.key === part.ownershipKey),
        priceInfo: part.item
          ? getSelectedPriceInfo(
            part.item,
            priceMode,
            includeTraderPrices,
            activeTraderLevels,
            strictTraderLevels,
          )
          : null,
      }));
    return {
      ...group,
      parts: filteredParts
    };
  }).filter(group => group.parts.length > 0);
  const baseWeaponGroup = weaponInstance && (
    !partsFilter.trim()
    || [
      weapon.name,
      weapon.shortName,
      weapon.id,
      t('ownedItems.baseWeapon'),
    ].some(value => value?.toLowerCase().includes(partsFilter.trim().toLowerCase()))
  )
    ? {
      displayRank: -1,
      rootSlotName: t('ownedItems.baseWeapon'),
      parts: [{
        key: weaponInstance.key,
        ownershipKey: weaponInstance.key,
        item: weapon,
        isWeapon: true,
        isOwned: reconciledOwnedItems.some(item => item.key === weaponInstance.key),
        priceInfo: getSelectedPriceInfo(
          weapon,
          priceMode,
          includeTraderPrices,
          activeTraderLevels,
          strictTraderLevels,
          true,
        ),
      }],
    }
    : null;
  const displayGroups = baseWeaponGroup
    ? [baseWeaponGroup, ...renderedGroups]
    : renderedGroups;
  const handleOwnedToggle = instance => {
    setOwnedItems(current => toggleOwnedItem(
      reconcileOwnedItems(
        current,
        weapon,
        buildResult?.build || [],
        currentBuildSnapshot?.instances,
      ),
      instance,
    ));
  };
  const handlePriorityWeightChange = (attribute, value) => {
    setPriorityWeights(current => rebalancePriorityWeights(current, attribute, value));
  };

  return (
    <div className="layout">
      {/* Левый сайдбар с конфигурацией сборки */}
      <BuildSettings
        availableCapacities={availableCapacities}
        buildGoalMode={buildGoalMode}
        customExactTargets={effectiveCustomExactTargets}
        customProfile={customProfile}
        priorityAttributes={priorityAttributes}
        prioritySelectionMode={prioritySelectionMode}
        priorityWeights={priorityWeights}
        generating={generating}
        includeFlashlight={includeFlashlight}
        includeLaser={includeLaser}
        flashlightItems={flashlightItems}
        flashlightItemId={flashlightItemId}
        includeTraderPrices={includeTraderPrices}
        strictTraderLevels={strictTraderLevels}
        magazineCapacity={magazineCapacity}
        maxPrice={maxPrice}
        maxPriceDraft={maxPriceDraft}
        maxPriceLimit={WEAPON_STAT_UI_RANGES.price.max}
        maxWeight={maxWeight}
        maxWeightLimit={WEAPON_STAT_UI_RANGES.weight.max}
        moduleResults={requiredModuleResultViews}
        onAddModule={handleAddRequiredModule}
        onBuildGoalModeChange={setBuildGoalMode}
        onExactChange={(axisKey, enabled) => setCustomExactTargets(current => ({ ...current, [axisKey]: enabled }))}
        onPriorityAttributeToggle={attribute => setPriorityAttributes(current => (
          togglePriorityAttribute(current, attribute)
        ))}
        onPriorityAttributeMove={(fromIndex, toIndex) => setPriorityAttributes(current => (
          movePriorityAttribute(current, fromIndex, toIndex)
        ))}
        onPrioritySelectionModeChange={mode => setPrioritySelectionMode(normalizePrioritySelectionMode(mode))}
        onPriorityWeightChange={handlePriorityWeightChange}
        onGenerate={handleGenerate}
        onIncludeTraderPricesChange={handleIncludeTraderPricesChange}
        onMaxPriceBlur={value => {
          setMaxPrice(normalizeBuildMaxPrice(value));
          setMaxPriceDraft(null);
        }}
        onMaxPriceChange={value => {
          setMaxPriceDraft(value);
          setMaxPrice(normalizeBuildMaxPrice(value));
        }}
        onMaxPriceFocus={setMaxPriceDraft}
        onMaxWeightChange={value => setCustomProfile(current => normalizeCustomBuildProfile({ ...current, weight: value === '' ? 0 : Number(value) }, weapon))}
        onRemoveModule={handleRemoveRequiredModule}
        onRequiredModuleSearchChange={setRequiredModuleSearch}
        requiredModuleSearch={requiredModuleSearch}
        selectedModules={selectedRequiredModuleViews}
        setters={{
          customProfile: setCustomProfile,
          includeFlashlight: handleIncludeFlashlightChange,
          includeLaser: handleIncludeLaserChange,
          flashlightItemId: handleFlashlightSelection,
          tblItemId: handleTblSelection,
          scopeSelection: handleScopeSelection,
          scopeZoom: setScopeZoom,
          magazineCapacity: setMagazineCapacity,
          suppressorMode: setSuppressorMode,
        }}
        sightMode={sightMode}
        scopeItems={scopeItems}
        scopeMode={scopeMode}
        scopeItemId={scopeItemId}
        scopeZoom={scopeZoom}
        scopeZoomLevels={scopeZoomLevels}
        suppressorMode={suppressorMode}
        suppressorOptions={SUPPRESSOR_MODE_OPTIONS}
        tblItems={tblItems}
          tblItemId={tblItemId}
        t={t}
        weapon={weapon}
      />

      {/* Правая основная область */}
      <main>
        {/* Сетка: Карточка оружия и Сводка деталей */}
        <div className="main-grid">
          {/* Левая панель - Оружие */}
          <WeaponSummary
            activeSavedBuildId={activeSavedBuildId}
            canSave={canShowBuildDetails}
            currentPrice={currentPrice}
            marketPrice={buildCostSummary?.marketTotal}
            onOpenDiagram={() => setIsBuildDiagramOpen(true)}
            onSave={handleSaveBuild}
            onSaveNameChange={value => {
              setSaveName(value);
              setSaveFeedback(null);
            }}
            priceMode={priceMode}
            requiredModuleCount={selectedRequiredModules.length}
            saveFeedback={saveFeedback}
            saveName={saveName}
            statMeters={statMeters}
            summaryStatus={priceDiagnostics.summaryStatus}
            t={t}
            weapon={weapon}
          />

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
              {canShowBuildDetails && (
                <>
                  <button
                    className="btn btn--ghost"
                    type="button"
                    onClick={() => setOwnedItems(
                      buildCostSummary.instances.map(instance => ({
                        key: instance.key,
                        itemId: instance.itemId,
                      })),
                    )}
                  >
                    {t('ownedItems.markAll')}
                  </button>
                  <button
                    className="btn btn--ghost"
                    type="button"
                    onClick={() => setOwnedItems([])}
                  >
                    {t('ownedItems.clearAll')}
                  </button>
                </>
              )}
            </div>

            {/* Вывод ошибок при расчете сборки */}
            <BuildWarnings
              generationError={generationError}
              pricePolicyWarning={pricePolicyWarning}
              replacementError={replacementError}
              calculationError={buildResult && hasCalculationError
                ? getBuildResultErrorMessage(buildResult, language, t)
                : null}
              buildWarnings={buildResult
                && !hasCalculationError
                && (buildResult.warning || buildResult.warningCode || buildResult.warnings)
                ? getLocalizedBuildWarnings(buildResult, t)
                : []}
              priceWarnings={canShowBuildDetails ? priceDiagnostics.warningMessages : []}
              priceInfos={canShowBuildDetails ? priceDiagnostics.infoMessages : []}
              hasFallbackPrice={priceDiagnostics.fallbackEntries?.length > 0}
              priceModeNotice={priceModeNotice}
              t={t}
            />

            {/* Рендеринг сгруппированных деталей */}
            <BuildParts
              activeReplacePartId={activeReplacePartId}
              buildExists={Boolean(buildResult)}
              canShowBuildDetails={canShowBuildDetails}
              generating={generating}
              groups={displayGroups}
              onOpenReplacement={handleOpenReplaceDrawer}
              onToggleOwned={part => handleOwnedToggle({
                key: part.ownershipKey,
                itemId: part.item.id,
              })}
              formatPartName={formatPartName}
              t={t}
            />
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
          traderLevels={activeTraderLevels}
          strictTraderLevels={strictTraderLevels}
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
          activeTraderLevels,
          strictTraderLevels,
        );

        return (
          <ModalDialog
            backdropClassName="drawer is-open"
            className="drawer__panel"
            aria-labelledby="replacementDialogTitle"
            onClose={() => setActiveReplacePartId(null)}
            returnFocusRef={replacementTriggerRef}
          >
              <div className="drawer__head">
                <h2 id="replacementDialogTitle">{t('config.replacePart')}</h2>
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
                  <AsyncImage
                    src={activePart.item.image512pxLink || activePart.item.iconLink || 'https://via.placeholder.com/70'}
                    alt={activePart.item.shortName}
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    containerStyle={{ width: '70px', height: '70px', minWidth: 0, minHeight: 0, padding: '6px', background: '#101310', border: '1px solid rgba(204, 194, 158, 0.1)', borderRadius: '6px', boxSizing: 'border-box' }}
                  />
                  <div>
                    <div className="generated-meta">{getReadableSlotGroupName(activePart.slotName, t)} · {t('config.slot', { slot: activePart.slotName })}</div>
                    <h3 style={{ margin: '8px 0 6px', fontSize: '1.1rem' }}>{formatPartName(activePart.item.shortName, activePart.item)}</h3>
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
                          activeTraderLevels,
                          strictTraderLevels,
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
                          activeTraderLevels,
                          strictTraderLevels,
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
                          <button
                            key={getAlternativeListKey(alt)}
                            type="button"
                            aria-label={`${t('config.replace')}: ${getAlternativeDisplayName(alt)}`}
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
                              boxSizing: 'border-box',
                              width: '100%',
                              font: 'inherit',
                              color: 'inherit',
                              textAlign: 'left'
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
                            <AsyncImage
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
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
          </ModalDialog>
        );
      })()}
    </div>
  );
}

export default Configurator;
