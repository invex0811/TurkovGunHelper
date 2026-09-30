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

// Loads the tracker on the first pageview and queues pageviews until it is
// ready. A blocked or failed script turns tracking off for the session.
export function createPageviewTracker(win) {
  let pendingPaths = [];
  let state = 'idle';

  function send(path) {
    // HashRouter keeps the route in the hash; report it as a plain path so
    // every screen shows up as its own page in Umami.
    win.umami.track(props => ({ ...props, url: path }));
  }

  function loadScript() {
    state = 'loading';
    const script = win.document.createElement('script');
    script.src = UMAMI_SCRIPT_URL;
    script.dataset.websiteId = UMAMI_WEBSITE_ID;
    script.dataset.autoTrack = 'false';
    script.onload = () => {
      state = 'ready';
      const paths = pendingPaths;
      pendingPaths = [];
      paths.forEach(send);
    };
    script.onerror = () => {
      state = 'failed';
      pendingPaths = [];
    };
    win.document.head.append(script);
  }

  return function trackPageview(path) {
    if (state === 'failed' || !isTrackedHost(win.location.hostname)) return;
    if (state === 'ready') {
      send(path);
      return;
    }
    pendingPaths.push(path);
    if (state === 'idle') loadScript();
  };
}
