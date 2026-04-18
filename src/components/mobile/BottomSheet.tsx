import { useRef, useEffect, useState, useCallback } from 'react';
import { GripHorizontal } from 'lucide-react';

interface Props {
  onClose: () => void;
  children: React.ReactNode;
}

const PEEK_HEIGHT = 260;  // collapsed height
const MIN_HEIGHT = 120;   // minimum before dismissing
const MAX_VH = 0.85;      // maximum height as fraction of viewport

/**
 * Draggable bottom sheet for mobile.  Slides up from the bottom edge
 * with a drag handle.  Swipe down to dismiss.
 */
export function BottomSheet({ onClose, children }: Props) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(PEEK_HEIGHT);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ y: number; h: number } | null>(null);

  const maxHeight = typeof window !== 'undefined' ? window.innerHeight * MAX_VH : 600;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragStart.current = { y: e.clientY, h: height };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [height]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const dy = dragStart.current.y - e.clientY;
    const newH = Math.max(MIN_HEIGHT, Math.min(maxHeight, dragStart.current.h + dy));
    setHeight(newH);
  }, [maxHeight]);

  const onPointerUp = useCallback(() => {
    if (!dragStart.current) return;
    if (height < MIN_HEIGHT + 20) {
      onClose();
    }
    dragStart.current = null;
    setDragging(false);
  }, [height, onClose]);

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
        className="absolute inset-0 transition-opacity duration-200"
        style={{ background: `rgba(0,0,0,${Math.min(0.5, (height / PEEK_HEIGHT) * 0.3)})` }}
      />

      {/* Sheet */}
      <div
        ref={sheetRef}
        className="absolute bottom-0 left-0 right-0 flex flex-col rounded-t-xl"
        style={{
          height: `${height}px`,
          background: 'var(--bg-panel)',
          boxShadow: '0 -4px 20px rgba(0,0,0,0.25)',
          transition: dragging ? 'none' : 'height 0.2s ease-out',
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
        <div className="flex-1 overflow-y-auto min-h-0">
          {children}
        </div>
      </div>
    </div>
  );
}
