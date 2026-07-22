import { useCallback, useEffect, useMemo, useState } from 'react';
import { I18nContext } from './context.js';
import { DEFAULT_LANGUAGE, loadLanguagePreference, normalizeLanguage, saveLanguagePreference } from './language.js';
import { messages } from './messages.js';
import { interpolateMessage } from './interpolate.js';

export default function I18nProvider({ children }) {
  const [language, setLanguageState] = useState(loadLanguagePreference);
  const setLanguage = useCallback(nextLanguage => {
    const next = normalizeLanguage(nextLanguage);
    saveLanguagePreference(next);
    setLanguageState(next);
  }, []);
  const t = useCallback((key, values = {}) => {
    const message = messages[language]?.[key] ?? messages[DEFAULT_LANGUAGE][key] ?? key;
    return interpolateMessage(message, values, language);
  }, [language]);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = t('app.title');
  }, [language, t]);
  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
