import { useViewportStore } from '../../store/viewportStore';

const VIEW_BUTTONS = [
  { label: 'F', view: 'front', title: 'Front' },
  { label: 'B', view: 'back', title: 'Back' },
  { label: 'L', view: 'left', title: 'Left' },
  { label: 'R', view: 'right', title: 'Right' },
  { label: 'T', view: 'top', title: 'Top' },
  { label: 'Bo', view: 'bottom', title: 'Bottom' },
  { label: 'P', view: 'iso', title: 'Perspective' },
];

export function ViewportToolbar() {
  const requestView = useViewportStore((s) => s.requestView);
  const clipEnabled = useViewportStore((s) => s.clipEnabled);
  const toggleClip = useViewportStore((s) => s.toggleClip);
  const clipAxis = useViewportStore((s) => s.clipAxis);
  const setClipAxis = useViewportStore((s) => s.setClipAxis);
  const clipPosition = useViewportStore((s) => s.clipPosition);
  const setClipPosition = useViewportStore((s) => s.setClipPosition);
  const xray = useViewportStore((s) => s.xray);
  const toggleXray = useViewportStore((s) => s.toggleXray);
  const heatmap = useViewportStore((s) => s.heatmap);
  const toggleHeatmap = useViewportStore((s) => s.toggleHeatmap);
  const resolution = useViewportStore((s) => s.resolution);
  const setResolution = useViewportStore((s) => s.setResolution);
  const showDimensions = useViewportStore((s) => s.showDimensions);
  const toggleDimensions = useViewportStore((s) => s.toggleDimensions);

  return (
    <>
      {/* Camera views - top right */}
      <div className="absolute top-3 right-3 flex gap-1">
        {VIEW_BUTTONS.map(({ label, view, title }) => (
          <button
            key={view}
            onClick={() => requestView(view)}
            title={title}
            className="w-7 h-7 bg-zinc-800/80 hover:bg-zinc-700 rounded text-[10px] text-zinc-300 font-medium"
          >
            {label}
          </button>
        ))}
      </div>

      {/* Resolution + Dimensions - top left */}
      <div className="absolute top-3 left-3 flex items-center gap-2">
        <div className="flex items-center gap-1 bg-zinc-800/80 rounded px-2 py-1">
          <span className="text-[10px] text-zinc-400">Res:</span>
          {[64, 128, 256].map((res) => (
            <button
              key={res}
              onClick={() => setResolution(res)}
              className={`px-1.5 py-0.5 rounded text-[10px] ${resolution === res ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              {res}
            </button>
          ))}
        </div>
        <button
          onClick={toggleDimensions}
          className={`px-2 py-1 rounded text-xs ${showDimensions ? 'bg-blue-600 text-white' : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700'}`}
        >
          Dims
        </button>
      </div>

      {/* Clip + X-ray controls - bottom left */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2">
        <button
          onClick={toggleXray}
          className={`px-2 py-1 rounded text-xs ${xray ? 'bg-blue-600 text-white' : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700'}`}
          title="X-Ray mode"
        >
          X-Ray
        </button>

        <button
          onClick={toggleHeatmap}
          className={`px-2 py-1 rounded text-xs ${heatmap ? 'bg-blue-600 text-white' : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700'}`}
          title="Wall thickness heatmap"
        >
          Thickness
        </button>

        <button
          onClick={toggleClip}
          className={`px-2 py-1 rounded text-xs ${clipEnabled ? 'bg-blue-600 text-white' : 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700'}`}
          title="Clipping plane"
        >
          Clip
        </button>

        {clipEnabled && (
          <div className="flex items-center gap-1 bg-zinc-800/80 rounded px-2 py-1">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <button
                key={axis}
                onClick={() => setClipAxis(axis)}
                className={`w-5 h-5 rounded text-[10px] font-medium ${clipAxis === axis ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
              >
                {axis.toUpperCase()}
              </button>
            ))}
            <input
              type="range"
              min={-100}
              max={100}
              step={0.5}
              value={clipPosition}
              onChange={(e) => setClipPosition(parseFloat(e.target.value))}
              className="w-24 h-1 ml-1"
            />
            <span className="text-[10px] text-zinc-400 w-10 text-right">{clipPosition.toFixed(1)}</span>
          </div>
        )}
      </div>
    </>
  );
}
