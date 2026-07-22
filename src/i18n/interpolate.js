export function interpolateMessage(message, values = {}, language = 'en') {
  const pluralRules = new Intl.PluralRules(language);
  const pluralPattern = /\{(\w+),\s*plural,\s*((?:\w+\s*\{[^{}]*\}\s*)+)\}/g;
  const withPlurals = message.replace(pluralPattern, (_, key, optionsText) => {
    const options = {};
    for (const option of optionsText.matchAll(/(\w+)\s*\{([^{}]*)\}/g)) options[option[1]] = option[2];
    const category = pluralRules.select(Number(values[key]));
    return options[category] ?? options.other ?? '';
  });
  return withPlurals.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`));
}
