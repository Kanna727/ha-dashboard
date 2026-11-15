import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { useToasts } from '../components/Toasts';
import {
  GAP,
  SNAP,
  canvasZoom,
  extent,
  moveBox,
  overlapsX,
  pageLayout,
  parseLayout,
  resizeBox,
  snapMove,
  snapResize,
  stack,
  toFront,
  withPageLayout,
  type Box,
  type CanvasLayout,
  type Edge,
} from '../lib/canvas';
import { clearLegacy, legacyLayout, useSharedLayout } from './useSharedLayout';

// Free canvas: the tablet and desktop cards can be dragged anywhere and resized
// to any size (no grid). Until the owner arranges them, the cards sit in the
// usual columns. Arranging is a mode (the top bar's arrange button), so taps
// and slides on the cards never move them by accident.
//
// Cards keep a constant gap (lib/canvas.ts `stack`): each sits one gap below
// the card above it, so when a card grows or shrinks (more energy rows, the
// commute's best time) the cards under it move with it. Sideways, edges snap a
// gap away from their neighbours.
//
// Each page's layout is shared by every device and both layouts (useSharedLayout): it
// is kept at the canvas width it was arranged at, and each screen zooms it to
// its own width (each card is scaled from its top-left corner).
//
// The columns stay in the DOM in both modes (`display: contents` on a canvas),
// so switching never remounts a panel (no refetches, no lost state).

const ArrangeContext = createContext<{ editing: boolean; setEditing: (on: boolean) => void } | null>(null);

export function ArrangeProvider({ children }: { children: ReactNode }) {
  const [editing, setEditing] = useState(false);
  return <ArrangeContext.Provider value={{ editing, setEditing }}>{children}</ArrangeContext.Provider>;
}

export const useArranging = () => useContext(ArrangeContext)?.editing ?? false;

// Top-bar button; renders nothing outside a canvas layout (the phone).
export function ArrangeButton() {
  const arrange = useContext(ArrangeContext);
  if (!arrange) return null;
  const label = arrange.editing ? 'Done arranging' : 'Arrange cards';
  return (
    <button
      className={`pill icon-pill arrange-btn ${arrange.editing ? 'active' : ''}`}
      onClick={() => arrange.setEditing(!arrange.editing)}
      aria-pressed={arrange.editing}
      aria-label={label}
      title={label}
    >
      <Icon name="arrange" size={22} />
    </button>
  );
}

export interface CardDef {
  id: string;
  label: string;
  node: ReactNode;
}

// Where every card is in the column layout, as canvas boxes (content-sized).
function measure(main: HTMLElement, ids: string[]): CanvasLayout {
  const m = main.getBoundingClientRect();
  const boxes: Record<string, Box> = {};
  main.querySelectorAll<HTMLElement>('.card-slot').forEach((slot) => {
    const r = slot.getBoundingClientRect();
    const col = slot.parentElement!; // tablet columns scroll on their own
    boxes[slot.dataset.card!] = {
      x: Math.max(0, Math.round(r.left - m.left + col.scrollLeft)),
      y: Math.max(0, Math.round(r.top - m.top + col.scrollTop)),
      w: Math.round(r.width),
    };
  });
  return { width: main.clientWidth, boxes, order: ids.filter((id) => id in boxes) };
}

// No top handles: a card's top is where the stack puts it.
const EDGES: { cls: string; edge: Edge }[] = [
  { cls: 's', edge: { b: true } },
  { cls: 'e', edge: { r: true } },
  { cls: 'w', edge: { l: true } },
  { cls: 'se', edge: { b: true, r: true } },
  { cls: 'sw', edge: { b: true, l: true } },
];

const EDGE_ZONE = 56; // px from the visible edge where a drag scrolls the page
const EDGE_STEP = 16;
const ROOM = 400; // extra space below the cards while arranging, to drag into

// `page`: which page's layout this is (each page is arranged on its own).
export function FreeCanvas({ name, page, className, columns }: { name: string; page: string; className: string; columns: CardDef[][] }) {
  const arrange = useContext(ArrangeContext);
  const editing = arrange?.editing ?? false;
  const shared = useSharedLayout();
  const toasts = useToasts();
  const idsKey = columns
    .flat()
    .map((c) => c.id)
    .join(',');

  const mainRef = useRef<HTMLElement>(null);
  const [mainWidth, setMainWidth] = useState(0);
  // While arranging: the layout being edited (null until there is one to edit).
  const [draft, setDraft] = useState<CanvasLayout | null>(null);
  const [changed, setChanged] = useState(false);
  const [dragging, setDragging] = useState<{ id: string; move: boolean } | null>(null);
  // Each card's rendered height (unscaled), for stacking.
  const [heights, setHeights] = useState<Record<string, number>>({});
  const heightsRef = useRef(heights);
  heightsRef.current = heights;
  // Cards glide to new places only once the first heights are in (no slide on load).
  const [settled, setSettled] = useState(false);

  const stored = useMemo(() => parseLayout(pageLayout(shared.data, page), idsKey.split(',')), [shared.data, page, idsKey]);
  const layout = editing ? (draft ?? stored) : stored;
  const z = layout ? canvasZoom(mainWidth, layout) : 1;
  // Where the cards are shown: stacked with a constant gap. A card being moved
  // follows the pointer, and the others make room where it would land.
  const shown = useMemo(() => (layout ? stack(layout.boxes, (id) => heights[id] ?? 0) : null), [layout, heights]);
  const restack = (boxes: Record<string, Box>) => stack(boxes, (id) => heightsRef.current[id] ?? 0);

  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const update = () => setMainWidth(main.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(main);
    return () => ro.disconnect();
  }, []);

  // Entering arrange mode: edit the shared layout, or freeze the columns where they are.
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!editing || draft || !main) return;
    if (stored) setDraft(stored);
    else if (main.clientWidth > 0) setDraft(measure(main, idsKey.split(','))); // not while hidden: nothing to measure
  }, [editing, draft, stored, idsKey]);

  // This device's layout from before layouts were shared: hand it to HA once,
  // if HA has never had one.
  const { known, data } = shared;
  // Saves this page's layout into the shared document, keeping the other pages'.
  const latest = useRef(shared);
  latest.current = shared;
  const save = useCallback((l: object) => latest.current.save((current) => withPageLayout(current, page, l)), [page]);
  useEffect(() => {
    if (!known || data !== null || editing) return;
    const old = parseLayout(legacyLayout(name), idsKey.split(','), mainRef.current?.clientWidth ?? 0);
    if (old) save(old).then(clearLegacy, () => undefined);
  }, [known, data, save, editing, name, idsKey]);

  const failed = (e: unknown) =>
    toasts.push({
      id: 'layout-save',
      icon: 'alert',
      tone: 'warn',
      title: 'Layout not saved to Home Assistant',
      text:
        ['unauthorized', 'not-admin'].includes((e as { code?: string }).code ?? '')
          ? 'Saving the layout needs an admin login. Other devices keep the old layout.'
          : 'Other devices keep the old layout; move a card again to retry.',
    });

  // Every change is saved when the drag ends (not on each move), so a reload
  // mid-arrange loses nothing and other screens follow along.
  useEffect(() => {
    if (editing && changed && draft && !dragging) save(draft).catch(failed);
  }, [editing, changed, draft, dragging]); // not on `failed`: it's new every render

  // Cards that fit their content change height on their own; the stack follows.
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const slots = [...main.querySelectorAll<HTMLElement>('.card-slot')];
    const update = () =>
      setHeights((prev) => {
        const next: Record<string, number> = {};
        slots.forEach((s) => (next[s.dataset.card!] = s.offsetHeight)); // unscaled, like the layout
        return slots.every((s) => prev[s.dataset.card!] === next[s.dataset.card!]) ? prev : next;
      });
    update();
    const ro = new ResizeObserver(update);
    slots.forEach((s) => ro.observe(s));
    return () => ro.disconnect();
  }, [idsKey]);

  useEffect(() => {
    if (!layout || settled) return;
    const id = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(id);
  }, [layout, settled]);

  const finish = () => {
    setDraft(null);
    setChanged(false);
    arrange?.setEditing(false);
  };

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && finish();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const update = (fn: (l: CanvasLayout) => CanvasLayout) => {
    setDraft((d) => (d ? fn(d) : d));
    setChanged(true);
  };
  const setBox = (id: string, box: Box) => update((l) => ({ ...l, boxes: { ...l.boxes, [id]: box } }));

  const startDrag = (e: React.PointerEvent<HTMLElement>, id: string, edge?: Edge) => {
    const main = mainRef.current;
    const box = layout?.boxes[id];
    if (!main || !box || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const height = (el.closest('.card-slot') as HTMLElement).offsetHeight; // unscaled, like the layout
    const from = shown?.[id] ?? box;
    const others = Object.entries(shown ?? {}).flatMap(([o, b]) => (o === id ? [] : [b]));
    const width = layout!.width;
    const scrolled = () => ({ x: main.scrollLeft + window.scrollX, y: main.scrollTop + window.scrollY });
    const start = { px: e.clientX, py: e.clientY, s: scrolled() };
    setDragging({ id, move: !edge });
    update((l) => ({ ...l, order: toFront(l.order, id), boxes: { ...l.boxes, [id]: from } }));

    // Near the visible edge of the canvas, scroll it (or the page) along.
    const autoScroll = (ev: PointerEvent) => {
      const r = main.getBoundingClientRect();
      const top = Math.max(r.top, 0);
      const bottom = Math.min(r.bottom, window.innerHeight);
      const left = Math.max(r.left, 0);
      const right = Math.min(r.right, window.innerWidth);
      const dy = ev.clientY > bottom - EDGE_ZONE ? EDGE_STEP : ev.clientY < top + EDGE_ZONE ? -EDGE_STEP : 0;
      const dx = edge && !edge.r ? 0 : ev.clientX > right - EDGE_ZONE ? EDGE_STEP : ev.clientX < left + EDGE_ZONE ? -EDGE_STEP : 0;
      if (!dx && !dy) return;
      const before = scrolled();
      main.scrollBy(dx, dy);
      const after = scrolled();
      if (after.x === before.x && after.y === before.y) window.scrollBy(dx, dy);
    };

    // Screen px back to layout px: the canvas is zoomed by z.
    const move = (ev: PointerEvent) => {
      autoScroll(ev);
      const s = scrolled();
      const dx = (ev.clientX - start.px + s.x - start.s.x) / z;
      const dy = (ev.clientY - start.py + s.y - start.s.y) / z;
      const next = edge
        ? snapResize(resizeBox(from, height, edge, dx, dy), edge, others, width, SNAP / z)
        : snapMove(moveBox(from, dx, dy), others, width, SNAP / z);
      setBox(id, next);
    };
    // Drop: the card takes its place in the stack.
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      update((l) => ({ ...l, boxes: restack(l.boxes) }));
      setDragging(null);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  // Arrow keys: left/right nudge the focused card (Shift: 1 px instead of 10);
  // up/down move it past the card above or below it in its stack.
  const onKey = (e: React.KeyboardEvent, id: string) => {
    const cur = shown?.[id];
    if (!shown || !cur) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = (e.shiftKey ? 1 : 10) * (e.key === 'ArrowLeft' ? -1 : 1);
      update((l) => ({ ...l, boxes: restack({ ...shown, [id]: moveBox(cur, step, 0) }) }));
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const up = e.key === 'ArrowUp';
      const near = Object.entries(shown)
        .filter(([o, b]) => o !== id && overlapsX(b, cur) && (up ? b.y < cur.y : b.y > cur.y))
        .sort(([, a], [, b]) => (up ? b.y - a.y : a.y - b.y))[0]?.[1];
      if (near) update((l) => ({ ...l, boxes: restack({ ...shown, [id]: { ...cur, y: up ? near.y - 1 : near.y + 1 } }) }));
    }
  };

  const ext = shown ? extent({ boxes: shown }, (id) => heights[id] ?? 0) : { w: 0, h: 0 };

  const canvas = !!layout;
  const zIndex = (id: string) => (layout ? layout.order.indexOf(id) + 1 : undefined);

  return (
    <>
      <main
        ref={mainRef}
        className={`${className} ${canvas ? 'canvas' : ''} ${canvas && editing ? 'editing' : ''} ${settled ? 'settled' : ''}`}
        style={canvas ? ({ '--z': z } as React.CSSProperties) : undefined}
      >
        {columns.map((col, i) => (
          <div className="col" key={i}>
            {col.map((card) => {
              const held = dragging?.id === card.id;
              // The moved card follows the pointer; every other card sits in the stack.
              const box = held && dragging.move ? layout?.boxes[card.id] : shown?.[card.id];
              return (
                <div
                  key={card.id}
                  className={`card-slot ${box?.h !== undefined ? 'fixed-h' : ''} ${held ? 'dragging' : ''}`}
                  data-card={card.id}
                  style={
                    box
                      ? {
                          width: box.w,
                          height: box.h,
                          zIndex: zIndex(card.id),
                          transform: `translate(${box.x * z}px, ${box.y * z}px)${z !== 1 ? ` scale(${z})` : ''}`,
                        }
                      : undefined
                  }
                >
                  {card.node}
                  {canvas && editing && box && (
                    <>
                      <div
                        className="card-grip"
                        role="button"
                        tabIndex={0}
                        aria-label={`Move ${card.label}`}
                        onPointerDown={(e) => startDrag(e, card.id)}
                        onKeyDown={(e) => onKey(e, card.id)}
                      />
                      <div className="card-badge">
                        <Icon name="move" size={16} />
                        <span>{card.label}</span>
                        <small>
                          {box.w} × {box.h ?? 'auto'}
                        </small>
                        {box.h !== undefined && (
                          <button
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={() => update((l) => ({ ...l, boxes: restack({ ...l.boxes, [card.id]: { x: box.x, y: box.y, w: box.w } }) }))}
                          >
                            Fit height
                          </button>
                        )}
                      </div>
                      {EDGES.map(({ cls, edge }) => (
                        <div key={cls} className={`card-handle h-${cls}`} aria-hidden="true" onPointerDown={(e) => startDrag(e, card.id, edge)} />
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {dragging?.move && shown?.[dragging.id] && (
          <div
            className="card-drop"
            style={{
              width: shown[dragging.id].w * z,
              height: (shown[dragging.id].h ?? heights[dragging.id] ?? 0) * z,
              transform: `translate(${shown[dragging.id].x * z}px, ${shown[dragging.id].y * z}px)`,
            }}
          />
        )}
        {canvas && <div className="canvas-extent" style={{ width: ext.w * z, height: (ext.h + (editing ? ROOM : GAP)) * z }} />}
      </main>
      {editing && (
        <ArrangeBar
          onDone={finish}
          onReset={() => {
            // This page back to its columns on every screen; measured again here while arranging.
            save({}).catch(failed);
            setDraft(null);
            setChanged(false);
          }}
        />
      )}
    </>
  );
}

function ArrangeBar({ onDone, onReset }: { onDone: () => void; onReset: () => void }) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const id = window.setTimeout(() => setConfirm(false), 4000);
    return () => window.clearTimeout(id);
  }, [confirm]);
  return (
    <div className="arrange-bar" role="toolbar" aria-label="Arrange cards">
      <span className="arrange-hint">Drag a card to move it · drag its edges or corners to resize</span>
      <button
        className={`arrange-reset ${confirm ? 'confirm' : ''}`}
        onClick={() => {
          if (!confirm) return setConfirm(true);
          setConfirm(false);
          onReset();
        }}
      >
        <Icon name="restore" size={18} />
        {confirm ? 'Tap again to reset' : 'Reset'}
      </button>
      <button className="arrange-done" onClick={onDone}>
        <Icon name="tick" size={18} />
        Done
      </button>
    </div>
  );
}
