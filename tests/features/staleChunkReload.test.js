import test from 'node:test';
import assert from 'node:assert/strict';
import { handleStaleChunk, STALE_CHUNK_RELOAD_INTERVAL_MS } from '../../src/features/pwa/staleChunkReload.js';

function createWindow(storage = new Map()) {
  const win = {
    reloads: 0,
    location: { reload: () => { win.reloads += 1; } },
    sessionStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  };
  return win;
}

function createEvent() {
  return { prevented: false, preventDefault() { this.prevented = true; } };
}

test('a missing chunk reloads the page into the new version', () => {
  const win = createWindow();
  const event = createEvent();
  assert.equal(handleStaleChunk(event, win), true);
  assert.equal(event.prevented, true);
  assert.equal(win.reloads, 1);
});

test('a second failure right after the reload surfaces instead of looping', () => {
  const storage = new Map();
  handleStaleChunk(createEvent(), createWindow(storage));
  const win = createWindow(storage);
  const event = createEvent();
  assert.equal(handleStaleChunk(event, win), false);
  assert.equal(event.prevented, false);
  assert.equal(win.reloads, 0);
});

test('a failure long after the last reload reloads again', () => {
  const storage = new Map([['tarkovGunHelper.staleChunkReloadAt', String(Date.now() - STALE_CHUNK_RELOAD_INTERVAL_MS - 1)]]);
  const win = createWindow(storage);
  assert.equal(handleStaleChunk(createEvent(), win), true);
});

test('without session storage the error surfaces', () => {
  const win = createWindow();
  win.sessionStorage.getItem = () => { throw new Error('blocked'); };
  const event = createEvent();
  assert.equal(handleStaleChunk(event, win), false);
  assert.equal(win.reloads, 0);
});
