import { useRef, useState } from 'react';
import { NODE_LABELS, NODE_DEFAULTS } from '../../types/operations';
import type { SDFNodeUI } from '../../types/operations';
import { PRESET_CATEGORIES, formatSize } from './presets';
import { useModelerStore } from '../../store/modelerStore';
import { Box, Circle, Cylinder, Donut, Cone, Pill, Egg, Merge, Minus, Combine, Shell, Expand, CircleDot, FlipHorizontal, Scissors, RotateCcw, Scaling, Move, Repeat, CircleDashed, GripVertical, Download, Upload, Save, Trash2, Pencil } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  COMPONENT_FILE_EXTENSION, componentParameters, createPersonalComponent, deletePersonalComponent, exportComponent,
  importComponent, makeReusableComponent, parseComponentFile, readPersonalComponents, renamePersonalComponent,
  useProjectComponentStore, type PersonalComponent,
} from '../../store/componentLibrary';

const ICONS: Record<string, ReactNode> = {
  box: <Box size={14} />, sphere: <Circle size={14} />, cylinder: <Cylinder size={14} />,
  torus: <Donut size={14} />, cone: <Cone size={14} />, capsule: <Pill size={14} />, ellipsoid: <Egg size={14} />,
  union: <Merge size={13} />, subtract: <Minus size={13} />, intersect: <Combine size={13} />,
  shell: <Shell size={13} />, offset: <Expand size={13} />, round: <CircleDot size={13} />,
  mirror: <FlipHorizontal size={13} />, halfSpace: <Scissors size={13} />,
  linearPattern: <Repeat size={13} />, circularPattern: <CircleDashed size={13} />,
  translate: <Move size={13} />, rotate: <RotateCcw size={13} />, scale: <Scaling size={13} />,
};

/** Category accent colors matching the tree node pips */
const CAT_COLORS: Record<string, string> = {
  shapes: '#4aba7a',
  booleans: '#a878e8',
  modifiers: '#d4a04a',
  patterns: '#5b9ee8',
  transforms: '#5b9ee8',
};

function simpleNodeData(kind: string): string {
  return JSON.stringify({ kind, label: NODE_LABELS[kind] || kind, params: NODE_DEFAULTS[kind] || {} });
}

function presetNodeData(builder: () => SDFNodeUI): string {
  return JSON.stringify(builder());
}

/** Compact draggable shape tile — icon-forward with label below */
function ShapeTile({ kind, color }: { kind: string; color: string }) {
  const addNodeFromData = useModelerStore((s) => s.addNodeFromData);
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/sinter-node', simpleNodeData(kind));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => addNodeFromData(selectedId, JSON.parse(simpleNodeData(kind)))}
      aria-label={`Add ${NODE_LABELS[kind]}`}
      className="flex flex-col items-center justify-center gap-0.5 w-[56px] h-[48px] rounded cursor-grab active:cursor-grabbing select-none transition-colors"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = color; e.currentTarget.style.background = 'var(--bg-elevated)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.background = 'var(--bg-surface)'; }}
      title={`Add ${NODE_LABELS[kind]}`}
    >
      <span style={{ color }}>{ICONS[kind]}</span>
      <span className="text-[9px] leading-none" style={{ color: 'var(--text-muted)' }}>
        {NODE_LABELS[kind]}
      </span>
    </button>
  );
}

/** Compact operation pill — icon + label inline */
function OpPill({ kind, color }: { kind: string; color: string }) {
  const addNodeFromData = useModelerStore((s) => s.addNodeFromData);
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/sinter-node', simpleNodeData(kind));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => addNodeFromData(selectedId, JSON.parse(simpleNodeData(kind)))}
      aria-label={`Add ${NODE_LABELS[kind]}`}
      className="flex items-center gap-1 px-1.5 py-1 tap-h rounded cursor-grab active:cursor-grabbing select-none transition-colors"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = color; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
      title={`Add ${NODE_LABELS[kind]}`}
    >
      <span style={{ color }}>{ICONS[kind]}</span>
      <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
        {NODE_LABELS[kind]}
      </span>
    </button>
  );
}

/**
 * Preset card — name, envelope, description, with a drag grip.
 *
 * The envelope is rendered from the preset's `size`, never written into its
 * description. `presets.test.ts` holds `size` to the geometry, so this is the
 * only place a user-visible dimension can come from.
 */
function PresetCard({ name, size, desc, dragData }: { name: string; size: string; desc: string; dragData: string }) {
  const addNodeFromData = useModelerStore((s) => s.addNodeFromData);
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/sinter-node', dragData);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => addNodeFromData(selectedId, JSON.parse(dragData))}
      aria-label={`Add ${name} preset, ${size}: ${desc}`}
      title={`Add ${name} — ${size}: ${desc}`}
      className="flex items-start gap-1.5 px-2 py-1.5 tap-h rounded cursor-grab active:cursor-grabbing select-none transition-colors"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.background = 'var(--bg-elevated)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; e.currentTarget.style.background = 'var(--bg-surface)'; }}
    >
      <GripVertical size={10} className="shrink-0 mt-0.5" style={{ color: 'var(--text-muted)', opacity: 0.4 }} />
      <div className="min-w-0">
        <div className="text-[11px] font-medium truncate" style={{ color: 'var(--text-secondary)' }}>{name}</div>
        <div className="text-[9px] font-mono truncate" style={{ color: 'var(--text-muted)' }}>{size}</div>
        <div className="text-[9px] truncate" style={{ color: 'var(--text-muted)', opacity: 0.7 }}>{desc}</div>
      </div>
    </button>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[9px] tracking-[0.1em] uppercase px-0.5 pb-1 pt-2 first:pt-0" style={{ color: 'var(--text-muted)', opacity: 0.6 }}>
      {children}
    </div>
  );
}

type Tab = 'shapes' | 'operations' | 'presets' | 'library';

function findNode(node: SDFNodeUI | null, id: string | null): SDFNodeUI | null {
  if (!node || !id) return null;
  if (node.id === id) return node;
  for (const child of node.children) { const found = findNode(child, id); if (found) return found; }
  return null;
}

function LibraryCard({ component, onRename, onDelete, report }: { component: PersonalComponent; onRename: (name: string) => void; onDelete: () => void; report: (message: string) => void }) {
  const addNode = useModelerStore((s) => s.addNodeFromData);
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  const parameters = useModelerStore((s) => s.namedParameters);
  const setParameters = useModelerStore((s) => s.setNamedParameters);
  const beginHistoryTransaction = useModelerStore((s) => s.beginHistoryTransaction);
  const commitHistoryTransaction = useModelerStore((s) => s.commitHistoryTransaction);
  const insert = () => {
    const merged = [...parameters];
    for (const parameter of component.parameters) {
      const existing = merged.find((item) => item.name === parameter.name);
      if (existing && (existing.expression !== parameter.expression || existing.unit !== parameter.unit)) {
        report(`Parameter “${parameter.name}” conflicts with this project`); return;
      }
      if (!existing) merged.push(parameter);
    }
    beginHistoryTransaction();
    if (merged.length !== parameters.length) setParameters(merged);
    addNode(selectedId, component.node);
    commitHistoryTransaction();
    report(`Inserted ${component.name} as an independent copy`);
  };
  const download = () => {
    const blob = new Blob([exportComponent(component)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${component.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}${COMPONENT_FILE_EXTENSION}`;
    anchor.click(); URL.revokeObjectURL(url);
  };
  return <div className="flex gap-2 p-1.5 rounded" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
    <button type="button" onClick={insert} className="flex min-w-0 flex-1 items-center gap-2 text-left" title={`Insert ${component.name} as a copy`}>
      <img src={component.thumbnail} alt="" width={48} height={32} className="rounded shrink-0" />
      <span className="min-w-0"><span className="block text-[11px] font-medium truncate">{component.name}</span><span className="block text-[9px] truncate" style={{ color: 'var(--text-muted)' }}>{component.description || component.tags.join(', ') || component.node.kind}</span></span>
    </button>
    <span className="flex items-center gap-0.5">
      <button type="button" aria-label={`Rename ${component.name}`} title="Rename" onClick={() => { const name = window.prompt('Component name', component.name); if (!name) return; try { onRename(name); } catch (error) { report(error instanceof Error ? error.message : 'Could not rename component'); } }}><Pencil size={12} /></button>
      <button type="button" aria-label={`Export ${component.name}`} title="Export" onClick={download}><Download size={12} /></button>
      <button type="button" aria-label={`Delete ${component.name}`} title="Delete" onClick={onDelete}><Trash2 size={12} /></button>
    </span>
  </div>;
}

export function PartsPalette() {
  const [tab, setTab] = useState<Tab>('shapes');
  const [components, setComponents] = useState(readPersonalComponents);
  const [scope, setScope] = useState<'personal' | 'project'>('personal');
  const projectComponents = useProjectComponentStore((state) => state.components);
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState<{ name: string; description: string; tags: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tree = useModelerStore((s) => s.tree);
  const selectedId = useModelerStore((s) => s.selectedNodeId);
  const parameters = useModelerStore((s) => s.namedParameters);
  const refresh = () => setComponents(readPersonalComponents());
  const openSave = () => {
    const node = findNode(tree, selectedId);
    if (!node) { setMessage('Select a complete subtree first'); return; }
    setDraft({ name: node.label, description: '', tags: '' }); setMessage('');
  };
  const saveSelected = () => {
    const node = findNode(tree, selectedId);
    if (!node || !draft) { setMessage('The selected subtree is no longer available'); return; }
    const tags = draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
    try {
      const declarations = componentParameters(node, parameters);
      if (scope === 'personal') createPersonalComponent(node, draft.name, draft.description, tags, declarations);
      else useProjectComponentStore.getState().add(makeReusableComponent(node, draft.name, draft.description, tags, declarations));
      refresh(); setMessage(scope === 'personal' ? `Saved ${draft.name} to this browser` : `Saved ${draft.name} in this project`); setDraft(null);
    }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save component'); }
  };

  return (
    <div className="flex flex-col" style={{ borderTop: '1px solid var(--border-subtle)' }}>
      {/* Content */}
      <div className="p-2 overflow-y-auto" style={{ maxHeight: '220px' }}>
        {tab === 'shapes' && (
          <div className="flex flex-wrap gap-1 justify-center">
            {(['box', 'sphere', 'cylinder', 'torus', 'cone', 'capsule', 'ellipsoid'] as const).map((kind) => (
              <ShapeTile key={kind} kind={kind} color={CAT_COLORS.shapes} />
            ))}
          </div>
        )}

        {tab === 'operations' && (
          <div>
            <SectionHeader>Booleans</SectionHeader>
            <div className="flex flex-wrap gap-1">
              {(['union', 'subtract', 'intersect'] as const).map((kind) => (
                <OpPill key={kind} kind={kind} color={CAT_COLORS.booleans} />
              ))}
            </div>

            <SectionHeader>Modifiers</SectionHeader>
            <div className="flex flex-wrap gap-1">
              {(['shell', 'offset', 'round', 'mirror', 'halfSpace'] as const).map((kind) => (
                <OpPill key={kind} kind={kind} color={CAT_COLORS.modifiers} />
              ))}
            </div>

            <SectionHeader>Patterns & Transforms</SectionHeader>
            <div className="flex flex-wrap gap-1">
              {(['linearPattern', 'circularPattern', 'translate', 'rotate', 'scale'] as const).map((kind) => (
                <OpPill key={kind} kind={kind} color={CAT_COLORS.transforms} />
              ))}
            </div>
          </div>
        )}

        {tab === 'presets' && (
          <div>
            {PRESET_CATEGORIES.map((cat) => (
              <div key={cat.category}>
                <SectionHeader>{cat.category}</SectionHeader>
                <div className="flex flex-col gap-1">
                  {cat.items.map((item) => (
                    <PresetCard key={item.name} name={item.name} size={formatSize(item.size)} desc={item.desc} dragData={presetNodeData(item.build)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {tab === 'library' && <div className="flex flex-col gap-1.5">
          <div className="flex rounded overflow-hidden" role="group" aria-label="Component library scope" style={{ border: '1px solid var(--border-subtle)' }}>
            {(['personal', 'project'] as const).map((item) => <button type="button" key={item} aria-pressed={scope === item} onClick={() => { setScope(item); setDraft(null); setMessage(''); }} className="flex-1 py-1 text-[10px] capitalize" style={{ background: scope === item ? 'var(--bg-elevated)' : 'transparent' }}>{item}</button>)}
          </div>
          <div className="flex gap-1">
            <button type="button" onClick={openSave} disabled={!selectedId} className="flex flex-1 items-center justify-center gap-1 rounded py-1 text-[10px] disabled:opacity-40" style={{ border: '1px solid var(--border-subtle)' }}><Save size={12} /> Save selection</button>
            <button type="button" onClick={() => inputRef.current?.click()} className="flex items-center gap-1 rounded px-2 py-1 text-[10px]" style={{ border: '1px solid var(--border-subtle)' }}><Upload size={12} /> Import</button>
            <input ref={inputRef} type="file" accept="application/json,.json" className="hidden" onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; try { const added = scope === 'personal' ? importComponent(await file.text()) : parseComponentFile(await file.text()); if (scope === 'project') useProjectComponentStore.getState().add(added); refresh(); setMessage(`Imported ${added.name}`); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not import component'); } }} />
          </div>
          {draft && <div className="flex flex-col gap-1 rounded p-1.5" style={{ border: '1px solid var(--border-default)' }}>
            <input autoFocus aria-label="Component name" value={draft.name} maxLength={80} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Component name" className="rounded px-1.5 py-1 text-[10px]" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }} />
            <input aria-label="Component description" value={draft.description} maxLength={500} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Description (optional)" className="rounded px-1.5 py-1 text-[10px]" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }} />
            <input aria-label="Component tags" value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="Tags, comma separated" className="rounded px-1.5 py-1 text-[10px]" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }} />
            <span className="flex justify-end gap-1"><button type="button" onClick={() => setDraft(null)} className="rounded px-2 py-1 text-[10px]">Cancel</button><button type="button" onClick={saveSelected} disabled={!draft.name.trim()} className="rounded px-2 py-1 text-[10px] disabled:opacity-40" style={{ background: 'var(--accent-primary)', color: 'white' }}>Save</button></span>
          </div>}
          {message && <div role="status" className="text-[9px] px-0.5" style={{ color: 'var(--text-muted)' }}>{message}</div>}
          {(scope === 'personal' ? components : projectComponents).length === 0 && <div className="text-[10px] py-4 text-center" style={{ color: 'var(--text-muted)' }}>{scope === 'personal' ? 'Save a selected subtree to reuse it in other projects.' : 'Project components travel with this project when saved or shared.'}</div>}
          {(scope === 'personal' ? components : projectComponents).map((component) => <LibraryCard key={component.id} component={component} report={setMessage}
            onRename={(name) => { if (scope === 'personal') { renamePersonalComponent(component.id, name); refresh(); } else useProjectComponentStore.getState().rename(component.id, name); }}
            onDelete={() => { if (scope === 'personal') { deletePersonalComponent(component.id); refresh(); } else useProjectComponentStore.getState().remove(component.id); }} />)}
        </div>}
      </div>

      {/* Tab bar — pinned at bottom */}
      <div
        className="flex mx-2 mb-2 rounded-md overflow-hidden shrink-0"
        style={{ border: '1px solid var(--border-subtle)' }}
        role="tablist"
        aria-label="Parts palette"
      >
        {([['shapes', 'Shapes'], ['operations', 'Ops'], ['presets', 'Presets'], ['library', 'Library']] as const).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className="flex-1 text-[10px] py-1 tap-h font-medium transition-colors"
            style={{
              background: tab === key ? 'var(--bg-elevated)' : 'transparent',
              color: tab === key ? 'var(--text-primary)' : 'var(--text-muted)',
              borderRight: key !== 'library' ? '1px solid var(--border-subtle)' : 'none',
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
