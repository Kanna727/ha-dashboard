import { useEffect, useRef, useState } from 'react';
import type { Calibration, VacRoom } from '../lib/vacuum';

export interface MapImage {
  url: string;
  w: number;
  h: number;
  // Room under each pixel (index into `rooms` + 1, 0 = none), from the map's
  // own room colours. null when the image can't be read (cross-origin in dev).
  labels: Uint8Array | null;
  rooms: VacRoom[];
}

// HA serves camera images under /api/...; `npm run dev` off-box talks to another origin.
export const absUrl = (p: string) => (p.startsWith('/') ? ((import.meta.env.VITE_HA_URL as string | undefined) ?? '') + p : p);

// Which pixels belong to which room. Each room's colour is the commonest
// saturated colour inside its box; its pixels are those of that colour in the
// box. Rooms can share a colour, but rooms of one colour never touch.
function label(img: HTMLImageElement, rooms: VacRoom[], cal: Calibration): Uint8Array | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  let px: Uint8ClampedArray;
  try {
    px = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null; // tainted canvas
  }
  const labels = new Uint8Array(w * h);
  rooms.slice(0, 254).forEach((room, k) => {
    const corners = [
      cal.toImg({ x: room.box[0], y: room.box[1] }),
      cal.toImg({ x: room.box[2], y: room.box[3] }),
    ];
    const x0 = Math.max(0, Math.floor(Math.min(corners[0].x, corners[1].x)) - 2);
    const x1 = Math.min(w - 1, Math.ceil(Math.max(corners[0].x, corners[1].x)) + 2);
    const y0 = Math.max(0, Math.floor(Math.min(corners[0].y, corners[1].y)) - 2);
    const y1 = Math.min(h - 1, Math.ceil(Math.max(corners[0].y, corners[1].y)) + 2);
    if (x1 <= x0 || y1 <= y0) return;
    const counts = new Map<number, number>();
    for (let y = y0; y <= y1; y += 2)
      for (let x = x0; x <= x1; x += 2) {
        const i = (y * w + x) * 4;
        const r = px[i], g = px[i + 1], b = px[i + 2];
        if (px[i + 3] < 200 || Math.max(r, g, b) - Math.min(r, g, b) < 40) continue; // greys, white, black, transparent
        const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    let best = -1;
    let n = 0;
    counts.forEach((c, key) => c > n && ((n = c), (best = key)));
    if (best < 0) return;
    const [cr, cg, cb] = [((best >> 8) & 15) * 16 + 8, ((best >> 4) & 15) * 16 + 8, (best & 15) * 16 + 8];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        if (labels[i]) continue;
        const j = i * 4;
        if (Math.abs(px[j] - cr) + Math.abs(px[j + 1] - cg) + Math.abs(px[j + 2] - cb) < 48) labels[i] = k + 1;
      }
  });
  return labels;
}

// Loads each new map image before showing it (no blank frame while the
// robot moves) and labels its rooms.
export function useMapImage(url: string | undefined, rooms: VacRoom[], cal: Calibration | null): MapImage | null {
  const [map, setMap] = useState<MapImage | null>(null);
  const latest = useRef({ rooms, cal });
  latest.current = { rooms, cal };
  const roomSig = rooms.map((r) => `${r.id}:${r.box.join(',')}`).join(';');

  useEffect(() => {
    if (!url) return setMap(null);
    let alive = true;
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (!alive) return;
      const { rooms: rs, cal: c } = latest.current;
      let labels: Uint8Array | null = null;
      try {
        labels = c && rs.length ? label(img, rs, c) : null;
      } catch {
        labels = null;
      }
      setMap({ url: img.src, w: img.naturalWidth, h: img.naturalHeight, labels, rooms: rs });
    };
    img.src = absUrl(url);
    return () => {
      alive = false;
    };
    // roomSig: relabel when rooms are renamed, merged or split, even if the URL hasn't changed yet.
  }, [url, roomSig]);

  return map;
}
