import { createElement } from 'react';

const TARKOV_DEV_ITEM_ORIGINS = new Set([
  'https://tarkov.dev',
  'https://www.tarkov.dev',
]);
const TARKOV_DEV_ITEM_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function getValidatedTarkovDevItemLink(value) {
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const url = new URL(value);
    const pathSegments = url.pathname.split('/').filter(Boolean);
    const hasValidItemPath = pathSegments.length === 2
      && pathSegments[0] === 'item'
      && TARKOV_DEV_ITEM_SLUG_PATTERN.test(pathSegments[1]);

    if (
      !TARKOV_DEV_ITEM_ORIGINS.has(url.origin)
      || !hasValidItemPath
      || url.username
      || url.password
      || url.search
      || url.hash
    ) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

export function getTarkovDevItemUrl(weapon) {
  if (!weapon || typeof weapon !== 'object') return null;

  for (const linkCandidate of [weapon.tarkovDevUrl, weapon.link]) {
    const officialLink = getValidatedTarkovDevItemLink(linkCandidate);
    if (officialLink) return officialLink;
  }

  const normalizedName = typeof weapon.normalizedName === 'string'
    ? weapon.normalizedName.trim()
    : '';

  if (!TARKOV_DEV_ITEM_SLUG_PATTERN.test(normalizedName)) return null;

  return `https://tarkov.dev/item/${normalizedName}`;
}

function ExternalLinkIcon() {
  return createElement(
    'svg',
    {
      className: 'tarkov-dev-link__icon',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      strokeWidth: '1.8',
      'aria-hidden': 'true',
    },
    createElement('path', { d: 'M14 5h5v5' }),
    createElement('path', { d: 'm10 14 9-9' }),
    createElement('path', { d: 'M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5' }),
  );
}

export function TarkovDevItemLink({ weapon }) {
  const url = getTarkovDevItemUrl(weapon);

  if (!url) {
    return createElement('span', null, 'tarkov.dev');
  }

  const weaponName = typeof weapon.name === 'string' && weapon.name.trim()
    ? weapon.name.trim()
    : 'оружие';

  return createElement(
    'a',
    {
      className: 'tarkov-dev-link',
      href: url,
      target: '_blank',
      rel: 'noopener noreferrer',
      title: 'Открыть оружие на tarkov.dev',
      'aria-label': `Открыть ${weaponName} на tarkov.dev`,
    },
    'tarkov.dev',
    createElement(ExternalLinkIcon),
  );
}
