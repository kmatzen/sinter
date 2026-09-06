import { useEffect } from 'react';
import { X } from 'lucide-react';

interface Props {
  /**
   * Header title. Omit when the content renders its own header — the node tree
   * does, and rendering both stacked two identical "NODE TREE" bars on top of
   * each other, eating ~50px of a screen that has none to spare.
   */
  title?: string;
  side: 'left' | 'right';
  onClose: () => void;
  children: React.ReactNode;
}

/** Full-height slide-over panel for mobile viewports */
export function MobilePanel({ title, side, onClose, children }: Props) {
  // BottomSheet has always closed on Escape and this did not. Two mobile
  // containers with different dismiss rules is the kind of inconsistency that
  // surfaces the moment someone attaches a keyboard to a tablet.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="lg:hidden fixed inset-0 z-50 flex" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.5)' }} />

      {/* Panel */}
      <div
        className={`relative flex flex-col w-[85vw] max-w-[320px] h-full pb-safe ${side === 'right' ? 'ml-auto pr-safe' : 'pl-safe'}`}
        style={{ background: 'var(--bg-panel)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-3 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
            <span className="font-mono text-[10px] tracking-[0.15em] uppercase" style={{ color: 'var(--text-muted)' }}>
              {title}
            </span>
            <button onClick={onClose} aria-label={`Close ${title}`} style={{ color: 'var(--text-muted)' }}
                    className="hover:opacity-80 tap flex items-center justify-center">
              <X size={16} />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
