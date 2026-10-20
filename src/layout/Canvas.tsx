import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { useToasts } from '../components/Toasts';
import { GAP, canvasZoom, extent, moveBox, parseLayout, resizeBox, toFront, type Box, type CanvasLayout, type Edge } from '../lib/canvas';
import { clearLegacy, legacyLayout, useSharedLayout } from './useSharedLayout';

// Free canvas: the tablet and desktop cards can be dragged anywhere and resized
// to any size (no grid). Until the owner arranges them, the cards sit in the
// usual columns. Arranging is a mode (the top bar's arrange button), so taps
// and slides on the cards never move them by accident.
//
// One layout is shared by every device and both layouts (useSharedLayout): it
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

const EDGES: { cls: string; edge: Edge }[] = [
  { cls: 'n', edge: { t: true } },
  { cls: 's', edge: { b: true } },
  { cls: 'e', edge: { r: true } },
  { cls: 'w', edge: { l: true } },
  { cls: 'ne', edge: { t: true, r: true } },
  { cls: 'nw', edge: { t: true, l: true } },
  { cls: 'se', edge: { b: true, r: true } },
  { cls: 'sw', edge: { b: true, l: true } },
];

const EDGE_ZONE = 56; // px from the visible edge where a drag scrolls the page
const EDGE_STEP = 16;
const ROOM = 400; // extra space below the cards while arranging, to drag into

export function FreeCanvas({ name, className, columns }: { name: string; className: string; columns: CardDef[][] }) {
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
  const [dragging, setDragging] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const stored = useMemo(() => parseLayout(shared.data, idsKey.split(',')), [shared.data, idsKey]);
  const layout = editing ? (draft ?? stored) : stored;
  const z = layout ? canvasZoom(mainWidth, layout) : 1;

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
    if (editing && !draft && mainRef.current) setDraft(stored ?? measure(mainRef.current, idsKey.split(',')));
  }, [editing, draft, stored, idsKey]);

  // This device's layout from before layouts were shared: hand it to HA once,
  // if HA has never had one.
  const { known, data, save } = shared;
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
        (e as { code?: string }).code === 'unauthorized'
          ? 'Saving the layout needs an admin login. Other devices keep the old layout.'
          : 'Other devices keep the old layout; move a card again to retry.',
    });

  // Every change is saved when the drag ends (not on each move), so a reload
  // mid-arrange loses nothing and other screens follow along.
  useEffect(() => {
    if (editing && changed && draft && !dragging) save(draft).catch(failed);
  }, [editing, changed, draft, dragging]); // not on `failed`: it's new every render

  // Canvas size for scrolling: cards that fit their content change height on their own.
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main || !layout) return;
    const slots = [...main.querySelectorAll<HTMLElement>('.card-slot')];
    const height = (id: string) => slots.find((s) => s.dataset.card === id)?.offsetHeight ?? 0;
    const update = () =>
      setSize((s) => {
        const e = extent(layout, height);
        return s.w === e.w && s.h === e.h ? s : e;
      });
    update();
    const ro = new ResizeObserver(update);
    slots.forEach((s) => ro.observe(s));
    return () => ro.disconnect();
  }, [layout]);

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
    const scrolled = () => ({ x: main.scrollLeft + window.scrollX, y: main.scrollTop + window.scrollY });
    const start = { px: e.clientX, py: e.clientY, s: scrolled() };
    setDragging(id);
    update((l) => ({ ...l, order: toFront(l.order, id) }));

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
      setBox(id, edge ? resizeBox(box, height, edge, dx, dy) : moveBox(box, dx, dy));
    };
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      setDragging(null);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  // Arrow keys nudge the focused card (Shift: 1 px instead of 10).
  const onKey = (e: React.KeyboardEvent, id: string) => {
    const step = e.shiftKey ? 1 : 10;
    const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] } as Record<string, number[]>)[e.key];
    const box = layout?.boxes[id];
    if (!d || !box) return;
    e.preventDefault();
    setBox(id, moveBox(box, d[0], d[1]));
  };

  const canvas = !!layout;
  const zIndex = (id: string) => (layout ? layout.order.indexOf(id) + 1 : undefined);

  return (
    <>
      <main
        ref={mainRef}
        className={`${className} ${canvas ? 'canvas' : ''} ${canvas && editing ? 'editing' : ''}`}
        style={canvas ? ({ '--z': z } as React.CSSProperties) : undefined}
      >
        {columns.map((col, i) => (
          <div className="col" key={i}>
            {col.map((card) => {
              const box = layout?.boxes[card.id];
              return (
                <div
                  key={card.id}
                  className={`card-slot ${box?.h !== undefined ? 'fixed-h' : ''} ${dragging === card.id ? 'dragging' : ''}`}
                  data-card={card.id}
                  style={
                    box
                      ? {
                          left: box.x * z,
                          top: box.y * z,
                          width: box.w,
                          height: box.h,
                          zIndex: zIndex(card.id),
                          transform: z !== 1 ? `scale(${z})` : undefined,
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
                          <button onPointerDown={(e) => e.stopPropagation()} onClick={() => setBox(card.id, { x: box.x, y: box.y, w: box.w })}>
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
        {canvas && <div className="canvas-extent" style={{ width: size.w * z, height: (size.h + (editing ? ROOM : GAP)) * z }} />}
      </main>
      {editing && (
        <ArrangeBar
          onDone={finish}
          onReset={() => {
            // Back to the columns everywhere; measured again here while arranging.
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
