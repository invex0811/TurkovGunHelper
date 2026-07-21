import { exportBuilds } from './serializer.js';

export function createSafeBuildFilename(name, fallback = 'tarkov-build') {
  const safeName = String(name || '')
    .normalize('NFKD')
    .split('')
    .map(character => (character.charCodeAt(0) < 32 ? '-' : character))
    .join('')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 80);
  return `${safeName || fallback}.json`;
}

export function downloadBuildJson(payload, filename, environment = {}) {
  const documentObject = environment.document || globalThis.document;
  const urlObject = environment.URL || globalThis.URL;
  if (!documentObject || !urlObject?.createObjectURL) {
    throw new Error('File downloads are unavailable in this browser.');
  }

  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
  const objectUrl = urlObject.createObjectURL(blob);
  try {
    const link = documentObject.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.style.display = 'none';
    documentObject.body.append(link);
    link.click();
    link.remove();
  } finally {
    urlObject.revokeObjectURL(objectUrl);
  }
}

export function downloadBuildFile(savedBuild, options = {}) {
  const payload = exportBuilds([savedBuild], options);
  downloadBuildJson(payload, createSafeBuildFilename(savedBuild.name), options.environment);
  return payload;
}

export function downloadAllBuilds(savedBuilds, options = {}) {
  const payload = exportBuilds(savedBuilds, options);
  downloadBuildJson(payload, createSafeBuildFilename('tarkov-gun-helper-builds'), options.environment);
  return payload;
}
