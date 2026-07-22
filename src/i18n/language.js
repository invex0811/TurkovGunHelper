export const SUPPORTED_LANGUAGES = ['en', 'ru'];
export const DEFAULT_LANGUAGE = 'en';
export const LANGUAGE_STORAGE_KEY = 'tarkovGunHelper.language';

export function normalizeLanguage(language) {
  return SUPPORTED_LANGUAGES.includes(language) ? language : DEFAULT_LANGUAGE;
}

export function loadLanguagePreference() {
  if (typeof window === 'undefined') return DEFAULT_LANGUAGE;
  try { return normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)); } catch { return DEFAULT_LANGUAGE; }
}

export function saveLanguagePreference(language) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, normalizeLanguage(language)); } catch { /* storage is optional */ }
}
