import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseProfile, parseRevolveProfile } from '../../worker/sdf/profile';
import { ProfileEditor } from './ProfileEditor';

const plate = '{"outer":[[-20,-15],[20,-15],[20,15],[-20,15]],"holes":[]}';
const knob = '{"outer":[[0,-15],[12,-15],[12,15],[0,15]],"holes":[]}';

describe('ProfileEditor', () => {
  afterEach(cleanup);

  it('commits a numeric vertex edit only when the field is finished', () => {
    const commit = vi.fn();
    render(<ProfileEditor value={plate} fallback={plate} revolve={false} validate={parseProfile} onCommit={commit} />);
    const x = screen.getByLabelText('Selected vertex X');
    fireEvent.change(x, { target: { value: '-10' } });
    expect(commit).not.toHaveBeenCalled();
    fireEvent.blur(x);
    expect(JSON.parse(commit.mock.calls[0][0]).outer[0]).toEqual([-10, -15]);
  });

  it('adds and removes vertices through keyboard-accessible controls', () => {
    const commit = vi.fn();
    render(<ProfileEditor value={plate} fallback={plate} revolve={false} validate={parseProfile} onCommit={commit} />);
    fireEvent.click(screen.getByLabelText('Add vertex after selected'));
    expect(JSON.parse(commit.mock.calls[0][0]).outer).toHaveLength(5);
    fireEvent.click(screen.getByLabelText('Remove selected vertex'));
    expect(JSON.parse(commit.mock.calls[1][0]).outer).toHaveLength(4);
  });

  it('keeps invalid revolve edits out of the document', () => {
    const commit = vi.fn();
    render(<ProfileEditor value={knob} fallback={knob} revolve validate={parseRevolveProfile} onCommit={commit} />);
    const radius = screen.getByLabelText('Selected vertex radius');
    fireEvent.change(radius, { target: { value: '-1' } });
    fireEvent.blur(radius);
    expect(screen.getByRole('alert')).toHaveTextContent('radius coordinates must be non-negative');
    expect(commit).not.toHaveBeenCalled();
  });

  it('grows revolve profiles away from the radial minimum', () => {
    const commit = vi.fn();
    render(<ProfileEditor value={knob} fallback={knob} revolve validate={parseRevolveProfile} onCommit={commit} />);
    const span = screen.getByLabelText('Profile radial span');
    fireEvent.change(span, { target: { value: '24' } });
    fireEvent.blur(span);
    const result = parseRevolveProfile(commit.mock.calls[0][0]);
    expect(Math.min(...result.outer.map((p) => p[0]))).toBe(0);
    expect(Math.max(...result.outer.map((p) => p[0]))).toBe(24);
  });

  it('commits a selected edge as a native circular arc', () => {
    const commit = vi.fn();
    render(<ProfileEditor value={plate} fallback={plate} revolve={false} validate={parseProfile} onCommit={commit} />);
    const bulge = screen.getByLabelText('Selected edge bulge');
    fireEvent.change(bulge, { target: { value: '0.4142135624' } });
    fireEvent.blur(bulge);
    const result = parseProfile(commit.mock.calls[0][0]);
    expect(result.bulges?.[0]).toBeCloseTo(Math.tan(Math.PI / 8));
    fireEvent.click(screen.getByRole('button', { name: 'Add vertex after selected' }));
    const split = parseProfile(commit.mock.calls[1][0]);
    expect(split.outer).toHaveLength(5);
    expect(split.bulges?.[0]).toBeCloseTo(Math.tan(Math.PI / 16));
    expect(split.bulges?.[1]).toBeCloseTo(Math.tan(Math.PI / 16));
  });

  it('scales the complete profile to an entered dimension', () => {
    const commit = vi.fn();
    render(<ProfileEditor value={plate} fallback={plate} revolve={false} validate={parseProfile} onCommit={commit} />);
    const width = screen.getByLabelText('Profile width');
    fireEvent.change(width, { target: { value: '80' } });
    fireEvent.blur(width);
    const result = parseProfile(commit.mock.calls[0][0]);
    expect(Math.max(...result.outer.map((p) => p[0])) - Math.min(...result.outer.map((p) => p[0]))).toBe(80);
  });
});
