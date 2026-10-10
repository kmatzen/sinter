/**
 * Collapse high-frequency internal progress samples to user-visible changes.
 *
 * Meshing can report thousands of fractional updates while the protocol only
 * exposes integer percentages. Posting every sample across the worker boundary
 * creates structured-clone and event-loop work without changing the UI.
 */
export function deduplicatedProgress(
  emit: (stage: string, percent: number) => void,
): (stage: string, percent: number) => void {
  let previousStage = '';
  let previousPercent = -1;
  return (stage, percent) => {
    const rounded = Math.max(0, Math.min(100, Math.round(percent)));
    if (stage === previousStage && rounded === previousPercent) return;
    previousStage = stage;
    previousPercent = rounded;
    emit(stage, rounded);
  };
}
