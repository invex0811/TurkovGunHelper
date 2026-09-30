import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAnalyticsTracker,
  isTrackedHost,
  UMAMI_SCRIPT_URL,
  UMAMI_WEBSITE_ID,
} from '../../src/features/analytics/analyticsTracker.js';
import { getWeaponOpenEventData } from '../../src/features/analytics/analytics.js';

function createFakeWindow(hostname) {
  const scripts = [];
  const sent = [];
  const win = {
    location: { hostname },
    document: {
      createElement: () => ({ dataset: {} }),
      head: { append: script => scripts.push(script) },
    },
  };
  const loadUmami = () => {
    win.umami = {
      track: buildPayload => sent.push(buildPayload({ website: UMAMI_WEBSITE_ID, url: '/#/ignored' })),
    };
    scripts[0].onload();
  };
  return { win, scripts, sent, loadUmami };
}

test('counts only the public site', () => {
  assert.equal(isTrackedHost('invex0811.github.io'), true);
  assert.equal(isTrackedHost('localhost'), false);
  assert.equal(isTrackedHost('127.0.0.1'), false);
});

test('does not load the tracker on other hosts', () => {
  const { win, scripts } = createFakeWindow('127.0.0.1');
  const tracker = createAnalyticsTracker(win);

  tracker.trackPageview('/');
  tracker.trackEvent('weapon-open', { weapon: 'test' });

  assert.equal(scripts.length, 0);
});

test('loads the tracker once with automatic tracking off', () => {
  const { win, scripts } = createFakeWindow('invex0811.github.io');
  const tracker = createAnalyticsTracker(win);

  tracker.trackPageview('/');
  tracker.trackPageview('/builds');

  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, UMAMI_SCRIPT_URL);
  assert.equal(scripts[0].dataset.websiteId, UMAMI_WEBSITE_ID);
  assert.equal(scripts[0].dataset.autoTrack, 'false');
});

test('sends queued pageviews and events in order once the tracker is ready', () => {
  const { win, sent, loadUmami } = createFakeWindow('invex0811.github.io');
  const tracker = createAnalyticsTracker(win);

  tracker.trackPageview('/');
  tracker.trackPageview('/configure/5447a9cd4bdc2dbd208b4567');
  tracker.trackEvent('weapon-open', { weapon: 'colt-m4a1-556x45-assault-rifle' });
  loadUmami();
  tracker.trackPageview('/builds');

  assert.deepEqual(sent, [
    { website: UMAMI_WEBSITE_ID, url: '/' },
    { website: UMAMI_WEBSITE_ID, url: '/configure/5447a9cd4bdc2dbd208b4567' },
    {
      website: UMAMI_WEBSITE_ID,
      url: '/configure/5447a9cd4bdc2dbd208b4567',
      name: 'weapon-open',
      data: { weapon: 'colt-m4a1-556x45-assault-rifle' },
    },
    { website: UMAMI_WEBSITE_ID, url: '/builds' },
  ]);
});

test('does not count the same path twice in a row', () => {
  const { win, sent, loadUmami } = createFakeWindow('invex0811.github.io');
  const tracker = createAnalyticsTracker(win);

  tracker.trackPageview('/');
  tracker.trackPageview('/');
  tracker.trackPageview('/builds');
  tracker.trackPageview('/');
  loadUmami();

  assert.deepEqual(sent.map(payload => payload.url), ['/', '/builds', '/']);
});

test('stops tracking when the script is blocked', () => {
  const { win, scripts } = createFakeWindow('invex0811.github.io');
  const tracker = createAnalyticsTracker(win);

  tracker.trackPageview('/');
  scripts[0].onerror();
  tracker.trackEvent('weapon-open', { weapon: 'test' });

  assert.equal(scripts.length, 1);
});

test('names the opened weapon by its language-independent tarkov.dev slug', () => {
  assert.deepEqual(
    getWeaponOpenEventData({
      id: '5447a9cd4bdc2dbd208b4567',
      name: 'Кольт M4A1',
      normalizedName: 'colt-m4a1-556x45-assault-rifle',
    }),
    { weapon: 'colt-m4a1-556x45-assault-rifle' },
  );
  assert.deepEqual(getWeaponOpenEventData({ id: '5447a9cd4bdc2dbd208b4567' }), { weapon: '5447a9cd4bdc2dbd208b4567' });
  assert.equal(getWeaponOpenEventData(null), null);
});
