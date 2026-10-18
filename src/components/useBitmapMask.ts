import { useEffect, useState } from 'react';

// The page sky's cloud masks are SVGs with filters (fractal noise, lighting).
// Used directly as CSS masks, the browser re-runs those filters for every tile
// it rasterises, and a drifting layer keeps exposing new tiles, so frames
// stall now and then. Drawing each SVG once into a canvas and using the PNG
// instead makes the mask a plain bitmap.
//
// Results are cached by SVG (a few entries; the oldest blob URL is freed).

const cache = new Map<string, Promise<string>>();
const MAX = 12;

function rasterize(cssUrl: string, w: number, h: number): Promise<string> {
  const key = `${w}x${h} ${cssUrl}`;
  let p = cache.get(key);
  if (p) return p;
  p = (async () => {
    const img = new Image();
    img.src = cssUrl.slice(5, -2); // url("…") → the data URI
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')?.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve));
    return blob ? `url("${URL.createObjectURL(blob)}")` : cssUrl;
  })().catch(() => cssUrl); // fall back to the SVG itself
  cache.set(key, p);
  if (cache.size > MAX) {
    const [oldKey, old] = cache.entries().next().value as [string, Promise<string>];
    cache.delete(oldKey);
    void old.then((u) => u.startsWith('url("blob:') && URL.revokeObjectURL(u.slice(5, -2)));
  }
  return p;
}

// The bitmap for an SVG mask (a CSS `url(...)`), at w × h px. Until the first
// one is ready it returns undefined; when the SVG changes it keeps returning
// the previous bitmap until the new one is ready, so nothing blinks.
export function useBitmapMask(cssUrl: string, w: number, h: number): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let live = true;
    void rasterize(cssUrl, w, h).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [cssUrl, w, h]);
  return url;
}
