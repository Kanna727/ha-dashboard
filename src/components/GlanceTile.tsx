import type { ReactNode } from 'react';
import { usePage, type Page } from '../layout/pages';
import { Icon, type IconName } from './Icon';

// One tile of the Home page's "At a glance" panel (panels/GlancePanel.tsx).
// Read from across the room (the owner's wall tablet, 5–6 ft away), so each
// tile leads with something visible from there, like the room chips: a big
// number, a fill (`level`, 0–100, from the left in `fill`), a ring or a strip
// (`foot`), and colour (`tone`). The label and `sub` are for up close.
// A tap opens the page the tile summarises.
// `text`: the value is words (a dish, a state), drawn smaller.
// `span`: 'all' takes a whole row, 2 two columns.
export function GlanceTile({
  icon,
  label,
  value,
  unit,
  sub,
  art,
  foot,
  level,
  fill,
  tone,
  page,
  onOpen,
  span,
  text,
  color,
  className = '',
}: {
  icon: IconName;
  label: ReactNode;
  value?: ReactNode;
  unit?: string;
  sub?: ReactNode;
  art?: ReactNode;
  foot?: ReactNode;
  level?: number;
  fill?: string;
  tone?: 'ok' | 'warn' | 'bad' | 'active';
  page: Page;
  onOpen?: () => void;
  span?: 2 | 'all';
  text?: boolean;
  color?: string;
  className?: string;
}) {
  const [, go] = usePage();
  const filled = level !== undefined && Number.isFinite(level);
  return (
    <button
      className={`glance-tile ${tone ? `tone-${tone}` : ''} ${span ? `span-${span}` : ''} ${filled ? 'filled' : ''} ${className}`}
      style={{
        ...(color ? { ['--gc' as string]: color } : {}),
        ...(fill ? { ['--fc' as string]: fill } : {}),
        ...(filled ? { ['--level' as string]: `${Math.max(0, Math.min(100, level!))}%` } : {}),
      }}
      onClick={() => {
        onOpen?.();
        go(page);
      }}
    >
      <span className="glance-label">
        <Icon name={icon} size={17} />
        <span className="ellipsis">{label}</span>
      </span>
      <span className="glance-body">
        <span className="glance-main">
          {value !== undefined && (
            <span className={`glance-value ${text ? 'text' : ''}`}>
              {value}
              {unit && <small>{unit}</small>}
            </span>
          )}
          {sub && <span className="glance-sub">{sub}</span>}
        </span>
        {art && <span className="glance-art">{art}</span>}
      </span>
      {foot && <span className="glance-foot">{foot}</span>}
    </button>
  );
}

// A filled bar for a tile's foot: an icon, a word or number, and a fill from
// the left (like the room chips), e.g. the dishwasher's progress.
export function GlanceBar({ icon, label, level, color, active }: { icon: IconName; label: ReactNode; level?: number; color: string; active?: boolean }) {
  return (
    <span className={`glance-bar ${active ? 'active' : ''}`} style={{ ['--fc' as string]: color, ['--level' as string]: `${Math.max(0, Math.min(100, level ?? 0))}%` }}>
      <Icon name={icon} size={20} />
      <span className="ellipsis">{label}</span>
    </span>
  );
}

// A ring for a tile (a person's recovery): the value in the middle.
export function GlanceRing({ pct, color, children, size = 64 }: { pct: number; color: string; children: ReactNode; size?: number }) {
  const r = 26;
  const len = 2 * Math.PI * r;
  return (
    <span className="glance-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" aria-hidden>
        <circle cx="32" cy="32" r={r} className="glance-ring-track" />
        <circle cx="32" cy="32" r={r} className="glance-ring-arc" style={{ stroke: color, strokeDasharray: `${(len * Math.max(0, Math.min(100, pct))) / 100} ${len}` }} />
      </svg>
      <span>{children}</span>
    </span>
  );
}
