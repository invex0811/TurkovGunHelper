import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPageviewTracker,
  isTrackedHost,
  UMAMI_SCRIPT_URL,
  UMAMI_WEBSITE_ID,
} from '../../src/features/analytics/pageviewTracker.js';

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
  const trackPageview = createPageviewTracker(win);

  trackPageview('/');

  assert.equal(scripts.length, 0);
});

test('loads the tracker once with automatic tracking off', () => {
  const { win, scripts } = createFakeWindow('invex0811.github.io');
  const trackPageview = createPageviewTracker(win);

  trackPageview('/');
  trackPageview('/builds');

  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].src, UMAMI_SCRIPT_URL);
  assert.equal(scripts[0].dataset.websiteId, UMAMI_WEBSITE_ID);
  assert.equal(scripts[0].dataset.autoTrack, 'false');
});

test('sends queued pageviews as plain paths once the tracker is ready', () => {
  const { win, sent, loadUmami } = createFakeWindow('invex0811.github.io');
  const trackPageview = createPageviewTracker(win);

  trackPageview('/');
  trackPageview('/configure/5447a9cd4bdc2dbd208b4567');
  loadUmami();
  trackPageview('/builds');

  assert.deepEqual(sent.map(payload => payload.url), [
    '/',
    '/configure/5447a9cd4bdc2dbd208b4567',
    '/builds',
  ]);
  assert.equal(sent[0].website, UMAMI_WEBSITE_ID);
});

test('stops tracking when the script is blocked', () => {
  const { win, scripts } = createFakeWindow('invex0811.github.io');
  const trackPageview = createPageviewTracker(win);

  trackPageview('/');
  scripts[0].onerror();
  trackPageview('/builds');

  assert.equal(scripts.length, 1);
});
