import { runEditorCommand } from './commands/editorCommands';

export function handleModelerKeyDown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    runEditorCommand('help.command-palette');
    return;
  }
  // Saving is global within the editor. Handle it before the text-entry guard
  // so the browser's Save Page action never wins while an input has focus.
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    runEditorCommand('project.save');
    return;
  }

  if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); runEditorCommand('edit.undo'); }
  if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); runEditorCommand('edit.redo'); }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') runEditorCommand('edit.copy');
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') runEditorCommand('edit.paste');
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); runEditorCommand('edit.duplicate'); }
  if (e.key === 'w' || e.key === 'W') runEditorCommand('view.move');
  if (e.key === 'e' || e.key === 'E') runEditorCommand('view.rotate');
  if (e.key === 'r' || e.key === 'R') runEditorCommand('view.scale');
  if (!e.metaKey && !e.ctrlKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    runEditorCommand(e.shiftKey ? 'view.frame-selection' : 'view.frame-all');
  }
  if (e.key === 'Escape') runEditorCommand('view.clear-tool');
  if (e.key === 'Delete' || e.key === 'Backspace') {
    runEditorCommand('edit.delete');
  }
  if (e.key === '?') { e.preventDefault(); runEditorCommand('help.shortcuts'); }
}
