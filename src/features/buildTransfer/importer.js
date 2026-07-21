import { recalculateBuildStats } from '../../domain/calculator.js';
import {
  buildWeaponAssemblyTree,
  getBuildItemInstanceId,
  getBuildSlotId,
  getBuildSlotInstanceId,
} from '../../domain/weaponAssembly.js';
import { validateEditedBuild } from '../../domain/weaponBuildEditor.js';
import { createBuildSnapshot } from '../../data/savedBuilds.js';
import { DUPLICATE_STRATEGIES } from './constants.js';
import { getBuildFingerprint } from './fingerprint.js';
import { exportBuild } from './serializer.js';

function getStableSlotId(slot, slotIndex) {
  return slot?.nameId || slot?.id || `slot:${slotIndex}`;
}

function findSlot(parentItem, node, usedSlotIds, options = {}) {
  const slots = (parentItem?.properties?.slots || []).map((slot, slotIndex) => ({
    slot,
    slotIndex,
    slotId: getBuildSlotId(slot, slotIndex),
    stableId: getStableSlotId(slot, slotIndex),
  }));
  const stableMatches = slots.filter(candidate => (
    !usedSlotIds.has(candidate.slotId)
    && (candidate.slotId === node.slotId || candidate.stableId === node.slotId)
  ));
  if (Number.isInteger(node.slotIndex)) {
    const indexed = stableMatches.find(candidate => candidate.slotIndex === node.slotIndex);
    if (indexed) return indexed;
  }
  if (stableMatches.length === 1) return stableMatches[0];
  if (!options.allowDisplayName) return null;

  const displayMatches = slots.filter(candidate => (
    !usedSlotIds.has(candidate.slotId) && candidate.slot.name === node.slotId
  ));
  if (Number.isInteger(node.slotIndex)) {
    return displayMatches.find(candidate => candidate.slotIndex === node.slotIndex) || null;
  }
  return displayMatches.length === 1 ? displayMatches[0] : null;
}

function serializeAssemblyNode(node) {
  return {
    itemId: node.item.id,
    slotId: node.parent ? getStableSlotId(node.sourceSlot, node.sourceSlotIndex) : null,
    ...(node.parent ? { slotIndex: node.sourceSlotIndex } : {}),
    children: node.children.map(serializeAssemblyNode),
  };
}

function migrateLegacyFlatConfiguration(configuration, weapon, catalog) {
  if (!configuration.children.every(node => node.children.length === 0)) return null;
  const rootUsedSlots = new Set();
  const containsNonRootSlot = configuration.children.some(node => {
    const slot = findSlot(weapon, node, rootUsedSlots, { allowDisplayName: true });
    if (slot) rootUsedSlots.add(slot.slotId);
    return !slot;
  });
  if (!containsNonRootSlot) return null;

  const buildParts = configuration.children.flatMap(node => {
    const item = getItem(catalog, node.itemId);
    if (!item) return [];
    const stableReference = Object.values(catalog.itemsById).some(parent => (
      (parent.properties?.slots || []).some((slot, slotIndex) => (
        getStableSlotId(slot, slotIndex) === node.slotId
        || getBuildSlotId(slot, slotIndex) === node.slotId
      ))
    ));
    return [{
      item,
      slotName: stableReference ? undefined : node.slotId,
      ...(stableReference ? { slotId: node.slotId } : {}),
      ...(Number.isInteger(node.slotIndex) ? { slotIndex: node.slotIndex } : {}),
    }];
  });
  if (buildParts.length !== configuration.children.length) return null;
  const assembly = buildWeaponAssemblyTree(weapon, buildParts);
  return assembly.unattachedParts.length === 0 ? serializeAssemblyNode(assembly) : null;
}

function canonicalizeVersion1Node(node, parentItem, catalog, usedSlotIds = new Set()) {
  const item = getItem(catalog, node.itemId);
  const slotContext = findSlot(parentItem, node, usedSlotIds, { allowDisplayName: true });
  if (!item || !slotContext) return structuredClone(node);
  usedSlotIds.add(slotContext.slotId);
  const childUsedSlots = new Set();
  return {
    itemId: node.itemId,
    slotId: slotContext.stableId,
    slotIndex: slotContext.slotIndex,
    children: node.children.map(child => canonicalizeVersion1Node(child, item, catalog, childUsedSlots)),
  };
}

function normalizeVersion1Configuration(configuration, weapon, catalog) {
  const migrated = migrateLegacyFlatConfiguration(configuration, weapon, catalog);
  if (migrated) return migrated;
  const usedSlotIds = new Set();
  return {
    itemId: configuration.itemId,
    slotId: null,
    children: configuration.children.map(node => canonicalizeVersion1Node(node, weapon, catalog, usedSlotIds)),
  };
}

function countModules(configuration) {
  let count = -1;
  const queue = [configuration];
  for (let index = 0; index < queue.length; index += 1) {
    count += 1;
    queue.push(...queue[index].children);
  }
  return count;
}

function getItem(catalog, itemId) {
  return catalog?.itemsById?.[itemId] || null;
}

export function restoreImportedBuild(importedBuild, catalog) {
  const errors = [];
  const weapon = getItem(catalog, importedBuild.weaponId);
  if (!weapon) {
    return { weapon: null, buildParts: [], errors: [`Weapon ${importedBuild.weaponId} is not available in this catalog.`] };
  }
  if (!weapon.types?.includes('gun')) {
    return { weapon, buildParts: [], errors: [`Item ${importedBuild.weaponId} is not a weapon.`] };
  }

  const buildParts = [];
  const installedIds = new Set([weapon.id]);
  const rootInstanceId = `weapon:${encodeURIComponent(String(weapon.id)).replaceAll('%', '_')}`;
  const configuration = normalizeVersion1Configuration(importedBuild.configuration, weapon, catalog);

  const visitChildren = (parentItem, parentInstanceId, children, parentPath) => {
    const usedSlotIds = new Set();
    children.forEach(node => {
      const item = getItem(catalog, node.itemId);
      const itemName = item?.shortName || item?.name || node.itemId;
      const itemPath = `${parentPath} > ${itemName}`;
      if (!item) {
        errors.push(`${itemPath}: item ${node.itemId} is not available in the ${importedBuild.gameMode} catalog.`);
        return;
      }
      const slotContext = findSlot(parentItem, node, usedSlotIds);
      if (!slotContext) {
        errors.push(`${itemPath}: slot ${node.slotId} was not found on ${parentItem.shortName || parentItem.name || parentItem.id}.`);
        return;
      }
      const allowedIds = new Set((slotContext.slot.filters?.allowedItems || []).map(value => value.id));
      if (!allowedIds.has(item.id)) {
        errors.push(`${itemPath}: ${itemName} is not allowed in slot ${slotContext.slot.name || slotContext.stableId}.`);
        return;
      }
      if (installedIds.has(item.id)) {
        errors.push(`${item.shortName || item.name || item.id} is installed more than once.`);
        return;
      }

      usedSlotIds.add(slotContext.slotId);
      installedIds.add(item.id);
      const slotInstanceId = getBuildSlotInstanceId(
        parentInstanceId,
        slotContext.slot,
        slotContext.slotIndex,
      );
      buildParts.push({
        slotName: slotContext.slot.name,
        slotId: slotContext.stableId,
        slotIndex: slotContext.slotIndex,
        slotInstanceId,
        parentItemId: parentItem.id,
        parentInstanceId,
        item,
      });
      visitChildren(item, getBuildItemInstanceId(slotInstanceId, item), node.children, itemPath);
    });

    (parentItem.properties?.slots || []).forEach((slot, slotIndex) => {
      if (slot.required !== true) return;
      const slotId = getBuildSlotId(slot, slotIndex);
      if (!usedSlotIds.has(slotId)) {
        errors.push(`${parentPath}: required slot ${getStableSlotId(slot, slotIndex)} (${slot.name || slotId}) is empty.`);
      }
    });
  };

  visitChildren(weapon, rootInstanceId, configuration.children, weapon.shortName || weapon.name || weapon.id);
  if (errors.length === 0) errors.push(...validateEditedBuild(weapon, buildParts));
  return { weapon, buildParts, errors };
}

export function createImportedBuildSnapshot(importedBuild, catalog) {
  const restored = restoreImportedBuild(importedBuild, catalog);
  if (restored.errors.length > 0) return { ...restored, snapshot: null };

  const priceMode = importedBuild.gameMode === 'pve' ? 'pve' : 'pvp';
  const includeTraderPrices = importedBuild.settings.includeTraderPrices !== false;
  const recalculated = recalculateBuildStats(restored.weapon, restored.buildParts, {
    priceMode,
    includeTraderPrices,
  });
  const snapshot = createBuildSnapshot({
    name: importedBuild.name,
    weapon: restored.weapon,
    buildResult: { build: restored.buildParts, stats: recalculated.stats },
    settings: {
      ...importedBuild.settings,
      priceMode,
      includeTraderPrices,
    },
  });
  return { ...restored, snapshot };
}

export function prepareImportedBuilds({ builds, catalogs, existingBuilds = [] }) {
  const existingByFingerprint = new Map(
    existingBuilds.flatMap(build => {
      const gameMode = build.settings?.priceMode === 'pve' ? 'pve' : 'regular';
      const catalog = catalogs instanceof Map ? catalogs.get(gameMode) : catalogs?.[gameMode];
      if (!catalog) return [];
      return [[getBuildFingerprint(exportBuild(build, { catalog })), build]];
    }),
  );

  return builds.map((build, index) => {
    const fingerprint = getBuildFingerprint(build);
    const duplicate = existingByFingerprint.get(fingerprint) || null;
    const catalog = catalogs instanceof Map ? catalogs.get(build.gameMode) : catalogs?.[build.gameMode];
    if (!catalog) {
      return {
        index,
        build,
        fingerprint,
        moduleCount: countModules(build.configuration),
        status: 'error',
        errors: [`The ${build.gameMode} item catalog could not be loaded.`],
        warnings: [],
        duplicateOf: duplicate,
        strategy: DUPLICATE_STRATEGIES.SKIP,
        snapshot: null,
      };
    }

    const restored = createImportedBuildSnapshot(build, catalog);
    const result = {
      index,
      build,
      fingerprint,
      weaponName: restored.weapon?.shortName || restored.weapon?.name || build.weaponId,
      moduleCount: countModules(build.configuration),
      status: restored.errors.length > 0 ? 'error' : duplicate ? 'duplicate' : 'ready',
      errors: restored.errors,
      warnings: duplicate ? [`Already saved as "${duplicate.name}".`] : [],
      duplicateOf: duplicate,
      strategy: duplicate ? DUPLICATE_STRATEGIES.SKIP : DUPLICATE_STRATEGIES.COPY,
      snapshot: restored.snapshot,
    };
    if (restored.errors.length === 0 && !duplicate) {
      existingByFingerprint.set(fingerprint, { name: build.name, pendingImport: true });
    }
    return result;
  });
}
