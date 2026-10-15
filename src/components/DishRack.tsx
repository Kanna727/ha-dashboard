import { useId } from 'react';
import { grimeOpacity, smudgeOpacity } from '../lib/dishes';

// Food smudges: [cx, cy, rx, ry, rotation, gone at %, tone]. Each sits on the
// part of its dish that isn't hidden behind the next one, and is drawn right
// after that dish so the dishes in front cover it.
type Smudge = [number, number, number, number, number, number, 'curry' | 'gravy' | 'turmeric' | 'film'];
const PLATE_1: Smudge[] = [[11, 27, 4.5, 3, -25, 30, 'curry'], [13, 41, 3.5, 2.2, 20, 75, 'gravy']];
const PLATE_2: Smudge[] = [[27, 29, 5, 3, 10, 55, 'curry'], [31, 46, 3, 2, 0, 20, 'gravy'], [25, 39, 2, 1.6, 0, 88, 'turmeric']];
const PLATE_3: Smudge[] = [[53, 30, 5.5, 3.5, -15, 92, 'curry'], [61, 43, 4, 2.4, 25, 40, 'gravy'], [48, 41, 2, 1.6, 0, 65, 'turmeric']];
const BOWL: Smudge[] = [[80, 48, 5, 2.6, 0, 85, 'curry'], [89, 51, 3, 1.8, 0, 35, 'gravy']];
const GLASS: Smudge[] = [[106, 31, 1.6, 4, 0, 60, 'film'], [110, 45, 1.4, 3, 0, 95, 'film']];
// Sparkles for the finished shine: [x, y, scale].
const SPARKLES: [number, number, number][] = [[14, 20, 1], [42, 24, 0.75], [60, 30, 0.9], [84, 45, 0.7], [108, 27, 0.85], [30, 47, 0.6]];

const BOWL_BODY = 'M70 41Q70 56 83 56Q96 56 96 41Z';
const GLASS_BODY = 'M101 20L115 20L113.2 56L102.8 56Z';

function Smudges({ list, pct }: { list: Smudge[]; pct: number }) {
  return (
    <>
      {list.map(([cx, cy, rx, ry, rot, gone, tone], i) => (
        <ellipse key={i} className={`smudge ${tone}`} cx={cx} cy={cy} rx={rx} ry={ry} transform={`rotate(${rot} ${cx} ${cy})`} style={{ opacity: smudgeOpacity(gone, pct) }} />
      ))}
    </>
  );
}

// Dishes standing in the dishwasher rack, drawn behind the dishwasher's room
// card. While a cycle runs they start dirty and come clean as `pct` rises,
// with a rinse of water sweeping across them; once it's done (`shining`) they
// glint and sparkle. See "Ambient room-card motion" in AGENTS.md.
export function DishRack({ pct, shining }: { pct: number; shining: boolean }) {
  const clip = `dishes-${useId().replace(/:/g, '')}`;
  return (
    <span className={`dish-rack ${shining ? 'shine' : 'washing'}`} aria-hidden="true">
      <svg viewBox="0 0 120 60">
        <defs>
          <clipPath id={clip}>
            <circle cx="24" cy="33" r="22" />
            <circle cx="40" cy="35" r="20" />
            <circle cx="56" cy="37" r="18" />
            <path d={BOWL_BODY} />
            <ellipse cx="83" cy="41" rx="13" ry="3" />
            <path d={GLASS_BODY} />
          </clipPath>
        </defs>
        <g className="rack">
          {Array.from({ length: 13 }, (_, i) => <line key={i} x1={6 + i * 9} y1="57" x2={6 + i * 9} y2="47" />)}
          <line x1="2" y1="57" x2="118" y2="57" />
        </g>
        <circle className="dish" cx="24" cy="33" r="22" />
        <circle className="rim" cx="24" cy="33" r="15" />
        <Smudges list={PLATE_1} pct={pct} />
        <circle className="dish" cx="40" cy="35" r="20" />
        <circle className="rim" cx="40" cy="35" r="13.5" />
        <Smudges list={PLATE_2} pct={pct} />
        <circle className="dish" cx="56" cy="37" r="18" />
        <circle className="rim" cx="56" cy="37" r="12" />
        <Smudges list={PLATE_3} pct={pct} />
        <path className="dish" d={BOWL_BODY} />
        <ellipse className="dish inner" cx="83" cy="41" rx="13" ry="3" />
        <Smudges list={BOWL} pct={pct} />
        <path className="dish glass" d={GLASS_BODY} />
        <ellipse className="rim" cx="108" cy="20" rx="7" ry="1.8" />
        <Smudges list={GLASS} pct={pct} />
        <g clipPath={`url(#${clip})`}>
          <rect className="grime" x="0" y="0" width="120" height="60" style={{ opacity: shining ? 0 : grimeOpacity(pct) }} />
          <rect className="gleam" x="-24" y="-4" width="12" height="68" />
        </g>
        {shining &&
          SPARKLES.map(([x, y, s], i) => (
            <g key={i} transform={`translate(${x} ${y}) scale(${s})`}>
              <path className="sparkle" d="M0-7L1.6-1.6L7 0L1.6 1.6L0 7L-1.6 1.6L-7 0L-1.6-1.6Z" style={{ animationDelay: `${(-i * 0.43).toFixed(2)}s` }} />
            </g>
          ))}
      </svg>
    </span>
  );
}
