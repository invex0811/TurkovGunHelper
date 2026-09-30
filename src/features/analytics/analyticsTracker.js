// Visits are counted with Umami Cloud. The website ID is public by design:
// the tracker sends it with every request from the page.
export const UMAMI_SCRIPT_URL = 'https://cloud.umami.is/script.js';
export const UMAMI_WEBSITE_ID = '6a2dd6ee-d153-4597-bf9b-6a41d20dcd5f';

// Only the public site is counted, so dev servers, previews and e2e runs
// do not spend the monthly event limit.
export const TRACKED_HOSTS = ['invex0811.github.io'];

export function isTrackedHost(hostname) {
  return TRACKED_HOSTS.includes(hostname);
}

// Loads the tracker on the first call and queues calls until it is ready.
// A blocked or failed script turns tracking off for the session.
export function createAnalyticsTracker(win) {
  let pendingCalls = [];
  let state = 'idle';
  let currentPath = null;

  function loadScript() {
    state = 'loading';
    const script = win.document.createElement('script');
    script.src = UMAMI_SCRIPT_URL;
    script.dataset.websiteId = UMAMI_WEBSITE_ID;
    script.dataset.autoTrack = 'false';    script.onload = () => {
      state = 'ready';
      const calls = pendingCalls;
      pendingCalls = [];
      calls.forEach(call => call(win.umami));
    };
    script.onerror = () => {
      state = 'failed';
      pendingCalls = [];
    };
    win.document.head.append(script);
  }

  function run(call) {
    if (state === 'failed' || !isTrackedHost(win.location.hostname)) return;
    if (state === 'ready') {
      call(win.umami);
      return;
    }
    pendingCalls.push(call);
    if (state === 'idle') loadScript();
  }

  return {
    // HashRouter keeps the route in the hash; report it as a plain path so
    // every screen shows up as its own page in Umami. A repeat of the same
    // path (StrictMode re-running effects) is not a new pageview.
    trackPageview(path) {
      if (path === currentPath) return;
      currentPath = path;
      run(umami => umami.track(props => ({ ...props, url: path })));
    },
    // Events are attributed to the page they happened on. Every data
    // property is billed as one more event, so keep data small.
    trackEvent(name, data) {
      const url = currentPath;
      run(umami => umami.track(props => ({ ...props, ...(url ? { url } : {}), name, data })));
    },
  };
}
