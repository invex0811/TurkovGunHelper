import { createElement } from 'react';
import { MATERIAL_SYMBOL_NAMES } from './materialSymbolNames.js';

const KNOWN_NAMES = new Set(MATERIAL_SYMBOL_NAMES);

// Decorative Material Symbols icon. The ligature name lives in data-icon and
// is drawn by CSS, so it never leaks into text content or accessible names.
export function MaterialSymbol({ name, className = '' }) {
  if (import.meta.env?.DEV && !KNOWN_NAMES.has(name)) {
    console.warn(`Material Symbol "${name}" is not in the bundled subset; add it to materialSymbolNames.js and run npm run icons.`);
  }

  return createElement('span', {
    className: className ? `material-symbol ${className}` : 'material-symbol',
    'data-icon': name,
    'aria-hidden': 'true',
  });
}
