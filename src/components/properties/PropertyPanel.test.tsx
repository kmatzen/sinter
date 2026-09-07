import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../engine/workerBridge', () => ({ workerBridge: { fitMesh: vi.fn() } }));
import { PropertyContent } from './PropertyPanel';
import { useModelerStore } from '../../store/modelerStore';
import { useTreeUiStore } from '../../store/treeUiStore';

const box = {
  id: 'box', kind: 'box', label: 'Box', params: { width: 10, height: 20, depth: 30 }, children: [], enabled: true,
};

describe('property formulas', () => {
  beforeEach(() => {
    useModelerStore.getState().resetDocument(box, 'Formula test', []);
    useModelerStore.getState().selectNode('box');
  });
  afterEach(cleanup);

  it('creates a parameter and binds a property to its formula', () => {
    render(<PropertyContent />);
    fireEvent.click(screen.getByText('Named parameters (0)'));
    fireEvent.change(screen.getByLabelText('New parameter name'), { target: { value: 'wall' } });
    fireEvent.change(screen.getByLabelText('New parameter expression'), { target: { value: '4' } });
    fireEvent.click(screen.getByText('Add parameter'));

    fireEvent.click(screen.getByText('Driven properties (0)'));
    fireEvent.change(screen.getByLabelText('Property formula'), { target: { value: 'wall * 2' } });
    fireEvent.click(screen.getByText('Drive'));

    expect(useModelerStore.getState().tree?.params.width).toBe(8);
    expect(useModelerStore.getState().tree?.expressions?.width).toBe('wall * 2');
    expect(screen.getByText(/width = wall \* 2/)).toBeInTheDocument();
  });

  it('promotes a literal property to a named parameter', () => {
    render(<PropertyContent />);
    fireEvent.click(screen.getByText('Driven properties (0)'));
    fireEvent.change(screen.getByLabelText('Property to drive'), { target: { value: 'height' } });
    fireEvent.change(screen.getByLabelText('Promoted parameter name'), { target: { value: 'bodyHeight' } });
    fireEvent.click(screen.getByText('Promote'));
    expect(useModelerStore.getState().namedParameters[0]).toEqual({ name: 'bodyHeight', expression: '20', unit: 'mm' });
    expect(useModelerStore.getState().tree?.expressions?.height).toBe('bodyHeight');
  });

  it('does not expose editing controls for a locked node', () => {
    useTreeUiStore.getState().toggleLocked('box');
    render(<PropertyContent />);

    expect(screen.getByRole('status')).toHaveTextContent('This node is locked');
    expect(screen.queryByLabelText('Width')).not.toBeInTheDocument();
    expect(screen.queryByText(/Driven properties/)).not.toBeInTheDocument();
  });

  it('shows and edits the effective world transform as one undoable change', () => {
    const tree = {
      id: 'move', kind: 'translate', label: 'Move', params: { x: 5, y: 0, z: 0 }, enabled: true,
      children: [box],
    };
    useModelerStore.getState().resetDocument(tree, 'Transform test', []);
    useModelerStore.getState().selectNode('box');
    const before = useModelerStore.getState().historyIndex;
    render(<PropertyContent />);

    expect(screen.getByText('Effective transform · world')).toBeInTheDocument();
    const xInputs = screen.getAllByLabelText('X');
    expect(xInputs[0]).toHaveValue('5.00');
    fireEvent.change(xInputs[0], { target: { value: '12' } });
    fireEvent.blur(xInputs[0]);

    expect(useModelerStore.getState().historyIndex).toBe(before + 1);
    expect(useModelerStore.getState().selectedNodeId).toBe('box');
    act(() => useModelerStore.getState().undo());
    expect(useModelerStore.getState().historyIndex).toBe(before);
  });

  it('validates a profile inline and commits a valid gesture once on blur', () => {
    const extrude = { id: 'plate', kind: 'extrude', label: 'Plate', params: { depth: 5 }, children: [], enabled: true };
    useModelerStore.getState().resetDocument(extrude, 'Profile test', []);
    useModelerStore.getState().selectNode('plate');
    const before = useModelerStore.getState().historyIndex;
    render(<PropertyContent />);
    const editor = screen.getByLabelText('Profile loops JSON');
    fireEvent.change(editor, { target: { value: '{' } });
    fireEvent.blur(editor);
    expect(screen.getByRole('alert')).toHaveTextContent('not valid JSON');
    expect(useModelerStore.getState().historyIndex).toBe(before);

    const profile = '{"outer":[[0,0],[10,0],[10,5],[0,5]],"holes":[]}';
    fireEvent.change(editor, { target: { value: profile } });
    fireEvent.blur(editor);
    expect(useModelerStore.getState().tree?.data?.profile).toBe(profile);
    expect(useModelerStore.getState().historyIndex).toBe(before + 1);
  });

  it('commits a direct profile coordinate edit as one undo step', () => {
    const extrude = { id: 'plate', kind: 'extrude', label: 'Plate', params: { depth: 5 }, children: [], enabled: true };
    useModelerStore.getState().resetDocument(extrude, 'Direct profile test', []);
    useModelerStore.getState().selectNode('plate');
    const before = useModelerStore.getState().historyIndex;
    render(<PropertyContent />);
    const x = screen.getByLabelText('Selected vertex X');
    fireEvent.change(x, { target: { value: '-10' } });
    expect(useModelerStore.getState().historyIndex).toBe(before);
    fireEvent.blur(x);
    expect(useModelerStore.getState().historyIndex).toBe(before + 1);
    expect(JSON.parse(useModelerStore.getState().tree?.data?.profile || '').outer[0]).toEqual([-10, -15]);
  });

  it('exposes and commits all profile extrusion extent controls', () => {
    const extrude = { id: 'plate', kind: 'extrude', label: 'Plate', params: { depth: 5 }, children: [], enabled: true };
    useModelerStore.getState().resetDocument(extrude, 'Extrude modes', []);
    useModelerStore.getState().selectNode('plate');
    render(<PropertyContent />);
    fireEvent.change(screen.getByLabelText('Extrude extent'), { target: { value: '2' } });
    expect(screen.getByLabelText('Negative depth')).toBeInTheDocument();
    const negative = screen.getByLabelText('Negative depth');
    fireEvent.change(negative, { target: { value: '7' } }); fireEvent.blur(negative);
    const taper = screen.getByLabelText('Taper');
    fireEvent.change(taper, { target: { value: '-10' } }); fireEvent.blur(taper);
    const wall = screen.getByLabelText('Wall');
    fireEvent.change(wall, { target: { value: '1.5' } }); fireEvent.blur(wall);
    expect(useModelerStore.getState().tree?.params).toMatchObject({ extentMode: 2, negativeDepth: 7, taper: -10, wallThickness: 1.5 });
  });

  it('groups a dragged profile vertex into one undo step', () => {
    const extrude = { id: 'plate', kind: 'extrude', label: 'Plate', params: { depth: 5 }, children: [], enabled: true };
    useModelerStore.getState().resetDocument(extrude, 'Profile drag test', []);
    useModelerStore.getState().selectNode('plate');
    const before = useModelerStore.getState().historyIndex;
    render(<PropertyContent />);
    const svg = screen.getByRole('img', { name: 'Profile shape editor' });
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 10, y: 20, left: 10, top: 20, right: 210, bottom: 164, width: 200, height: 144, toJSON: () => ({}) });
    fireEvent.pointerDown(screen.getByLabelText('Outer vertex 1'), { clientX: 30, clientY: 140 });
    fireEvent.pointerMove(window, { clientX: 70, clientY: 145 });
    expect(useModelerStore.getState().historyIndex).toBe(before);
    fireEvent.pointerMove(window, { clientX: 75, clientY: 145 });
    fireEvent.pointerUp(window);
    expect(useModelerStore.getState().historyIndex).toBe(before + 1);
  });

  it('rejects negative revolve radii before committing profile data', () => {
    const revolve = { id: 'knob', kind: 'revolve', label: 'Knob', params: { axis: 1, angle: 360 }, children: [], enabled: true };
    useModelerStore.getState().resetDocument(revolve, 'Revolve test', []);
    useModelerStore.getState().selectNode('knob');
    render(<PropertyContent />);
    const editor = screen.getByLabelText('Profile loops JSON');
    fireEvent.change(editor, { target: { value: '{"outer":[[-1,-1],[2,-1],[2,1],[-1,1]],"holes":[]}' } });
    fireEvent.blur(editor);
    expect(screen.getByRole('alert')).toHaveTextContent('radius coordinates must be non-negative');
    expect(useModelerStore.getState().tree?.data?.profile).toBeUndefined();
  });

  it('commits named sketch planes for extrude and revolve', () => {
    const extrude = { id: 'plate', kind: 'extrude', label: 'Plate', params: { depth: 5 }, children: [], enabled: true };
    useModelerStore.getState().resetDocument(extrude, 'Plane test', []);
    useModelerStore.getState().selectNode('plate');
    const { unmount } = render(<PropertyContent />);
    fireEvent.change(screen.getByLabelText('Extrude sketch plane'), { target: { value: '1' } });
    expect(useModelerStore.getState().tree?.params.plane).toBe(1);
    unmount();

    const revolve = { id: 'knob', kind: 'revolve', label: 'Knob', params: { axis: 1, angle: 360 }, children: [], enabled: true };
    useModelerStore.getState().resetDocument(revolve, 'Plane test', []);
    useModelerStore.getState().selectNode('knob');
    render(<PropertyContent />);
    fireEvent.change(screen.getByLabelText('Revolve sketch plane'), { target: { value: '2' } });
    expect(useModelerStore.getState().tree?.params.plane).toBe(2);
  });
});
