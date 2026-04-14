import { useState } from 'react';

interface Props {
  onDone: () => void;
}

export function ImportProject({ onDone }: Props) {
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<{ name: string; ok: boolean }[]>([]);

  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.multiple = true;
    input.onchange = async (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (!files || files.length === 0) return;

      setImporting(true);
      const importResults: { name: string; ok: boolean }[] = [];

      for (const file of Array.from(files)) {
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          const name = data.projectName || file.name.replace('.json', '');
          const tree = data.tree || null;

          const res = await fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ name, tree_json: tree }),
          });

          importResults.push({ name, ok: res.ok });
        } catch {
          importResults.push({ name: file.name, ok: false });
        }
      }

      setResults(importResults);
      setImporting(false);
    };
    input.click();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onDone}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg w-[400px] p-6 shadow-2xl"
           onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-medium text-zinc-200 mb-4">Import Local Projects</h2>

        <p className="text-xs text-zinc-300 mb-4">
          Select one or more .json project files exported from the community edition.
          They'll be uploaded to your cloud account.
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
          <div className="space-y-1 mb-4">
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={r.ok ? 'text-emerald-400' : 'text-red-400'}>
                  {r.ok ? '\u2713' : '\u2717'}
                </span>
                <span className="text-zinc-300">{r.name}</span>
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
