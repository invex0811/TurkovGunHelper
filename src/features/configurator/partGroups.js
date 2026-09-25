import { hasItemCategory } from '../../domain/itemCategories.js';

const SLOT_GROUP_KINDS = {
  'reciever': 'receiver',
  'receiver': 'receiver',
  'ств кор': 'receiver',
  'ствольная коробка': 'receiver',
  'pistolgrip': 'pistolGrip',
  'pistol grip': 'pistolGrip',
  'grip': 'pistolGrip',
  'gasblock': 'gasBlock',
  'gas block': 'gasBlock',
  'газ кам': 'gasBlock',
  'газовая камера': 'gasBlock',
  'front sight': 'frontSight',
  'rear sight': 'rearSight',
  'sight front': 'frontSight',
  'sight rear': 'rearSight',
  'flashlight': 'tacticalDevice',
  'ubgl': 'underbarrelLauncher',
  'tactical': 'tacticalDevice',
  'foregrip': 'foregrip',
  'front grip': 'foregrip',
  'перед рук': 'foregrip',
  'передняя рукоятка': 'foregrip',
  'bipod': 'bipod',
  'launcher': 'launcher',
  'scope': 'scope',
  'mount': 'mount',
  'charge': 'chargingHandle',
  'charging handle': 'chargingHandle',
  'ch handle': 'chargingHandle',
  'рук затв': 'chargingHandle',
  'рукоятка затвора': 'chargingHandle',
  'рукоятка взведения': 'chargingHandle',
  'dustcover': 'dustCover',
  'dust cover': 'dustCover',
  'barrel': 'barrel',
  'handguard': 'handguard',
  'muzzle': 'muzzle',
  'stock': 'stock',
  'magazine': 'magazine',
  'mag': 'magazine',
};

// Assemblies that get their own group; every other module joins the group of
// the nearest assembly it is attached to (a muzzle brake on a barrel is part
// of the barrel, a foregrip on a handguard is part of the handguard).
const ASSEMBLY_KINDS = new Set([
  'receiver',
  'dustCover',
  'chargingHandle',
  'barrel',
  'handguard',
  'scope',
  'stock',
  'pistolGrip',
  'magazine',
  'underbarrelLauncher',
  'launcher',
]);

const SIGHT_KINDS = new Set(['scope', 'frontSight', 'rearSight']);

const GROUP_ORDER = [
  'receiver',
  'dustCover',
  'chargingHandle',
  'barrel',
  'gasBlock',
  'handguard',
  'foregrip',
  'muzzle',
  'mount',
  'scope',
  'frontSight',
  'rearSight',
  'stock',
  'pistolGrip',
  'magazine',
  'tacticalDevice',
  'bipod',
  'underbarrelLauncher',
  'launcher',
];

function normalizeSlotName(slotName) {
  let name = String(slotName || '').trim().toLowerCase();
  if (name.startsWith('mod_')) name = name.substring(4);
  return name.replace(/[.\s_-]+/g, ' ').replace(/\d+$/, '').trim();
}

// "stock axis" or "tactical 002" resolve through their leading words.
function lookupSlotKind(slotKey) {
  const words = normalizeSlotName(slotKey).split(' ').filter(Boolean);
  while (words.length > 0) {
    const kind = SLOT_GROUP_KINDS[words.join(' ')];
    if (kind) return kind;
    words.pop();
  }
  return null;
}

function toTitleCase(name) {
  return name.split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Stable kind of a slot. The API id (mod_barrel) is language independent;
// the localized slot name is only a fallback and the label of unknown slots.
export function getSlotGroupKind(slotName, slotNameId = '') {
  const kind = lookupSlotKind(slotNameId) || lookupSlotKind(slotName);
  if (kind) return { kind, fallbackName: null };
  const name = normalizeSlotName(slotName) || normalizeSlotName(slotNameId);
  return name ? { kind: `slot:${name}`, fallbackName: toTitleCase(name) } : { kind: 'other', fallbackName: null };
}

export function getSlotGroupLabel(slotName, t, slotNameId = '') {
  const { kind, fallbackName } = getSlotGroupKind(slotName, slotNameId);
  return getKindLabel(kind, fallbackName, t);
}

function getKindLabel(kind, fallbackName, t) {
  if (kind === 'other') return t('config.other');
  return fallbackName ?? t(`config.slotGroup.${kind}`);
}

function isSightItem(item) {
  return hasItemCategory(item, 'Sights');
}

function subtreeHasSight(node) {
  if (!node) return false;
  if (isSightItem(node.item)) return true;
  return (node.children || []).some(subtreeHasSight);
}

// What the module itself is: a sight or a mount, or whatever its slot holds.
function getNodeLabelKind(node) {
  if (isSightItem(node.item)) return { kind: 'scope', fallbackName: null };
  if (hasItemCategory(node.item, 'Mount')) return { kind: 'mount', fallbackName: null };
  return getSlotGroupKind(node.slotName, node.sourceSlot?.nameId);
}

// Which assembly the module belongs to: its slot decides, except that sights
// and the mounts carrying them form the sight assembly.
function getNodeKind(node) {
  const slotKind = getSlotGroupKind(node.slotName, node.sourceSlot?.nameId);
  const isSightMount = (hasItemCategory(node.item, 'Mount') || slotKind.kind === 'mount') && subtreeHasSight(node);
  if (isSightItem(node.item) || isSightMount) return { kind: 'scope', fallbackName: null };
  return slotKind;
}

function isAssemblyKind(kind) {
  return ASSEMBLY_KINDS.has(kind) || SIGHT_KINDS.has(kind);
}

// The group of a module: its own assembly, or the nearest assembly above it.
// Modules mounted straight on the weapon keep their own group.
function resolveGroupKind(ownKind, parentNode) {
  if (isAssemblyKind(ownKind.kind)) {
    return SIGHT_KINDS.has(ownKind.kind) ? { kind: 'scope', fallbackName: null } : ownKind;
  }

  let current = parentNode;
  while (current?.parent) {
    const kind = getNodeKind(current);
    if (isAssemblyKind(kind.kind)) return resolveGroupKind(kind, null);
    current = current.parent;
  }
  return ownKind;
}

function getGroupRank(kind) {
  const index = GROUP_ORDER.indexOf(kind);
  return index === -1 ? GROUP_ORDER.length : index;
}

function getAssemblyOrder(tree) {
  const order = new Map();
  let index = 0;
  function visit(node) {
    order.set(node, index);
    index += 1;
    (node.children || []).forEach(visit);
  }
  if (tree) visit(tree);
  return order;
}

/**
 * Groups build module display items by weapon assembly. Installed items carry
 * their assembly node, empty required slots carry the node they belong to.
 */
export function groupBuildModuleDisplayItems(displayItems, tree, t) {
  const assemblyOrder = getAssemblyOrder(tree);
  const groupsByKind = new Map();

  displayItems.forEach((part, originalIndex) => {
    const node = part.assemblyNode ?? null;
    const slotKind = getSlotGroupKind(part.slotName, part.slot?.nameId);
    const ownKind = node ? getNodeKind(node) : slotKind;
    const labelKind = node ? getNodeLabelKind(node) : slotKind;
    const groupKind = resolveGroupKind(ownKind, node ? node.parent : part.parentNode);
    const ownLabel = getKindLabel(labelKind.kind, labelKind.fallbackName, t);
    const groupLabel = getKindLabel(groupKind.kind, groupKind.fallbackName, t);

    let group = groupsByKind.get(groupKind.kind);
    if (!group) {
      group = {
        key: groupKind.kind,
        kind: groupKind.kind,
        rootSlotName: groupLabel,
        parts: [],
      };
      groupsByKind.set(groupKind.kind, group);
    }

    const parentOrder = assemblyOrder.get(part.parentNode) ?? Number.MAX_SAFE_INTEGER;
    group.parts.push({
      ...part,
      slotLabel: ownLabel === groupLabel ? null : ownLabel,
      assemblyIndex: node ? (assemblyOrder.get(node) ?? Number.MAX_SAFE_INTEGER) : parentOrder + 0.5,
      originalIndex,
    });
  });

  const groups = [...groupsByKind.values()];
  groups.forEach(group => {
    group.parts.sort((first, second) => (
      first.assemblyIndex - second.assemblyIndex || first.originalIndex - second.originalIndex
    ));
    group.hasMissingCritical = group.parts.some(part => part.isCritical && part.isEmpty);
  });

  return groups.sort((first, second) => (
    Number(second.hasMissingCritical) - Number(first.hasMissingCritical)
    || getGroupRank(first.kind) - getGroupRank(second.kind)
    || first.rootSlotName.localeCompare(second.rootSlotName)
  ));
}
