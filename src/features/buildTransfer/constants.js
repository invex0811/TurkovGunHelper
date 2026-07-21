export const BUILD_EXPORT_FORMAT = 'tarkov-gun-helper-builds';
export const BUILD_EXPORT_VERSION = 1;

export const BUILD_IMPORT_LIMITS = Object.freeze({
  maxFileBytes: 2 * 1024 * 1024,
  maxFiles: 20,
  maxBuilds: 100,
  maxNodesPerBuild: 500,
  maxDepth: 20,
  maxNameLength: 80,
});

export const BUILD_GAME_MODES = Object.freeze({
  REGULAR: 'regular',
  PVE: 'pve',
});

export const DUPLICATE_STRATEGIES = Object.freeze({
  SKIP: 'skip',
  COPY: 'copy',
  REPLACE: 'replace',
});
