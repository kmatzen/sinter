import { X } from 'lucide-react';

interface Props {
  title: string;
  side: 'left' | 'right';
  onClose: () => void;
  children: React.ReactNode;
}

/** Full-height slide-over panel for mobile viewports */
export function MobilePanel({ title, side, onClose, children }: Props) {
  return (
    <div className="md:hidden fixed inset-0 z-50 flex" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0" style={{ background: 'rgba(0,0,0,0.5)' }} />

      {/* Panel */}
      <div
        className={`relative flex flex-col w-[85vw] max-w-[320px] h-full ${side === 'right' ? 'ml-auto' : ''}`}
        style={{ background: 'var(--bg-panel)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 py-2.5 shrink-0" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <span className="font-mono text-[10px] tracking-[0.15em] uppercase" style={{ color: 'var(--text-muted)' }}>
            {title}
          </span>
          <button onClick={onClose} style={{ color: 'var(--text-muted)' }} className="hover:opacity-80">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
