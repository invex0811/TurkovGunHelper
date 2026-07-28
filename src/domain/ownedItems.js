import {
  selectPurchasePrice,
  selectWeaponPurchasePrice,
} from '../data/price/priceMapper.js';
import { buildWeaponAssemblyTree } from './weaponAssembly.js';

function normalizeOwnedItem(value) {
  if (typeof value === 'string' && value) return { key: value, itemId: null };
  if (!value || typeof value !== 'object' || typeof value.key !== 'string' || !value.key) {
    return null;
  }
  return {
    key: value.key,
    itemId: typeof value.itemId === 'string' && value.itemId ? value.itemId : null,
  };
}

export function createBuildItemKey(instanceId, itemId) {
  if (typeof instanceId === 'string' && instanceId) return instanceId;
  return `item:${encodeURIComponent(String(itemId || 'unknown')).replaceAll('%', '_')}`;
}

export function getBuildItemInstances(weapon, buildParts = []) {
  if (!weapon) return [];
  const root = buildWeaponAssemblyTree(weapon, buildParts);
  const instances = [{
    key: createBuildItemKey(root.instanceId, weapon.id),
    itemId: weapon.id,
    item: weapon,
    buildPart: null,
    isWeapon: true,
  }];
  const queue = [...root.children];
  for (let index = 0; index < queue.length; index += 1) {
    const node = queue[index];
    instances.push({
      key: createBuildItemKey(node.instanceId, node.item.id),
      itemId: node.item.id,
      item: node.item,
      buildPart: node.buildPart,
      isWeapon: false,
    });
    queue.push(...node.children);
  }
  return instances;
}

export function reconcileOwnedItems(ownedItems, weapon, buildParts = []) {
  const instanceByKey = new Map(
    getBuildItemInstances(weapon, buildParts).map(instance => [instance.key, instance]),
  );
  const reconciled = [];
  const seen = new Set();
  (ownedItems || []).forEach(value => {
    const normalized = normalizeOwnedItem(value);
    if (!normalized || seen.has(normalized.key)) return;
    const instance = instanceByKey.get(normalized.key);
    if (!instance || (normalized.itemId && normalized.itemId !== instance.itemId)) return;
    seen.add(normalized.key);
    reconciled.push({ key: instance.key, itemId: instance.itemId });
  });
  return reconciled;
}

export function toggleOwnedItem(ownedItems, instance) {
  if (!instance?.key || !instance?.itemId) return [...(ownedItems || [])];
  const normalized = (ownedItems || []).map(normalizeOwnedItem).filter(Boolean);
  if (normalized.some(item => item.key === instance.key)) {
    return normalized.filter(item => item.key !== instance.key);
  }
  return [...normalized, { key: instance.key, itemId: instance.itemId }];
}

export function calculateBuildCostSummary({
  weapon,
  buildParts = [],
  ownedItems = [],
  priceOptions = {},
}) {
  const instances = getBuildItemInstances(weapon, buildParts);
  const reconciledOwnedItems = reconcileOwnedItems(ownedItems, weapon, buildParts);
  const ownedKeys = new Set(reconciledOwnedItems.map(item => item.key));
  let marketTotal = 0;
  let remainingTotal = 0;
  let ownedValue = 0;
  const missingInstances = [];

  instances.forEach(instance => {
    const priceInfo = instance.isWeapon
      ? selectWeaponPurchasePrice(instance.item, priceOptions)
      : selectPurchasePrice(instance.item, priceOptions);
    const price = Number(priceInfo.value);
    if (!Number.isFinite(price) || price <= 0) {
      missingInstances.push({
        key: instance.key,
        itemId: instance.itemId,
        isOwned: ownedKeys.has(instance.key),
      });
      return;
    }
    marketTotal += price;
    if (ownedKeys.has(instance.key)) ownedValue += price;
    else remainingTotal += price;
  });

  return {
    instances,
    ownedItems: reconciledOwnedItems,
    marketTotal: missingInstances.length > 0 ? null : Math.round(marketTotal),
    remainingTotal: missingInstances.some(instance => !instance.isOwned)
      ? null
      : Math.round(remainingTotal),
    ownedValue: Math.round(ownedValue),
    missingInstances,
  };
}
