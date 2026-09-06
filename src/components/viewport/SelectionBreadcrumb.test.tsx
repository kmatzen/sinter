import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SelectionBreadcrumb } from './SelectionBreadcrumb';
import { useModelerStore } from '../../store/modelerStore';
import { useViewportStore } from '../../store/viewportStore';
import type { SDFNodeUI } from '../../types/operations';

function node(id: string, kind: string, children: SDFNodeUI[] = []): SDFNodeUI {
  return { id, kind, label: kind, params: {}, children, enabled: true };
}

//   Subtract
//     +- Box            (the stock)
//     +- Translate
//          +- Cylinder  (the tool that cuts the bore)
const cylinder = node('cyl', 'cylinder');
const move = node('mv', 'translate', [cylinder]);
const box = node('box', 'box');
const tree = node('sub', 'subtract', [box, move]);

beforeEach(() => {
  useModelerStore.setState({ tree, selectedNodeId: null });
  useViewportStore.setState({ hoveredNodeId: null, hoverSource: null });
});

describe('SelectionBreadcrumb', () => {
  it('tells the user how selection works when nothing is selected', () => {
    render(<SelectionBreadcrumb />);
    expect(screen.getByTestId('selection-breadcrumb')).toHaveTextContent('Click a surface to select its node');
    expect(screen.getByTestId('selection-breadcrumb')).toHaveClass('hidden', 'sm:block');
  });

  it('shows the whole chain from the root down to the selected node', () => {
    useModelerStore.setState({ selectedNodeId: 'cyl' });
    render(<SelectionBreadcrumb />);

    const crumb = screen.getByTestId('selection-breadcrumb');
    // The point of the chip: a click that lands on a bore's wall selects the
    // cylinder, and this is what explains why.
    expect(crumb).toHaveTextContent('Subtract');
    expect(crumb).toHaveTextContent('Translate');
    expect(crumb).toHaveTextContent('Cylinder');
  });

  it('selects an ancestor when its crumb is clicked', () => {
    useModelerStore.setState({ selectedNodeId: 'cyl' });
    render(<SelectionBreadcrumb />);

    // Picking can only ever land on a leaf, so the crumbs are the only way to
    // reach the operation above it from the viewport.
    fireEvent.click(screen.getByTitle('Select Subtract'));
    expect(useModelerStore.getState().selectedNodeId).toBe('sub');
  });

  it('previews the hovered node instead of the selected one', () => {
    useModelerStore.setState({ selectedNodeId: 'box' });
    useViewportStore.setState({ hoveredNodeId: 'cyl', hoverSource: 'viewport' });
    render(<SelectionBreadcrumb />);

    const crumb = screen.getByTestId('selection-breadcrumb');
    expect(crumb).toHaveTextContent('Click to select');
    expect(crumb).toHaveTextContent('Cylinder');
    // Preview crumbs are inert — the pointer is out over the model, not on the
    // chip, so a click here would be a click on geometry.
    expect(screen.getByText('Cylinder').closest('button')).toBeDisabled();
  });

  it('does not preview a hover that is already the selection', () => {
    useModelerStore.setState({ selectedNodeId: 'cyl' });
    useViewportStore.setState({ hoveredNodeId: 'cyl', hoverSource: 'viewport' });
    render(<SelectionBreadcrumb />);

    expect(screen.getByTestId('selection-breadcrumb')).not.toHaveTextContent('Click to select');
    expect(screen.getByTitle('Select Subtract')).toBeEnabled();
  });

  it('hovering a crumb highlights that node in the viewport', () => {
    useModelerStore.setState({ selectedNodeId: 'cyl' });
    render(<SelectionBreadcrumb />);

    fireEvent.mouseEnter(screen.getByTitle('Select Subtract'));
    expect(useViewportStore.getState().hoveredNodeId).toBe('sub');

    // ...and the crumb the pointer is on stays clickable. Hovering it must not
    // read as a viewport preview, or the chip would swap to "click to select"
    // and disable the button the pointer was travelling towards.
    expect(screen.getByTestId('selection-breadcrumb')).not.toHaveTextContent('Click to select');
    expect(screen.getByTitle('Select Subtract')).toBeEnabled();

    fireEvent.mouseLeave(screen.getByTitle('Select Subtract'));
    expect(useViewportStore.getState().hoveredNodeId).toBeNull();
  });

  it('collapses a deep chain but keeps the root reachable', () => {
    // Eight levels: showing them all would squash every crumb to a stub in a
    // chip that is at most 60% of the viewport wide.
    let deep = node('leaf', 'box');
    for (let i = 0; i < 6; i++) deep = node(`wrap${i}`, 'translate', [deep]);
    deep = node('root', 'subtract', [deep]);
    useModelerStore.setState({ tree: deep, selectedNodeId: 'leaf' });

    render(<SelectionBreadcrumb />);
    const crumb = screen.getByTestId('selection-breadcrumb');

    expect(crumb).toHaveTextContent('…');
    // The root and the selection both survive the collapse.
    expect(screen.getByTitle('Select Subtract')).toBeInTheDocument();
    expect(crumb).toHaveTextContent('Box');
    // Root, ellipsis, and the last three.
    expect(crumb.querySelectorAll('button')).toHaveLength(4);
  });

  it('renders nothing without a tree', () => {
    useModelerStore.setState({ tree: null });
    const { container } = render(<SelectionBreadcrumb />);
    expect(container).toBeEmptyDOMElement();
  });
});
