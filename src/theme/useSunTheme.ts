import { useEffect, useLayoutEffect, useState } from 'react';
import { useEntity } from '../ha/store';
import { SUN } from '../config/entities';

export type ThemeMode = 'auto' | 'dark' | 'light';
const KEY = 'dashTheme';
const ORDER: ThemeMode[] = ['auto', 'dark', 'light'];

// Auto mode follows sun.sun: light while above the horizon, dark after sunset.
export function useSunTheme() {
  const sun = useEntity(SUN);
  // ?theme=dark|light|auto pins a kiosk; otherwise the last manual choice wins.
  const [mode, setMode] = useState<ThemeMode>(() => {
    const forced = new URLSearchParams(window.location.search).get('theme') as ThemeMode | null;
    if (forced && ORDER.includes(forced)) return forced;
    return (localStorage.getItem(KEY) as ThemeMode) || 'auto';
  });

  const resolved: 'dark' | 'light' =
    mode === 'auto' ? (sun?.state === 'above_horizon' ? 'light' : 'dark') : mode;

  // Layout effect so the first paint already has the right palette.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
    localStorage.setItem('dashThemeResolved', resolved); // read by the pre-paint script in index.html
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#0b0f17' : '#eef1f6');
  }, [resolved]);

  // Only animate sunrise/sunset flips, not the initial load.
  useEffect(() => {
    const id = window.setTimeout(() => document.documentElement.classList.add('theme-anim'), 1000);
    return () => window.clearTimeout(id);
  }, []);

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    localStorage.setItem(KEY, next);
    setMode(next);
  };

  return { mode, resolved, cycle };
}
