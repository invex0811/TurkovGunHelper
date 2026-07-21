import {
  BUILD_EXPORT_FORMAT,
  BUILD_EXPORT_VERSION,
  BUILD_GAME_MODES,
  BUILD_IMPORT_LIMITS,
} from './constants.js';

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export class BuildImportError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'BuildImportError';
    this.code = code;
    this.details = details;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function fail(message, code, details) {
  throw new BuildImportError(message, code, details);
}

function assertSafeObjectGraph(value, path = '$', active = new Set(), visited = new Set()) {
  if (!value || typeof value !== 'object') return;
  if (active.has(value)) fail(`A cycle was found at ${path}.`, 'CYCLIC_DATA');
  if (visited.has(value)) return;
  active.add(value);
  visited.add(value);

  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) fail(`Unsafe field "${key}" is not allowed.`, 'UNSAFE_KEY');
    assertSafeObjectGraph(value[key], `${path}.${key}`, active, visited);
  }
  active.delete(value);
}

function validateNode(node, { depth, isRoot, counter }) {
  if (!isRecord(node)) fail('Build configuration nodes must be objects.', 'INVALID_CONFIGURATION');
  if (depth > BUILD_IMPORT_LIMITS.maxDepth) {
    fail(`Build configuration exceeds the maximum depth of ${BUILD_IMPORT_LIMITS.maxDepth}.`, 'MAX_DEPTH');
  }
  counter.count += 1;
  if (counter.count > BUILD_IMPORT_LIMITS.maxNodesPerBuild) {
    fail(`A build can contain up to ${BUILD_IMPORT_LIMITS.maxNodesPerBuild} items.`, 'MAX_NODES');
  }
  if (typeof node.itemId !== 'string' || !node.itemId.trim()) {
    fail('Every configuration item must have a non-empty itemId.', 'INVALID_ITEM_ID');
  }
  if (isRoot) {
    if (node.slotId !== null) fail('The root weapon slotId must be null.', 'INVALID_SLOT_ID');
  } else if (typeof node.slotId !== 'string' || !node.slotId.trim()) {
    fail('Every module must have a non-empty slotId.', 'INVALID_SLOT_ID');
  }
  if (node.slotIndex !== undefined && (!Number.isInteger(node.slotIndex) || node.slotIndex < 0)) {
    fail('slotIndex must be a non-negative integer.', 'INVALID_SLOT_INDEX');
  }
  if (!Array.isArray(node.children)) fail('Every configuration node must contain a children array.', 'INVALID_CHILDREN');
  node.children.forEach(child => validateNode(child, {
    depth: depth + 1,
    isRoot: false,
    counter,
  }));
}

function copyNode(node) {
  return {
    itemId: node.itemId,
    slotId: node.slotId,
    ...(node.slotIndex !== undefined ? { slotIndex: node.slotIndex } : {}),
    children: node.children.map(copyNode),
  };
}

function copySettings(settings) {
  if (settings === undefined) return {};
  if (!isRecord(settings)) fail('Build settings must be an object.', 'INVALID_SETTINGS');
  return structuredClone(settings);
}

export function parseVersion1BuildExport(data) {
  if (!Array.isArray(data.builds)) fail('The file must contain a builds array.', 'MISSING_BUILDS');
  if (data.builds.length > BUILD_IMPORT_LIMITS.maxBuilds) {
    fail(`A file can contain up to ${BUILD_IMPORT_LIMITS.maxBuilds} builds.`, 'MAX_BUILDS');
  }

  const builds = data.builds.map((build, index) => {
    if (!isRecord(build)) fail(`Build ${index + 1} must be an object.`, 'INVALID_BUILD', { index });
    if (typeof build.name !== 'string') fail(`Build ${index + 1} has an invalid name.`, 'INVALID_NAME', { index });
    const name = build.name.trim();
    if (!name || name.length > BUILD_IMPORT_LIMITS.maxNameLength) {
      fail(`Build names must contain 1-${BUILD_IMPORT_LIMITS.maxNameLength} characters.`, 'INVALID_NAME', { index });
    }
    if (![BUILD_GAME_MODES.REGULAR, BUILD_GAME_MODES.PVE].includes(build.gameMode)) {
      fail(`Build "${name}" has an invalid gameMode.`, 'INVALID_GAME_MODE', { index });
    }
    if (typeof build.weaponId !== 'string' || !build.weaponId.trim()) {
      fail(`Build "${name}" has an invalid weaponId.`, 'INVALID_WEAPON_ID', { index });
    }
    validateNode(build.configuration, { depth: 0, isRoot: true, counter: { count: 0 } });
    if (build.configuration.itemId !== build.weaponId) {
      fail(`Build "${name}" has a root item that does not match weaponId.`, 'WEAPON_ROOT_MISMATCH', { index });
    }
    return {
      name,
      gameMode: build.gameMode,
      weaponId: build.weaponId,
      settings: copySettings(build.settings),
      configuration: copyNode(build.configuration),
    };
  });
  return { format: data.format, version: data.version, exportedAt: data.exportedAt, builds };
}

export function validateBuildImport(data) {
  assertSafeObjectGraph(data);
  if (!isRecord(data)) fail('The import file root must be an object.', 'INVALID_ROOT');
  if (data.format !== BUILD_EXPORT_FORMAT) fail('This is not a Tarkov Gun Helper build file.', 'INVALID_FORMAT');
  if (data.version !== BUILD_EXPORT_VERSION) {
    fail('This build file version is not supported yet.', 'UNSUPPORTED_VERSION', { version: data.version });
  }
  return parseVersion1BuildExport(data);
}

export function parseBuildImport(text) {
  if (typeof text !== 'string') fail('Import contents must be text.', 'INVALID_INPUT');
  if (new TextEncoder().encode(text).byteLength > BUILD_IMPORT_LIMITS.maxFileBytes) {
    fail(`The file exceeds the ${BUILD_IMPORT_LIMITS.maxFileBytes / 1024 / 1024} MB limit.`, 'FILE_TOO_LARGE');
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail('The selected file does not contain valid JSON.', 'INVALID_JSON');
  }
  return validateBuildImport(data);
}
