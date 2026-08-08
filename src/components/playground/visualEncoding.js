// Shared label -> color encoding for the unified playground UI.
//
// The mapping is deterministic, model-agnostic and lives in the UI layer:
// model adapters emit semantic labels, never colors, and scripts only decide
// which primitives to show. Stage and Inspector build the same map from the
// scatter points so one label always renders with one color everywhere.

export const LABEL_COLORS = [
  '#2563eb',
  '#7c3aed',
  '#059669',
  '#d97706',
  '#dc2626',
  '#0891b2',
];

export function buildLabelColorMap(points = []) {
  const labels = [
    ...new Set(
      (Array.isArray(points) ? points : [])
        .map((point) => point?.label)
        .filter((label) => label !== undefined && label !== null),
    ),
  ].sort();
  return Object.fromEntries(
    labels.map((label, index) => [
      label,
      LABEL_COLORS[index % LABEL_COLORS.length],
    ]),
  );
}
