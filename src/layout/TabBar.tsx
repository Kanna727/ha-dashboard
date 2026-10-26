import { Icon } from '../components/Icon';
import { useArranging } from './Canvas';
import type { Page, PAGES } from './pages';

// The floating tab bar at the bottom of every layout (the owner's pick on
// 2026-10-26, after a dark pill-shaped bar): icons only, and the current page
// in a lighter pill with its name. Hidden while cards are arranged (the
// arrange bar takes its place).
export function TabBar({ pages, current, onSelect }: { pages: typeof PAGES; current: Page; onSelect: (p: Page) => void }) {
  if (useArranging()) return null;
  return (
    <nav className="tabbar" aria-label="Pages">
      {pages.map((p) => {
        const here = p.id === current;
        return (
          <button key={p.id} className={`tab ${here ? 'active' : ''}`} onClick={() => onSelect(p.id)} aria-current={here ? 'page' : undefined} aria-label={p.label} title={p.label}>
            <Icon name={p.icon} size={22} />
            <span className="tab-label" aria-hidden>
              {p.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
