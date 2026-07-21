const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function parseTranslationPath(path) {
  if (typeof path !== 'string' || !path.startsWith('$.data.')) return null;

  const segments = [];
  for (const token of path.slice('$.data.'.length).split('.')) {
    if (!token || BLOCKED_KEYS.has(token)) return null;
    if (token === '*') segments.push('*');
    else if (token.endsWith('[*]')) {
      const key = token.slice(0, -3);
      if (!key || BLOCKED_KEYS.has(key)) return null;
      segments.push(key, '*');
    } else if (/^[A-Za-z0-9_]+$/.test(token)) {
      segments.push(token);
    } else {
      return null;
    }
  }
  return segments;
}

function translateAtPath(value, segments, translations, index = 0) {
  if (!value || typeof value !== 'object') return;

  const segment = segments[index];
  const isLeaf = index === segments.length - 1;
  if (segment === '*') {
    for (const key of Object.keys(value)) {
      if (BLOCKED_KEYS.has(key)) continue;
      if (isLeaf) {
        const translationKey = value[key];
        const translation = Object.hasOwn(translations, translationKey)
          ? translations[translationKey]
          : undefined;
        if (typeof translation === 'string') value[key] = translation;
      } else {
        translateAtPath(value[key], segments, translations, index + 1);
      }
    }
    return;
  }

  if (!Object.hasOwn(value, segment)) return;
  if (isLeaf) {
    const translationKey = value[segment];
    const translation = Object.hasOwn(translations, translationKey)
      ? translations[translationKey]
      : undefined;
    if (typeof translation === 'string') value[segment] = translation;
  } else {
    translateAtPath(value[segment], segments, translations, index + 1);
  }
}

export function applyTarkovTranslations(apiResponse, translationMap) {
  if (!apiResponse?.data || !translationMap || typeof translationMap !== 'object') {
    return apiResponse;
  }

  for (const path of apiResponse.translations || []) {
    const segments = parseTranslationPath(path);
    if (segments) translateAtPath(apiResponse.data, segments, translationMap);
  }
  return apiResponse;
}
