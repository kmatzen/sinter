import { useState, useEffect, useCallback, useRef } from 'react';
import { useDialogFocus } from '../ui/useDialogFocus';
import { shortcutHelpCommands, TOGGLE_SHORTCUT_HELP_EVENT } from '../../commands/editorCommands';

const POINTER_SHORTCUTS = [
  ['Click', 'Select the shape under the pointer'],
  ['Ctrl/⌘+Click', 'Add or remove a shape from the selection'],
  ['Shift+Click', 'Select a range in the node tree'],
  ['+ in tree', 'Add or remove a shape on touch screens'],
  ['Alt+Click', 'Select the operation above that shape'],
  ['Shift (hold)', 'Disable snap while dragging'],
];

const SHORTCUTS = [
  ...POINTER_SHORTCUTS,
  ...shortcutHelpCommands.map((command) => [command.shortcut!.replace(/Mod/g, 'Ctrl/⌘').replace('Escape', 'Esc'), command.shortcutDescription!] as string[]),
];

export function ShortcutOverlay() {
  const [visible, setVisible] = useState(false);
  const surface = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setVisible(false), []);
  useDialogFocus(surface, close, visible);

  useEffect(() => {
    const handler = () => setVisible((v) => !v);
    window.addEventListener(TOGGLE_SHORTCUT_HELP_EVENT, handler);
    return () => window.removeEventListener(TOGGLE_SHORTCUT_HELP_EVENT, handler);
  }, []);

  if (!visible) return (
    <button
      onClick={() => setVisible(true)}
      aria-label="Open keyboard shortcuts and accessibility help"
      title="Keyboard shortcuts"
      className="absolute bottom-3 right-3 z-20 w-8 h-8 tap rounded-full text-sm"
      style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}
    >?</button>
  );

  return (
    <div className="absolute inset-0 flex items-center justify-center z-50 pointer-events-none">
      <div ref={surface} role="dialog" aria-modal="true" aria-labelledby="shortcut-title" className="bg-zinc-900/95 border border-zinc-700 rounded-lg p-5 pointer-events-auto shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <h3 id="shortcut-title" className="text-sm font-medium text-zinc-200">Keyboard Shortcuts</h3>
          <button onClick={close} aria-label="Close keyboard shortcuts" className="text-zinc-300 hover:text-zinc-300 text-xs">
            {'\u2715'}
          </button>
        </div>
        <div className="space-y-1.5">
          {SHORTCUTS.map(([key, desc]) => (
            <div key={key} className="flex items-center gap-3">
              <kbd className="text-[10px] bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-zinc-300 font-mono min-w-[60px] text-center">
                {key}
              </kbd>
              <span className="text-xs text-zinc-300">{desc}</span>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-zinc-300 mt-3">Press ? to close</p>
        <p className="text-[10px] text-zinc-300 mt-1">The node tree and property controls are the keyboard and screen-reader alternative to direct canvas manipulation.</p>
      </div>
    </div>
  );
}
