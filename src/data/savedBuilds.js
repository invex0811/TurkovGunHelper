export const SAVED_BUILDS_STORAGE_KEY = 'tarkov-gun-helper:saved-builds';
export const SAVED_BUILD_SCHEMA_VERSION = 1;
export const MAX_SAVED_BUILDS = 100;
export const MAX_COMPARE_BUILDS = 4;

export class SavedBuildStorageError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'SavedBuildStorageError';
    this.code = code;
  }
}

function getDefaultStorage() {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidSavedBuild(value) {
  return isRecord(value)
    && value.version === SAVED_BUILD_SCHEMA_VERSION
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.name === 'string'
    && isRecord(value.weapon)
    && typeof value.weapon.id === 'string'
    && Array.isArray(value.parts)
    && isRecord(value.stats)
    && isRecord(value.settings);
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `build-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function writeSavedBuilds(builds, storage) {
  if (!storage) {
    throw new SavedBuildStorageError('Local storage is unavailable in this browser.', 'STORAGE_UNAVAILABLE');
  }

  try {
    storage.setItem(SAVED_BUILDS_STORAGE_KEY, JSON.stringify(builds));
  } catch (error) {
    throw new SavedBuildStorageError(
      'The browser could not save this build. Local storage may be full or disabled.',
      'WRITE_FAILED',
      error,
    );
  }
}

export function readSavedBuilds(storage = getDefaultStorage()) {
  if (!storage) return [];

  try {
    const serialized = storage.getItem(SAVED_BUILDS_STORAGE_KEY);
    if (!serialized) return [];

    const parsed = JSON.parse(serialized);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(isValidSavedBuild)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  } catch {
    return [];
  }
}

export function getSavedBuild(buildId, storage = getDefaultStorage()) {
  if (!buildId) return null;
  return readSavedBuilds(storage).find(build => build.id === buildId) || null;
}

export function saveBuildSnapshot(snapshot, storage = getDefaultStorage(), options = {}) {
  const builds = readSavedBuilds(storage);
  const existingIndex = snapshot.id
    ? builds.findIndex(build => build.id === snapshot.id)
    : -1;

  if (existingIndex === -1 && builds.length >= MAX_SAVED_BUILDS) {
    throw new SavedBuildStorageError(
      `You can save up to ${MAX_SAVED_BUILDS} builds. Delete an old build before saving another one.`,
      'LIMIT_REACHED',
    );
  }

  const now = options.now || new Date().toISOString();
  const savedBuild = {
    ...snapshot,
    id: snapshot.id || options.id || createId(),
    version: SAVED_BUILD_SCHEMA_VERSION,
    name: String(snapshot.name || snapshot.weapon?.shortName || 'Weapon build').trim().slice(0, 80),
    createdAt: existingIndex >= 0 ? builds[existingIndex].createdAt : now,
    updatedAt: now,
  };

  if (!isValidSavedBuild(savedBuild)) {
    throw new SavedBuildStorageError('The build data is incomplete and cannot be saved.', 'INVALID_BUILD');
  }

  if (existingIndex >= 0) builds.splice(existingIndex, 1);
  builds.unshift(savedBuild);
  writeSavedBuilds(builds, storage);
  return savedBuild;
}

export function deleteSavedBuild(buildId, storage = getDefaultStorage()) {
  const builds = readSavedBuilds(storage);
  const nextBuilds = builds.filter(build => build.id !== buildId);
  if (nextBuilds.length === builds.length) return false;

  writeSavedBuilds(nextBuilds, storage);
  return true;
}

export function createBuildSnapshot({
  id,
  name,
  weapon,
  buildResult,
  settings,
}) {
  return {
    id,
    version: SAVED_BUILD_SCHEMA_VERSION,
    name,
    weapon: {
      id: weapon.id,
      name: weapon.name,
      shortName: weapon.shortName,
      imageUrl: weapon.properties?.defaultPreset?.image512pxLink
        || weapon.image512pxLink
        || weapon.iconLink
        || '',
    },
    parts: buildResult.build.map(part => ({
      itemId: part.item.id,
      itemName: part.item.shortName || part.item.name || part.item.id,
      slotName: part.slotName,
    })),
    stats: {
      ergonomics: buildResult.stats.ergonomics,
      recoilVertical: buildResult.stats.recoilVertical,
      recoilHorizontal: buildResult.stats.recoilHorizontal,
      weight: buildResult.stats.weight,
      price: buildResult.stats.price,
    },
    settings: { ...settings },
  };
}

export function restoreBuildParts(savedBuild, allMods) {
  const missingItemIds = [];
  const build = savedBuild.parts.flatMap(part => {
    const item = allMods?.[part.itemId];
    if (!item) {
      missingItemIds.push(part.itemId);
      return [];
    }

    return [{ slotName: part.slotName, item }];
  });

  return { build, missingItemIds };
}
