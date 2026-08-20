import { playgroundError } from './session.js';

const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

// Session descriptor for the data-first Experiment Lab entry. It owns the
// shared World shell but intentionally has no model adapter of its own.
export const dataLabPlayground = {
  id: 'data-lab',
  domain: 'tabular',
  kind: 'session',
  version: 1,
  adapterId: null,
  titleKey: 'playground.dataLab.title',
  descriptionKey: 'playground.dataLab.description',
  supportedOps: [],
  supportedTasks: ['regression', 'classification'],
  sourceKinds: ['example', 'workspace-dataset'],
  controls: [],
  actions: ['ATTACH_MODEL', 'SET_WORKSPACE_VIEW', 'APPLY_WORLD_TRANSACTION', 'UNDO_WORLD_ACTION', 'REDO_WORLD_ACTION', 'RESTORE_ORIGINAL_DATA'],
  scenarios: [],

  validateSource(source) {
    if (!source || typeof source !== 'object') throw playgroundError('INVALID_PLAYGROUND_SOURCE');
    if (!['example', 'workspace-dataset'].includes(source.kind)) {
      throw playgroundError('INVALID_PLAYGROUND_SOURCE', { kind: source.kind });
    }
    const task = source.task === 'classification' ? 'classification' : 'regression';
    const featureColumns = Array.isArray(source.featureColumns)
      ? source.featureColumns.filter((feature) => typeof feature === 'string' && feature)
      : [];
    if (featureColumns.length < (task === 'classification' ? 2 : 1)) {
      throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'needs valid feature columns' });
    }
    const target = source.target ?? source.targetColumn ?? (task === 'regression' ? 'y' : 'label');
    const points = Array.isArray(source.points)
      ? source.points.map((point, index) => {
        const features = Object.fromEntries(featureColumns.map((feature) => [
          feature,
          finite(point.features?.[feature] ?? point[feature] ?? (feature === source.feature ? point.x : undefined)),
        ]));
        if (task === 'classification') {
          return { id: point.id ?? index, features, label: point.label, membership: point.membership, provenance: point.provenance };
        }
        const targetValue = finite(point.features?.[target] ?? point[target] ?? point.target ?? point.y);
        return {
          id: point.id ?? index,
          x: finite(point.x ?? features[source.feature ?? featureColumns[0]]),
          y: targetValue,
          target: targetValue,
          features: { ...features, [target]: targetValue },
          membership: point.membership,
          provenance: point.provenance,
        };
      }).filter((point) => (
        featureColumns.every((feature) => point.features[feature] !== null)
        && (task === 'classification'
          ? typeof point.label === 'string' && point.label.length > 0
          : Number.isFinite(point.y))
      ))
      : [];
    if (points.length < 2) throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'needs at least two valid observations' });
    return {
      ...source,
      kind: source.kind,
      name: source.name ?? 'Data Lab sample',
      fingerprint: source.fingerprint ?? `${source.name ?? 'data'}:${points.length}`,
      task,
      points,
      featureColumns,
      feature: source.feature ?? featureColumns[0],
      target,
      targetColumn: target,
      total: source.total ?? points.length,
      usingDataset: Boolean(source.usingDataset),
    };
  },
};
