import { List, MessageSquare } from 'lucide-react';

/**
 * What a phone shows before there is anything to look at.
 *
 * The editor already had an empty state — "No model yet, add a shape from the
 * palette below" — but it lived inside the node tree, which on mobile is
 * behind a toolbar icon. So the actual first-run mobile experience was an
 * empty black viewport and four unlabelled buttons, with nothing naming the
 * two ways in. Desktop never had the problem because its tree is always on
 * screen; this is the mobile half of that same copy.
 *
 * Rendered inside the viewport rather than as an overlay panel, so it
 * disappears the moment a shape exists without anything to dismiss.
 */
export function MobileEmptyState({ onOpenTree, onOpenChat }: { onOpenTree: () => void; onOpenChat: () => void }) {
  return (
    <div
      className="lg:hidden absolute inset-0 z-10 flex flex-col items-center justify-center text-center px-safe-plus pb-safe"
      style={{ ['--safe-pad-x' as any]: '2rem' }}
    >
      <p className="text-base font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
        Nothing here yet
      </p>
      <p className="text-[13px] leading-relaxed mb-6" style={{ color: 'var(--text-muted)' }}>
        Start from a shape and cut, join and round it — or describe the part you
        want and let the assistant build it.
      </p>

      <div className="flex flex-col gap-2 w-full max-w-[260px]">
        <button
          onClick={onOpenTree}
          className="flex items-center justify-center gap-2 rounded-lg px-4 py-3 tap-h text-[13px] font-medium"
          style={{ background: 'var(--accent)', color: 'var(--bg-deep)' }}
        >
          <List size={16} />
          Add a shape
        </button>
        <button
          onClick={onOpenChat}
          className="flex items-center justify-center gap-2 rounded-lg px-4 py-3 tap-h text-[13px] font-medium"
          style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}
        >
          <MessageSquare size={16} />
          Describe it instead
        </button>
      </div>
    </div>
  );
}
