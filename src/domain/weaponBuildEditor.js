import { getPurchasePriceValue } from '../data/price/priceMapper.js';
import {
  buildWeaponAssemblyTree,
  getBuildItemInstanceId,
  getBuildSlotId,
  getBuildSlotInstanceId,
} from './weaponAssembly.js';

function getAllowedItemIds(slot) {
  return new Set((slot?.filters?.allowedItems || []).map(item => item.id).filter(Boolean));
}

function itemsConflict(first, second) {
  if (!first?.id || !second?.id) return false;
  return (first.conflictingItems || []).some(item => item.id === second.id)
    || (second.conflictingItems || []).some(item => item.id === first.id);
}

function collectSubtreeNodes(node, result = []) {
  if (!node || result.includes(node)) return result;
  result.push(node);
  (node.children || []).forEach(child => collectSubtreeNodes(child, result));
  return result;
}

export function findBuildSlotContext(weapon, buildParts, slotInstanceId) {
  const root = buildWeaponAssemblyTree(weapon, buildParts);
  const queue = [root];
  const visited = new Set();

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const node = queue[cursor];
    if (!node || visited.has(node)) continue;
    visited.add(node);

    const match = (node.slots || []).find(slotContext => slotContext.id === slotInstanceId);
    if (match) return { root, slotContext: match };
    queue.push(...(node.children || []));
  }

  return { root, slotContext: null };
}

function getRemainingItems(weapon, buildParts, installedNode) {
  const excludedParts = new Set(
    collectSubtreeNodes(installedNode).map(node => node.buildPart).filter(Boolean),
  );
  return [
    weapon,
    ...buildParts.filter(part => !excludedParts.has(part)).map(part => part.item),
  ].filter(Boolean);
}

export function getCompatibleItemsForSlot({
  weapon,
  buildParts = [],
  allMods,
  slotInstanceId,
  slotContext: providedSlotContext,
  priceMode,
  includeTraderPrices,
}) {
  const slotContext = providedSlotContext
    || findBuildSlotContext(weapon, buildParts, slotInstanceId).slotContext;
  if (!slotContext || !allMods) return [];

  const allowedIds = getAllowedItemIds(slotContext.slot);
  const currentItem = slotContext.installedNode?.item || null;
  const remainingItems = getRemainingItems(weapon, buildParts, slotContext.installedNode);
  const remainingIds = new Set(remainingItems.map(item => item.id));
  const candidates = [];

  allowedIds.forEach(itemId => {
    const item = allMods[itemId] || (currentItem?.id === itemId ? currentItem : null);
    if (!item) return;
    if (remainingIds.has(item.id)) return;
    if (remainingItems.some(installedItem => itemsConflict(item, installedItem))) return;
    candidates.push(item);
  });

  candidates.sort((first, second) => {
    if (first.id === currentItem?.id) return -1;
    if (second.id === currentItem?.id) return 1;
    const firstPrice = getPurchasePriceValue(
      first,
      { priceMode, includeTraderPrices },
      Number.POSITIVE_INFINITY,
    );
    const secondPrice = getPurchasePriceValue(
      second,
      { priceMode, includeTraderPrices },
      Number.POSITIVE_INFINITY,
    );
    return firstPrice - secondPrice
      || String(first.name || first.shortName).localeCompare(String(second.name || second.shortName), 'ru');
  });

  return candidates;
}

function createContextualBuildPart(item, slotContext, parentInstanceId = slotContext.parent.instanceId) {
  return {
    slotName: slotContext.slot.name,
    slotId: slotContext.slotId,
    slotIndex: slotContext.slotIndex,
    slotInstanceId: getBuildSlotInstanceId(parentInstanceId, slotContext.slot, slotContext.slotIndex),
    parentItemId: slotContext.parent.item.id,
    parentInstanceId,
    item,
  };
}

function findCompatibleChildSlot(parentItem, oldChild, usedSlotIds) {
  const slots = parentItem?.properties?.slots || [];
  const candidates = slots
    .map((slot, slotIndex) => ({
      id: getBuildSlotId(slot, slotIndex),
      slot,
      slotIndex,
    }))
    .filter(candidate => (
      !usedSlotIds.has(candidate.id)
      && getAllowedItemIds(candidate.slot).has(oldChild.item.id)
    ));

  return candidates.find(candidate => candidate.id === oldChild.sourceSlotId)
    || candidates.find(candidate => (
      candidate.slot.nameId
      && candidate.slot.nameId === oldChild.sourceSlot?.nameId
    ))
    || candidates.find(candidate => candidate.slot.name === oldChild.slotName)
    || candidates[0]
    || null;
}

function contextualizePreservedChildren(oldNode, newParentItem, newParentInstanceId) {
  const buildParts = [];
  const preservedOriginalParts = new Set();
  const usedSlotIds = new Set();

  (oldNode?.children || []).forEach(oldChild => {
    const childSlot = findCompatibleChildSlot(newParentItem, oldChild, usedSlotIds);
    const childBranchItems = collectSubtreeNodes(oldChild).map(node => node.item);
    if (!childSlot || childBranchItems.some(item => itemsConflict(newParentItem, item))) return;

    usedSlotIds.add(childSlot.id);
    const slotContext = {
      slot: childSlot.slot,
      slotId: childSlot.id,
      slotIndex: childSlot.slotIndex,
      parent: { item: newParentItem, instanceId: newParentInstanceId },
    };
    const childPart = createContextualBuildPart(oldChild.item, slotContext, newParentInstanceId);
    buildParts.push(childPart);
    preservedOriginalParts.add(oldChild.buildPart);

    const childInstanceId = getBuildItemInstanceId(childPart.slotInstanceId, oldChild.item);
    const nested = contextualizePreservedChildren(oldChild, oldChild.item, childInstanceId);
    buildParts.push(...nested.buildParts);
    nested.preservedOriginalParts.forEach(part => preservedOriginalParts.add(part));
  });

  return { buildParts, preservedOriginalParts };
}

export function validateEditedBuild(weapon, buildParts) {
  const errors = [];
  const items = [weapon, ...buildParts.map(part => part.item)].filter(Boolean);
  const seenIds = new Set();

  items.forEach(item => {
    if (!item.id || seenIds.has(item.id)) {
      errors.push('This module is already installed in the build.');
      return;
    }
    seenIds.add(item.id);
  });

  for (let firstIndex = 0; firstIndex < items.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < items.length; secondIndex += 1) {
      if (itemsConflict(items[firstIndex], items[secondIndex])) {
        errors.push(`${items[firstIndex].shortName || items[firstIndex].name} conflicts with ${items[secondIndex].shortName || items[secondIndex].name}.`);
        return errors;
      }
    }
  }

  const rebuilt = buildWeaponAssemblyTree(weapon, buildParts);
  if (rebuilt.unattachedParts.length > 0) {
    errors.push('After this change, one or more modules will lose their compatible parent slot.');
  }
  return errors;
}

export function planBuildSlotChange({
  weapon,
  buildParts = [],
  allMods,
  slotInstanceId,
  nextItem,
  priceMode,
  includeTraderPrices,
}) {
  const { slotContext } = findBuildSlotContext(weapon, buildParts, slotInstanceId);
  if (!slotContext) {
    return { errors: ['The selected slot no longer exists in the current build.'] };
  }
  if (!nextItem && slotContext.slot.required === true) {
    return { errors: ['A required module cannot be removed without a replacement.'] };
  }

  const currentNode = slotContext.installedNode;
  if (nextItem?.id === currentNode?.item?.id) {
    return { buildParts, removedItems: [], errors: [], changed: false };
  }

  if (nextItem) {
    const compatibleIds = new Set(getCompatibleItemsForSlot({
      weapon,
      buildParts,
      allMods,
      slotContext,
      priceMode,
      includeTraderPrices,
    }).map(item => item.id));
    if (!compatibleIds.has(nextItem.id)) {
      return { errors: ['The selected module is incompatible with this slot instance.'] };
    }
  }

  const oldSubtreeNodes = collectSubtreeNodes(currentNode);
  const oldSubtreeParts = new Set(oldSubtreeNodes.map(node => node.buildPart).filter(Boolean));
  const firstRemovedIndex = buildParts.findIndex(part => oldSubtreeParts.has(part));
  const unchangedParts = buildParts.filter(part => !oldSubtreeParts.has(part));
  const insertedParts = [];
  let preservedOriginalParts = new Set();

  if (nextItem) {
    const replacementPart = createContextualBuildPart(nextItem, slotContext);
    insertedParts.push(replacementPart);
    if (currentNode) {
      const replacementInstanceId = getBuildItemInstanceId(replacementPart.slotInstanceId, nextItem);
      const preserved = contextualizePreservedChildren(currentNode, nextItem, replacementInstanceId);
      insertedParts.push(...preserved.buildParts);
      preservedOriginalParts = preserved.preservedOriginalParts;
    }
  }

  const insertionIndex = firstRemovedIndex < 0 ? unchangedParts.length : firstRemovedIndex;
  const updatedBuild = [
    ...unchangedParts.slice(0, insertionIndex),
    ...insertedParts,
    ...unchangedParts.slice(insertionIndex),
  ];
  const errors = validateEditedBuild(weapon, updatedBuild);
  const removedItems = oldSubtreeNodes
    .filter(node => node !== currentNode && !preservedOriginalParts.has(node.buildPart))
    .map(node => node.item);

  return {
    buildParts: updatedBuild,
    removedItems,
    errors,
    changed: errors.length === 0,
    slotInstanceId,
    nextItem: nextItem || null,
  };
}
