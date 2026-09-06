export type ViewProjection = 'perspective' | 'orthographic';

export interface NamedProjectView {
  id: string;
  name: string;
  createdAt: string;
  position: [number, number, number];
  target: [number, number, number];
  up: [number, number, number];
  projection: ViewProjection;
  /** Visible world-space height at the orbit target. */
  verticalSpan: number;
  clipping: {
    enabled: boolean;
    axis: 'x' | 'y' | 'z';
    position: number;
    flip: boolean;
  };
}
