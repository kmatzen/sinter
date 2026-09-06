import { useEffect, useMemo, useRef, useState } from 'react';
import { OPEN_COMMAND_PALETTE_EVENT, searchCommands, type EditorCommand } from '../../commands/editorCommands';
import { useDialogFocus } from '../ui/useDialogFocus';

const RECENT_KEY = 'sinter_recent_commands';

function recentIds(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 8) : [];
  } catch { return []; }
}

function remember(id: string): void {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentIds().filter((item) => item !== id)].slice(0, 8))); } catch { /* preference only */ }
}

export function rankCommands(commands: EditorCommand[], recent: string[]): EditorCommand[] {
  const order = new Map(recent.map((id, index) => [id, index]));
  return [...commands].sort((a, b) => {
    const availability = Number(!!a.unavailableReason?.()) - Number(!!b.unavailableReason?.());
    return availability || (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99);
  });
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const surface = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); setQuery(''); setActive(0); };
  useDialogFocus(surface, close, open);

  useEffect(() => {
    const show = () => { setRecent(recentIds()); setOpen(true); };
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, show);
    return () => window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, show);
  }, []);

  const results = useMemo(() => rankCommands(searchCommands(query), query ? [] : recent), [query, recent]);
  useEffect(() => setActive(0), [query]);
  if (!open) return null;

  const invoke = (command: EditorCommand) => {
    const reason = command.unavailableReason?.() ?? null;
    if (reason) return;
    remember(command.id);
    close();
    void command.run();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center p-3 pt-[max(4rem,12vh)]" style={{ background: 'rgba(0,0,0,0.62)' }} onMouseDown={close}>
      <div ref={surface} role="dialog" aria-modal="true" aria-label="Command palette" className="w-full max-w-xl overflow-hidden rounded-xl shadow-2xl" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border-default)' }} onMouseDown={(event) => event.stopPropagation()}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActive((value) => Math.min(value + 1, results.length - 1)); }
            if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
            if (event.key === 'Enter' && results[active]) { event.preventDefault(); invoke(results[active]); }
          }}
          aria-label="Search commands"
          placeholder="Search commands…"
          className="w-full px-4 py-3 text-base outline-none"
          style={{ background: 'var(--bg-deep)', color: 'var(--text-primary)', borderBottom: '1px solid var(--border-subtle)' }}
        />
        <div role="listbox" aria-label="Commands" className="max-h-[min(60vh,28rem)] overflow-y-auto p-1.5">
          {results.map((command, index) => {
            const reason = command.unavailableReason?.() ?? null;
            return (
              <button key={command.id} role="option" aria-selected={index === active} disabled={!!reason}
                onMouseEnter={() => setActive(index)} onClick={() => invoke(command)}
                className="w-full tap-h rounded-lg px-3 py-2 text-left flex items-center gap-3 disabled:opacity-50"
                style={{ background: index === active ? 'var(--bg-elevated)' : 'transparent', color: 'var(--text-primary)' }}>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm truncate">{command.title}</span>
                  <span className="block text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>{reason ?? command.category}</span>
                </span>
                {command.shortcut && <kbd className="shrink-0 rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--bg-deep)', color: 'var(--text-muted)' }}>{command.shortcut.replace('Mod', (navigator.platform ?? '').includes('Mac') ? '⌘' : 'Ctrl')}</kbd>}
              </button>
            );
          })}
          {!results.length && <p className="p-5 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No matching commands</p>}
        </div>
      </div>
    </div>
  );
}
