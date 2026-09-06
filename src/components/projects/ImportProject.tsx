import { useRef, useState } from 'react';
import { getCurrentProvider, useAuthStore } from '../../store/authStore';
import { getStorageProvider } from '../../storage';
import { decodeProjectDocument, MAX_PROJECT_JSON_CHARS } from '../../types/documentDecoder';
import { useDialogFocus } from '../ui/useDialogFocus';

interface Props {
  onDone: () => void;
}

export function ImportProject({ onDone }: Props) {
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<{ name: string; ok: boolean; error?: string }[]>([]);
  const surface = useRef<HTMLDivElement>(null);
  useDialogFocus(surface, onDone);

  const handleImport = async () => {
    const provider = getCurrentProvider();
    if (!provider) {
      setResults([{ name: 'Sign in required', ok: false, error: 'Sign in to import projects to your cloud' }]);
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;

      setImporting(true);
      const importResults: typeof results = [];
      const accessToken = await useAuthStore.getState().getAccessToken();
      const storage = getStorageProvider(provider);

      for (const file of Array.from(files)) {
        let name = file.name.replace('.json', '');
        try {
          const text = await file.text();
          if (text.length > MAX_PROJECT_JSON_CHARS) throw new Error('Project file exceeds the supported document size');
          const data = decodeProjectDocument(JSON.parse(text), name);
          name = data.projectName || name;
          const tree = data.tree;
          await storage.create(accessToken, name, {
            version: 2, thumbnail: data.thumbnail, tree, checkpoints: data.checkpoints, parameters: data.parameters, views: data.views,
            measurements: data.measurements, units: data.units,
          });
          importResults.push({ name, ok: true });
        } catch (err: unknown) {
          importResults.push({ name, ok: false, error: err instanceof Error ? err.message : 'Failed' });
        }
      }

      setResults(importResults);
      setImporting(false);
    };
    input.click();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onDone}>
      <div ref={surface} role="dialog" aria-modal="true" aria-labelledby="import-project-title" className="bg-zinc-900 border border-zinc-700 rounded-lg w-[400px] p-6 shadow-2xl"
           onClick={(e) => e.stopPropagation()}>
        <h2 id="import-project-title" className="text-sm font-medium text-zinc-200 mb-4">Import Local Projects</h2>

        <p className="text-xs text-zinc-300 mb-4">
          Select one or more .json project files exported from Sinter. They'll be uploaded to your cloud storage.
        </p>

        {results.length === 0 ? (
          <button
            onClick={handleImport}
            disabled={importing}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg text-sm font-medium text-white mb-3"
          >
            {importing ? 'Importing...' : 'Choose Files to Import'}
          </button>
        ) : (
          <div role="status" aria-live="polite" className="space-y-1 mb-4">
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={r.ok ? 'text-emerald-400' : 'text-red-400'}>
                  {r.ok ? '✓' : '✗'}
                </span>
                <span className="text-zinc-300">{r.name}</span>
                {r.error && <span className="text-red-400 text-[10px]">— {r.error}</span>}
              </div>
            ))}
          </div>
        )}

        <button
          onClick={onDone}
          className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg text-sm text-zinc-300"
        >
          {results.length > 0 ? 'Done' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}
