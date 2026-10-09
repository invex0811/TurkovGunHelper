import { BUILD_SHARE_LIMITS, BUILD_SHARE_PARAM, BUILD_SHARE_VERSION } from './constants.js';
import { exportBuilds } from './serializer.js';
import { BuildImportError, parseBuildImport } from './validator.js';

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const BYTE_CHUNK_SIZE = 0x8000;

function fail(message, code) {
  throw new BuildImportError(message, code);
}

function toBase64Url(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BYTE_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BYTE_CHUNK_SIZE));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  if (!BASE64URL_PATTERN.test(text)) fail('The share link contains invalid characters.', 'INVALID_SHARE_LINK');
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/');
  try {
    return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), character => (
      character.charCodeAt(0)
    ));
  } catch {
    return fail('The share link is damaged.', 'INVALID_SHARE_LINK');
  }
}

// Reads the transformed stream in chunks so a crafted link cannot inflate into
// an unbounded amount of memory before the size check runs.
async function transformBytes(bytes, transformStream, maxBytes) {
  const reader = new Blob([bytes]).stream().pipeThrough(transformStream).getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        fail('The shared build is too large.', 'SHARE_LINK_TOO_LARGE');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof BuildImportError) throw error;
    fail('The share link is damaged.', 'INVALID_SHARE_LINK');
  }

  const result = new Uint8Array(total);
  let offset = 0;
  chunks.forEach(chunk => {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return result;
}

export function createBuildSharePayload(savedBuild, options = {}) {
  const { format, version, builds } = exportBuilds([savedBuild], options);
  return {
    format,
    version,
    // The sender's stash means nothing to the recipient, so a link never carries it.
    builds: builds.map(build => ({ ...build, ownedItems: [] })),
  };
}

export async function encodeBuildShareParam(savedBuild, options = {}) {
  const json = new TextEncoder().encode(JSON.stringify(createBuildSharePayload(savedBuild, options)));
  const compressed = await transformBytes(
    json,
    new CompressionStream('deflate-raw'),
    BUILD_SHARE_LIMITS.maxJsonBytes,
  );
  const param = `${BUILD_SHARE_VERSION}.${toBase64Url(compressed)}`;
  if (param.length > BUILD_SHARE_LIMITS.maxParamLength) {
    fail('This build is too large to share as a link.', 'SHARE_LINK_TOO_LARGE');
  }
  return param;
}

export async function decodeBuildShareParam(param) {
  if (typeof param !== 'string' || !param) fail('The share link is empty.', 'INVALID_SHARE_LINK');
  if (param.length > BUILD_SHARE_LIMITS.maxParamLength) {
    fail('The share link is too long.', 'SHARE_LINK_TOO_LARGE');
  }
  const separatorIndex = param.indexOf('.');
  const version = separatorIndex > 0 ? param.slice(0, separatorIndex) : '';
  if (version !== BUILD_SHARE_VERSION) {
    fail('This share link version is not supported.', 'UNSUPPORTED_SHARE_VERSION');
  }

  const json = await transformBytes(
    fromBase64Url(param.slice(separatorIndex + 1)),
    new DecompressionStream('deflate-raw'),
    BUILD_SHARE_LIMITS.maxJsonBytes,
  );
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(json);
  } catch {
    fail('The share link is damaged.', 'INVALID_SHARE_LINK');
  }
  const parsed = parseBuildImport(text);
  if (parsed.builds.length !== 1) fail('A share link must contain exactly one build.', 'INVALID_SHARE_LINK');
  return parsed;
}

export function createBuildShareUrl(param, location = globalThis.location) {
  if (!location) throw new TypeError('A page location is required to create a share link.');
  return `${location.origin}${location.pathname}#/builds?${BUILD_SHARE_PARAM}=${param}`;
}
