import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPageview } from './analytics.js';

// Counts one pageview per route. Query changes (catalog filters, loaded
// builds) stay on the same page and are not counted.
export function usePageviewTracking() {
  const { pathname } = useLocation();

  useEffect(() => {
    trackPageview(pathname);
  }, [pathname]);
}
