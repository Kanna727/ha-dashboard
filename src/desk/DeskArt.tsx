// A desk seen from the front, its top at the current height: the room card's
// chip icon, and the popup's picture when WebGL isn't available.
export function DeskArt({ height, min, max, size = 22, className }: { height?: number; min: number; max: number; size?: number; className?: string }) {
  const f = height === undefined ? 0 : Math.min(1, Math.max(0, (height - min) / (max - min)));
  const y = 13.5 - f * 9.5; // the top's upper edge, 24-unit box
  return (
    <svg className={`desk-art ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1.5" y={y} width="21" height="2.2" rx="0.8" className="desk-art-top" />
      <path d={`M5.2 ${y + 2.2} V21 M18.8 ${y + 2.2} V21`} className="desk-art-leg" />
      <path d="M2.8 21.3 H7.6 M16.4 21.3 H21.2" className="desk-art-foot" />
    </svg>
  );
}
