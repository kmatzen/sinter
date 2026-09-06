import { useRef, useEffect, useState, useCallback } from 'react';
import { GripHorizontal, X } from 'lucide-react';
import { useDialogFocus } from '../ui/useDialogFocus';

interface Props {
  onClose: () => void;
  children: React.ReactNode;
}

const MIN_HEIGHT = 100;   // below this → dismiss
const MAX_VH = 0.85;      // maximum height as fraction of viewport

/**
 * Snap points as fractions of viewport height.
 *
 * The sheet opens at index 1, not 0. At 33% the property panel showed its type
 * switcher and two and a half fields — for the surface where all editing
 * happens on a phone, that is a peek, not a panel. 55% shows a whole shape's
 * parameters without hiding the model it is describing.
 */
const SNAPS = [0.33, 0.55, MAX_VH];
const INITIAL_SNAP = 1;

function getSnapHeights(vh: number): number[] {
  return SNAPS.map((s) => Math.round(s * vh));
}

/** Find nearest snap point; if below minimum, return -1 (dismiss) */
function nearestSnap(h: number, snaps: number[]): number {
  if (h < MIN_HEIGHT) return -1;
  let best = snaps[0], bestDist = Math.abs(h - snaps[0]);
  for (let i = 1; i < snaps.length; i++) {
    const dist = Math.abs(h - snaps[i]);
    if (dist < bestDist) { best = snaps[i]; bestDist = dist; }
  }
  return best;
}

/**
 * Draggable bottom sheet for mobile with snap points and scroll handoff.
 * Swipe down to dismiss.  Content scroll transitions to sheet drag when
 * scrolled to the top.
 */
export function BottomSheet({ onClose, children }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useDialogFocus(sheetRef, onClose);
  /*
   * Tracked in state rather than read once at mount. The snap heights are
   * fractions of the viewport, and the viewport changes constantly on a phone —
   * rotation, the URL bar collapsing, the keyboard opening. A sheet holding
   * heights computed against the old viewport ends up either floating above the
   * bottom edge or taller than the screen.
   */
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 700));
  const snaps = getSnapHeights(vh);

  const [height, setHeight] = useState(snaps[INITIAL_SNAP]);
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ y: number; h: number; scrolling: boolean } | null>(null);

  // --- Handle drag ---
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragState.current = { y: e.clientY, h: height, scrolling: false };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [height]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    const dy = dragState.current.y - e.clientY;
    const newH = Math.max(0, Math.min(snaps[snaps.length - 1], dragState.current.h + dy));
    setHeight(newH);
  }, [snaps]);

  const onPointerUp = useCallback(() => {
    if (!dragState.current) return;
    dragState.current = null;
    setDragging(false);
    // Snap to nearest point or dismiss
    const snap = nearestSnap(height, snaps);
    if (snap < 0) { onClose(); return; }
    setHeight(snap);
  }, [height, snaps, onClose]);

  // --- Content scroll handoff ---
  // When the content is scrolled to the top and the user swipes down,
  // intercept the touch and start closing the sheet instead.
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    let touchStartY = 0;
    let intercepted = false;

    function onTouchStart(e: TouchEvent) {
      touchStartY = e.touches[0].clientY;
      intercepted = false;
    }

    function onTouchMove(e: TouchEvent) {
      if (intercepted) return;
      const dy = e.touches[0].clientY - touchStartY;
      // Swiping down while at top of scroll → start sheet drag
      if (dy > 5 && content!.scrollTop <= 0) {
        intercepted = true;
        e.preventDefault();
        dragState.current = { y: touchStartY, h: height, scrolling: true };
        setDragging(true);
      }
      if (intercepted && dragState.current) {
        const moveY = dragState.current.y - e.touches[0].clientY;
        const newH = Math.max(0, Math.min(snaps[snaps.length - 1], dragState.current.h + moveY));
        setHeight(newH);
      }
    }

    function onTouchEnd() {
      if (intercepted && dragState.current) {
        dragState.current = null;
        setDragging(false);
        const snap = nearestSnap(height, snaps);
        if (snap < 0) { onClose(); return; }
        setHeight(snap);
      }
      intercepted = false;
    }

    content.addEventListener('touchstart', onTouchStart, { passive: true });
    content.addEventListener('touchmove', onTouchMove, { passive: false });
    content.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      content.removeEventListener('touchstart', onTouchStart);
      content.removeEventListener('touchmove', onTouchMove);
      content.removeEventListener('touchend', onTouchEnd);
    };
  }, [height, snaps, onClose]);

  /*
   * Re-derive the snap heights when the viewport changes, and carry the sheet
   * to the equivalent snap rather than leaving it at a stale pixel height.
   *
   * The current viewport is read from a ref rather than from `vh` state so the
   * listener does not have to be torn down and rebound on every resize frame,
   * and so neither state updater has to read the other's value — an updater
   * that triggers a second update is not safe to run twice, which is exactly
   * what StrictMode does.
   */
  const vhRef = useRef(vh);
  useEffect(() => { vhRef.current = vh; }, [vh]);

  useEffect(() => {
    const onResize = () => {
      const next = window.innerHeight;
      const prev = vhRef.current;
      if (prev === next || next === 0) return;
      vhRef.current = next;
      setVh(next);
      setHeight((h) => {
        const fraction = h / prev;
        const nearest = SNAPS.reduce((best, s) =>
          Math.abs(s - fraction) < Math.abs(best - fraction) ? s : best, SNAPS[0]);
        return Math.round(nearest * next);
      });
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  return (
    <div className="lg:hidden fixed inset-0 z-50" onClick={onClose}>
      {/* Backdrop */}
      <div
        className="absolute inset-0"
        style={{
          background: `rgba(0,0,0,${Math.min(0.5, (height / snaps[0]) * 0.3)})`,
          transition: dragging ? 'none' : 'background 0.25s ease-out',
        }}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="properties-sheet-title"
        className="absolute bottom-0 left-0 right-0 flex flex-col rounded-t-xl"
        style={{
          height: `${height}px`,
          background: 'var(--bg-panel)',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.25)',
          transition: dragging ? 'none' : 'height 0.25s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle */}
        <div
          className="flex items-center justify-center py-2 tap-h cursor-grab active:cursor-grabbing shrink-0"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ touchAction: 'none' }}
        >
          <GripHorizontal size={20} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
        </div>

        {/*
          Header. The close button is not decoration: dismissal used to be
          swipe-down or backdrop-tap only, neither of which announces itself,
          and the backdrop is a thin strip once the sheet is open.
        */}
        <div className="px-4 pb-2 shrink-0 flex items-center justify-between gap-2">
          <span
            id="properties-sheet-title"
            className="font-mono text-[10px] tracking-[0.15em] uppercase"
            style={{ color: 'var(--text-muted)' }}
          >
            Properties
          </span>
          <button
            onClick={onClose}
            aria-label="Close properties"
            title="Close"
            className="tap flex items-center justify-center rounded -mr-2"
            style={{ color: 'var(--text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto min-h-0 pb-safe px-safe">
          {children}
        </div>
      </div>
    </div>
  );
}
