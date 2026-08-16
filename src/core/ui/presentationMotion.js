// Presentation-only identity derivation. Experiment IDs remain runtime-owned;
// this helper only identifies which existing runtime item entered the view.
export function deriveNewExperimentIds(previousIds = [], currentIds = []) {
  const previous = new Set(previousIds);
  return currentIds.filter((id) => !previous.has(id));
}
