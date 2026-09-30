import { createAnalyticsTracker } from './analyticsTracker.js';

let tracker = null;

function getTracker() {
  tracker ??= createAnalyticsTracker(window);
  return tracker;
}

export function trackPageview(path) {
  getTracker().trackPageview(path);
}

// tarkov.dev's normalizedName is the same in every language, so one weapon
// stays one row in the stats whatever language the visitor uses.
export function getWeaponOpenEventData(weapon) {
  const id = weapon?.normalizedName || weapon?.id;
  return id ? { weapon: id } : null;
}

export function trackWeaponOpen(weapon) {
  const data = getWeaponOpenEventData(weapon);
  if (data) getTracker().trackEvent('weapon-open', data);
}
