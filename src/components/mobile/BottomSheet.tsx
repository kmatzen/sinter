import { useRef, useEffect, useState, useCallback } from 'react';
import { GripHorizontal } from 'lucide-react';

interface Props {
  onClose: () => void;
  children: React.ReactNode;
}

const MIN_HEIGHT = 100;   // below this → dismiss
const MAX_VH = 0.85;      // maximum height as fraction of viewport

/** Snap points as fractions of viewport height */
const SNAPS = [0.33, 0.55, MAX_VH];

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
  const vh = typeof window !== 'undefined' ? window.innerHeight : 700;
  const snaps = getSnapHeights(vh);

  const [height, setHeight] = useState(snaps[0]);
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

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="md:hidden fixed inset-0 z-50" onClick={onClose}>
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
          className="flex items-center justify-center py-2 cursor-grab active:cursor-grabbing shrink-0"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ touchAction: 'none' }}
        >
          <GripHorizontal size={20} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
        </div>

        {/* Header */}
        <div className="px-4 pb-2 shrink-0">
          <span
            className="font-mono text-[10px] tracking-[0.15em] uppercase"
            style={{ color: 'var(--text-muted)' }}
          >
            Properties
          </span>
        </div>

        {/* Content */}
        <div ref={contentRef} className="flex-1 overflow-y-auto min-h-0">
          {children}
        </div>
      </div>
    </div>
  );
}
