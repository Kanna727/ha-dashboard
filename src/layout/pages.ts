import { useCallback, useSyncExternalStore } from 'react';

// Full-screen pages besides the home dashboard, kept in the URL hash
// (#vacuum) so the back button and a bookmarked kiosk URL both work.
export type Page = 'home' | 'vacuum';
const PAGES: Page[] = ['home', 'vacuum'];

const read = (): Page => {
  const h = window.location.hash.replace(/^#/, '') as Page;
  return PAGES.includes(h) ? h : 'home';
};

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

// `keepScroll`: a swipe lines the page up itself (layout/Pager.tsx).
export function usePage(): [Page, (p: Page, keepScroll?: boolean) => void] {
  const page = useSyncExternalStore(subscribe, read);
  const go = useCallback((p: Page, keepScroll = false) => {
    if (p === read()) return;
    if (p === 'home') {
      // Back to a clean URL; the home page is the entry in history before the page.
      if (window.history.state?.page) return window.history.back(); // fires hashchange itself
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } else {
      window.history.pushState({ page: p }, '', `#${p}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
    if (!keepScroll) window.scrollTo({ top: 0 });
  }, []);
  return [page, go];
}
