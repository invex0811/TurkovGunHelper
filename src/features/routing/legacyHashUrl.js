// The app used HashRouter until the switch to real paths, and links in that
// format are already out in the wild (shared builds above all). This turns
// such an address into the matching path before the router starts:
//   /#/builds?share=1.x       → /builds/?share=1.x
//   /#/settings#traders       → /settings/#traders
//   /#/configure/<id>?build=y → /configure/<id>?build=y (the route then
//                               redirects to /weapon/<slug>/?build=y)
// Returns null when the address is not a legacy one.
export function getLegacyHashRedirect(location) {
  const hash = location?.hash;
  if (typeof hash !== 'string' || !hash.startsWith('#/')) return null;

  let url;
  try {
    url = new URL(hash.slice(1), 'https://legacy.invalid');
  } catch {
    return '/';
  }
  // A leading "//" would make the target another origin.
  let pathname = `/${url.pathname.replace(/^\/+/, '')}`;
  // The section pages are served from <name>/index.html.
  if (/^\/(builds|module-comparison|settings)$/.test(pathname)) pathname = `${pathname}/`;
  return `${pathname}${url.search}${url.hash}`;
}

export function redirectLegacyHashUrl(win = globalThis.window) {
  const target = win ? getLegacyHashRedirect(win.location) : null;
  if (target === null) return false;
  try {
    win.history.replaceState(win.history.state, '', target);
    return true;
  } catch {
    return false;
  }
}
