import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImportMesh, buildMeshNode, orientMesh } from './ImportMesh';
import { useModelerStore } from '../../store/modelerStore';
import { STL_TOPOLOGY_STATUS } from '../../worker/sdf/stl';

vi.mock('../../worker/meshImportClient', () => ({
  MeshImportSession: class {
    async load(file: File) { return { format: 'stl', triangleCount: file.name === 'large.stl' ? 60001 : 4, componentCount: 1, boundsMin: [0, 0, 0], boundsMax: [1, 1, 1], unitScaleToMillimeters: 1, estimatedProjectBytes: 1216 }; }
    async finish(target: number) { return { positions: new Float32Array(TETRA.flat()), triangleCount: target === 60000 ? 60000 : 4, maxDeviation: target === 60000 ? 0.125 : 0 }; }
    cancel() {}
  },
}));

const TETRA = [
  [0, 0, 0, 0, 1, 0, 1, 0, 0],
  [0, 0, 0, 1, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 1, 0, 0, 0, 1],
  [0, 1, 0, 0, 0, 0, 0, 0, 1],
];

function binarySTL(): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + TETRA.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, TETRA.length, true);
  let offset = 84;
  for (const triangle of TETRA) {
    offset += 12;
    for (const value of triangle) { view.setFloat32(offset, value, true); offset += 4; }
    offset += 2;
  }
  return buffer;
}

describe('ImportMesh topology acknowledgement', () => {
  beforeEach(() => {
    localStorage.clear();
    useModelerStore.getState().resetDocument(null);
  });

  it('persists the topology limitation on imported nodes', () => {
    expect(buildMeshNode('part.stl', new Float32Array(TETRA.flat())).data?.meshTopology)
      .toBe(STL_TOPOLOGY_STATUS);
  });

  it('scales unitless STL coordinates to canonical millimeters and records the assumption', () => {
    const node = buildMeshNode('inch-part.stl', new Float32Array([1, 0, 0]), 48, 'in');
    const binary = atob(node.data!.meshPositions);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    expect(new Float32Array(bytes.buffer)[0]).toBeCloseTo(25.4);
    expect(node.data?.meshImportUnit).toBe('in');
  });

  it('applies and records an explicit source orientation and field resolution', () => {
    expect([...orientMesh(new Float32Array([1, 2, 3]), 'y-up')]).toEqual([1, -3, 2]);
    expect([...orientMesh(new Float32Array([1, 2, 3]), 'x-up')]).toEqual([-3, 2, 1]);
    const node = buildMeshNode('part.obj', new Float32Array([1, 2, 3]), 64, 'mm', 'y-up');
    expect(node.data).toMatchObject({ meshName: 'part.obj', meshImportOrientation: 'y-up' });
    expect(node.params.resolution).toBe(64);
  });

  it('does not add even a closed mesh until approximate import is acknowledged', async () => {
    const onDone = vi.fn();
    render(<ImportMesh onDone={onDone} />);
    const file = new File([binarySTL()], 'part.stl', { type: 'model/stl' });
    fireEvent.change(screen.getByLabelText('Mesh file'), { target: { files: [file] } });

    expect(await screen.findByText(/Self-intersections cannot currently be ruled out/)).toBeInTheDocument();
    expect(screen.getByText(/STL and OBJ files contain no reliable unit metadata/)).toBeInTheDocument();
    expect(screen.getByLabelText('Source up axis')).toBeInTheDocument();
    expect(screen.getByLabelText('Distance-field resolution')).toBeInTheDocument();
    expect(useModelerStore.getState().tree).toBeNull();
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Import approximately' }));
    await waitFor(() => expect(useModelerStore.getState().tree?.kind).toBe('mesh'));
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('reimports with saved settings and replaces the node in one undo step', async () => {
    const original = buildMeshNode('old.stl', new Float32Array(TETRA.flat()), 64, 'in', 'y-up');
    original.label = 'Kept label';
    useModelerStore.getState().resetDocument(original);
    render(<ImportMesh replaceNode={original} onDone={() => {}} />);

    expect(screen.getByRole('dialog', { name: 'Reimport mesh' })).toHaveTextContent('old.stl');
    expect(screen.queryByLabelText('Source up axis')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Mesh file'), { target: { files: [new File([binarySTL()], 'replacement.stl', { type: 'model/stl' })] } });
    expect(await screen.findByLabelText('Source up axis')).toHaveValue('y-up');
    expect(screen.getByLabelText('Distance-field resolution')).toHaveValue('64');
    fireEvent.click(screen.getByRole('button', { name: 'Import approximately' }));
    await waitFor(() => expect(useModelerStore.getState().tree?.data?.meshName).toBe('replacement.stl'));
    expect(useModelerStore.getState().tree).toMatchObject({ id: original.id, label: 'Kept label' });

    useModelerStore.getState().undo();
    expect(useModelerStore.getState().tree?.data?.meshName).toBe('old.stl');
  });

  it('reports simplification error before committing reduced geometry', async () => {
    render(<ImportMesh onDone={() => {}} />);
    fireEvent.change(screen.getByLabelText('Mesh file'), { target: { files: [new File([binarySTL()], 'large.stl', { type: 'model/stl' })] } });
    expect(await screen.findByLabelText('Triangles after import')).toHaveValue('60000');
    fireEvent.click(screen.getByRole('button', { name: 'Import approximately' }));
    expect(await screen.findByRole('status')).toHaveTextContent('sampled maximum deviation 0.125 mm');
    expect(useModelerStore.getState().tree).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm import' }));
    await waitFor(() => expect(useModelerStore.getState().tree?.kind).toBe('mesh'));
  });
});
