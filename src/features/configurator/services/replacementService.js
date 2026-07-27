import { getPurchasePriceValue } from '../../../data/price/priceMapper.js';
import { hasItemCategory } from '../../../domain/itemCategories.js';

const MISSING_PRICE_COMPARISON_VALUE = 1_000_000_000_000;

export function findTreeNodeByItemId(root, itemId) {
  if (!root) return null;
  if (root.item.id === itemId) return root;

  for (const child of root.children) {
    const match = findTreeNodeByItemId(child, itemId);
    if (match) return match;
  }

  return null;
}

export function getAlternativeAttachedParts(item) {
  if (Array.isArray(item.attachedParts)) {
    return item.attachedParts.map(part => part.item);
  }
  return item.attachedScope ? [item.attachedScope] : [];
}

export function getAlternativePackageItems(item) {
  return [item, ...getAlternativeAttachedParts(item)];
}

export function getAlternativeSight(item) {
  if (item.attachedScope) return item.attachedScope;
  return isSightItem(item) ? item : null;
}

export function getAlternativeListKey(item) {
  if (Array.isArray(item.attachedParts) && item.attachedParts.length > 0) {
    return [item.id, ...item.attachedParts.map(part => part.item.id)].join('-');
  }
  return item.attachedScope ? `${item.id}-${item.attachedScope.id}` : item.id;
}

export function formatPartName(name) {
  if (!name) return '';
  return name.replace(/(\d+(?:\.\d+)?)\s*(?:"|inch(?:es)?)/ig, (match, value) => (
    `${Math.round(parseFloat(value) * 25.4)} mm`
  ));
}

export function getAlternativeDisplayName(item) {
  if (Array.isArray(item.attachedParts) && item.attachedParts.length > 0) {
    return [item, ...item.attachedParts.map(part => part.item)]
      .map(part => formatPartName(part.shortName))
      .join(' + ');
  }
  return item.attachedScope
    ? `${formatPartName(item.shortName)} + ${formatPartName(item.attachedScope.shortName)}`
    : formatPartName(item.shortName);
}

function getItemsMetrics(items, priceMode, includeTraderPrices, traderLevels) {
  return items.reduce((metrics, item) => ({
    ergonomics: metrics.ergonomics + (item.ergonomicsModifier || 0),
    recoil: metrics.recoil + (item.recoilModifier || 0),
    weight: metrics.weight + (item.weight || 0),
    price: metrics.price + getPurchasePriceValue(item, {
      priceMode,
      includeTraderPrices,
      traderLevels,
    }, MISSING_PRICE_COMPARISON_VALUE),
  }), {
    ergonomics: 0,
    recoil: 0,
    weight: 0,
    price: 0,
  });
}

function getNodeMetrics(node, priceMode, includeTraderPrices, traderLevels) {
  const items = [];
  function collect(currentNode) {
    if (!currentNode?.item) return;
    items.push(currentNode.item);
    currentNode.children.forEach(collect);
  }
  collect(node);
  return getItemsMetrics(items, priceMode, includeTraderPrices, traderLevels);
}

function getSimilarityDistance(
  referenceMetrics,
  item,
  priceMode,
  includeTraderPrices,
  traderLevels,
) {
  const candidateMetrics = getItemsMetrics(
    getAlternativePackageItems(item),
    priceMode,
    includeTraderPrices,
    traderLevels,
  );
  return (Math.abs(referenceMetrics.ergonomics - candidateMetrics.ergonomics) * 1.5)
    + (Math.abs(referenceMetrics.recoil - candidateMetrics.recoil) * 4)
    + (Math.abs(referenceMetrics.weight - candidateMetrics.weight) * 2)
    + (Math.abs(referenceMetrics.price - candidateMetrics.price) * 0.0001);
}

export function isValidSightForMode(item, sightMode) {
  if (hasItemCategory(item, 'Ironsight')) return false;
  if (
    hasItemCategory(item, 'Thermal Vision')
    || hasItemCategory(item, 'Night Vision')
    || hasItemCategory(item, 'Special scope')
  ) {
    return false;
  }

  const mode = sightMode || 'any';
  if (mode === 'none') return false;
  if (mode === 'any') return true;

  const isReflex = hasItemCategory(item, 'Reflex sight')
    || hasItemCategory(item, 'Compact reflex sight');
  const isMagnified = hasItemCategory(item, 'Scope')
    || hasItemCategory(item, 'Assault scope');

  if (mode === 'reflex') return isReflex;
  if (mode === 'scope') return isMagnified;

  const parsedMode = Number(mode);
  if (!Number.isNaN(parsedMode)) {
    const zoomLevels = item.properties?.zoomLevels;
    if (zoomLevels) return zoomLevels.flat().includes(parsedMode);
    return parsedMode === 1 ? isReflex : false;
  }
  return true;
}

export function scoreScope(item, priceMode, includeTraderPrices, traderLevels) {
  const ergonomics = item.ergonomicsModifier || 0;
  const recoil = item.recoilModifier || 0;
  const weight = item.weight || 0;
  const price = getPurchasePriceValue(item, {
    priceMode,
    includeTraderPrices,
    traderLevels,
  }, MISSING_PRICE_COMPARISON_VALUE);
  return ergonomics - recoil * 5 - weight * 10 - (price > 0 ? price * 0.0001 : 0);
}

export function isSightItem(item) {
  return hasItemCategory(item, 'Sights');
}

export function isMountItem(item) {
  return hasItemCategory(item, 'Mount');
}

export function subtreeHasSight(node) {
  if (!node) return false;
  if (isSightItem(node.item)) return true;
  return (node.children || []).some(subtreeHasSight);
}

function findSightNode(node) {
  if (!node) return null;
  if (isSightItem(node.item)) return node;
  for (const child of node.children) {
    const result = findSightNode(child);
    if (result) return result;
  }
  return null;
}

export function getReplaceTarget(node, mode) {
  if (!node || mode === 'EXACT_ITEM') return node;
  if (mode === 'SIGHT_ITEM') return findSightNode(node) || node;

  if (mode === 'SIGHT_MOUNT') {
    let current = node;
    while (current) {
      if (isMountItem(current.item)) return current;
      current = current.parent;
    }
    return node;
  }

  if (mode === 'SIGHT_ASSEMBLY') {
    let current = node;
    let assemblyRoot = node;
    while (current.parent?.item) {
      if (!isMountItem(current.parent.item) && !isSightItem(current.parent.item)) break;
      assemblyRoot = current.parent;
      current = current.parent;
    }
    return assemblyRoot;
  }
  return node;
}

export function selectReplacementCandidates({
  alternatives,
  targetNode,
  priceMode,
  includeTraderPrices,
  traderLevels,
}) {
  const uniqueAlternatives = new Map();
  const referenceMetricsByNode = new Map();
  const distanceByAlternative = new Map();

  const getDistance = alternative => {
    if (distanceByAlternative.has(alternative)) {
      return distanceByAlternative.get(alternative);
    }

    const distanceNode = alternative.replacementMode === 'SIGHT_ASSEMBLY'
      ? getReplaceTarget(targetNode, 'SIGHT_ASSEMBLY')
      : targetNode;
    let referenceMetrics = referenceMetricsByNode.get(distanceNode);
    if (!referenceMetrics) {
      referenceMetrics = getNodeMetrics(
        distanceNode,
        priceMode,
        includeTraderPrices,
        traderLevels,
      );
      referenceMetricsByNode.set(distanceNode, referenceMetrics);
    }

    const distance = getSimilarityDistance(
      referenceMetrics,
      alternative,
      priceMode,
      includeTraderPrices,
      traderLevels,
    );
    distanceByAlternative.set(alternative, distance);
    return distance;
  };

  alternatives.forEach(alternative => {
    const isSightOrHasAttached = isSightItem(alternative) || alternative.attachedScope;
    const key = isSightOrHasAttached
      ? (alternative.attachedScope?.id || alternative.id)
      : alternative.id;
    const existing = uniqueAlternatives.get(key);
    if (!existing || getDistance(alternative) < getDistance(existing)) {
      uniqueAlternatives.set(key, alternative);
    }
  });

  return Array.from(uniqueAlternatives.values())
    .sort((left, right) => getDistance(left) - getDistance(right));
}

function collectNodeIds(node, target) {
  target.add(node.item.id);
  node.children.forEach(child => collectNodeIds(child, target));
}

function collectIncompatibleChildren(node, parentItem, target) {
  node.children.forEach(child => {
    const slots = parentItem.properties?.slots || [];
    const matchingSlot = child.sourceSlot
      || slots.find(slot => slot.name === child.slotName);
    const allowedIds = new Set(
      (matchingSlot?.filters?.allowedItems || []).map(item => item.id),
    );

    if (allowedIds.has(child.item.id)) {
      collectIncompatibleChildren(child, child.item, target);
    } else {
      collectNodeIds(child, target);
    }
  });
}

export function applyReplacement(buildParts, targetNode, alternativeItem, mode = 'EXACT_ITEM') {
  const actualTargetNode = getReplaceTarget(targetNode, mode);
  if (!actualTargetNode) return buildParts;

  const removedItemIds = new Set();
  if (mode === 'SIGHT_ASSEMBLY') {
    collectNodeIds(actualTargetNode, removedItemIds);
  } else {
    collectIncompatibleChildren(actualTargetNode, alternativeItem, removedItemIds);
    removedItemIds.add(actualTargetNode.item.id);
  }

  const updatedBuild = [];
  buildParts.forEach(part => {
    if (part.item.id === actualTargetNode.item.id) {
      updatedBuild.push({ ...part, item: alternativeItem });
    } else if (!removedItemIds.has(part.item.id)) {
      updatedBuild.push(part);
    }
  });

  if (Array.isArray(alternativeItem.attachedParts) && alternativeItem.attachedParts.length > 0) {
    alternativeItem.attachedParts.forEach(attachedPart => {
      updatedBuild.push({
        slotName: attachedPart.slotName,
        item: attachedPart.item,
      });
    });
  } else if (alternativeItem.attachedScope && alternativeItem.attachedScopeSlotName) {
    updatedBuild.push({
      slotName: alternativeItem.attachedScopeSlotName,
      item: alternativeItem.attachedScope,
    });
  }

  return updatedBuild;
}
