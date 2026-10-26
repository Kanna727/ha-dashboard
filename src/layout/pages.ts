import { useCallback, useSyncExternalStore } from 'react';
import type { IconName } from '../components/Icon';

// The dashboard's pages (the floating tab bar, layout/TabBar.tsx), kept in the
// URL hash (#energy) so the back button and a bookmarked kiosk URL both work.
// The home page has no hash. The owner picked the pages on 2026-10-26.
export type Page = 'home' | 'energy' | 'commute' | 'health' | 'clean';

export const PAGES: { id: Page; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'energy', label: 'Energy', icon: 'flash' },
  { id: 'commute', label: 'Commute', icon: 'car' },
  { id: 'health', label: 'Health', icon: 'heart' },
  { id: 'clean', label: 'Clean', icon: 'broom' },
];

// Older links and kiosk URLs: the vacuum page is part of Clean now.
const ALIASES: Record<string, Page> = { vacuum: 'clean' };

export function pageFromHash(hash: string): Page {
  const h = hash.replace(/^#/, '');
  return ALIASES[h] ?? PAGES.find((p) => p.id === h)?.id ?? 'home';
}

const read = (): Page => pageFromHash(window.location.hash);

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

// `keepScroll`: a swipe lines the page up itself (layout/Pager.tsx).
// History: home → a page adds an entry; page → page replaces it, so Back
// always returns to the home page.
export function usePage(): [Page, (p: Page, keepScroll?: boolean) => void] {
  const page = useSyncExternalStore(subscribe, read);
  const go = useCallback((p: Page, keepScroll = false) => {
    if (p === read()) return;
    // `fromHome`: this entry was pushed on top of the home page (not a page opened by its URL).
    const fromHome = !!window.history.state?.fromHome;
    if (p === 'home') {
      if (fromHome) return window.history.back(); // fires hashchange itself
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } else if (read() === 'home') {
      window.history.pushState({ page: p, fromHome: true }, '', `#${p}`);
    } else {
      window.history.replaceState({ page: p, fromHome }, '', `#${p}`);
    }
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    if (!keepScroll) window.scrollTo({ top: 0 });
  }, []);
  return [page, go];
}
