// After an update the old version's chunks are gone from the server and from
// the service worker cache. A page still running the old version would crash
// when it lazy-loads one (a page it has not opened yet), so it reloads into
// the new version instead. At most once per 10 s per tab: a chunk that is
// really missing then fails as before instead of reloading in a loop.
const LAST_RELOAD_KEY = 'tarkovGunHelper.staleChunkReloadAt';
export const STALE_CHUNK_RELOAD_INTERVAL_MS = 10_000;

export function handleStaleChunk(event, win) {
  const now = Date.now();
  try {
    const lastReload = Number(win.sessionStorage.getItem(LAST_RELOAD_KEY)) || 0;
    if (now - lastReload < STALE_CHUNK_RELOAD_INTERVAL_MS) return false;
    win.sessionStorage.setItem(LAST_RELOAD_KEY, String(now));
  } catch {
    // Without storage there is no loop guard: let the error surface.
    return false;
  }
  event.preventDefault();
  win.location.reload();
  return true;
}

export function reloadOnStaleChunk(win = globalThis.window) {
  win?.addEventListener('vite:preloadError', event => handleStaleChunk(event, win));
}
