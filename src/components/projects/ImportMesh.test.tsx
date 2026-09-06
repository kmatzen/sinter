import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ImportMesh, buildMeshNode } from './ImportMesh';
import { useModelerStore } from '../../store/modelerStore';
import { STL_TOPOLOGY_STATUS } from '../../worker/sdf/stl';

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
  beforeEach(() => useModelerStore.getState().resetDocument(null));

  it('persists the topology limitation on imported nodes', () => {
    expect(buildMeshNode('part.stl', new Float32Array(TETRA.flat())).data?.meshTopology)
      .toBe(STL_TOPOLOGY_STATUS);
  });

  it('does not add even a closed mesh until approximate import is acknowledged', async () => {
    const onDone = vi.fn();
    render(<ImportMesh onDone={onDone} />);
    const file = new File([binarySTL()], 'part.stl', { type: 'model/stl' });
    fireEvent.change(screen.getByLabelText('STL file'), { target: { files: [file] } });

    expect(await screen.findByText(/Self-intersections cannot currently be ruled out/)).toBeInTheDocument();
    expect(useModelerStore.getState().tree).toBeNull();
    expect(onDone).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Import approximately' }));
    await waitFor(() => expect(useModelerStore.getState().tree?.kind).toBe('mesh'));
    expect(onDone).toHaveBeenCalledOnce();
  });
});
