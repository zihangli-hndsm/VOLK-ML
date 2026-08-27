// Explore workspace ownership is a session-level projection around the
// existing playground runtime. It does not own a second runtime or persist
// learner state; it only makes the Build/Explore boundary explicit.

export const EXPLORE_WORKSPACE_VERSION = 1;
export const WORKSPACE_KINDS = Object.freeze({ BUILD: 'build', EXPLORE: 'explore' });
export const EXPLORE_WORKSPACE_LIFECYCLES = Object.freeze({ PERSISTENT: 'persistent', EPHEMERAL: 'ephemeral' });

const bounded = (value, limit = 160) => {
  const normalized = typeof value === 'string' ? value.trim().slice(0, limit) : '';
  return normalized || null;
};

const stableFingerprint = (value) => JSON.stringify(value, Object.keys(value ?? {}).sort());

function datasetMeetsAdapterContract(dataset, adapterId) {
  const features = Array.isArray(dataset?.featureColumns) ? dataset.featureColumns : [];
  const target = dataset?.targetColumn;
  const columns = new Map((dataset?.columns ?? []).map((column) => [column.name, column]));
  if (!Array.isArray(dataset?.rows) || !target || features.length < 1) return false;
  if (!features.every((feature) => columns.get(feature)?.type === 'number')) return false;
  if (adapterId === 'linear-regression' && dataset.task !== 'regression') return false;
  if (['knn', 'mlp'].includes(adapterId) && (dataset.task !== 'classification' || features.length < 2)) return false;
  const validRows = dataset.rows.filter((row) => features.every((feature) => Number.isFinite(Number(row?.[feature]))) && row?.[target] !== undefined && row?.[target] !== null && String(row[target]) !== '');
  const labels = new Set(validRows.map((row) => String(row[target])));
  return validRows.length >= 2 && (adapterId === 'linear-regression' ? validRows.every((row) => Number.isFinite(Number(row[target]))) : labels.size === 2);
}

export function createExploreEnvironmentIdentity({
  recipeId = null,
  playgroundId = null,
  modelAdapterId = null,
  sourceFingerprint = null,
} = {}) {
  const identity = {
    version: EXPLORE_WORKSPACE_VERSION,
    recipeId: bounded(recipeId),
    playgroundId: bounded(playgroundId),
    modelAdapterId: bounded(modelAdapterId),
    sourceFingerprint: bounded(sourceFingerprint, 240),
  };
  return Object.freeze({
    ...identity,
    environmentFingerprint: stableFingerprint(identity),
  });
}

export function compareExploreEnvironment(expected, actual) {
  const expectedIdentity = createExploreEnvironmentIdentity(expected ?? {});
  const actualIdentity = createExploreEnvironmentIdentity(actual ?? {});
  const fields = ['recipeId', 'playgroundId', 'modelAdapterId', 'sourceFingerprint'];
  const mismatches = fields.filter((field) => expectedIdentity[field] !== null && expectedIdentity[field] !== actualIdentity[field]);
  return Object.freeze({
    compatible: mismatches.length === 0,
    mismatches: Object.freeze(mismatches),
    expected: expectedIdentity,
    actual: actualIdentity,
  });
}

export function createExploreWorkspaceRecord({
  id,
  recipeId,
  playgroundId,
  environment,
  sessionId = null,
  lifecycle = EXPLORE_WORKSPACE_LIFECYCLES.PERSISTENT,
} = {}) {
  const workspaceId = bounded(id) ?? `explore-${bounded(recipeId) ?? bounded(playgroundId) ?? 'session'}`;
  const workspaceLifecycle = Object.values(EXPLORE_WORKSPACE_LIFECYCLES).includes(lifecycle)
    ? lifecycle
    : EXPLORE_WORKSPACE_LIFECYCLES.PERSISTENT;
  return Object.freeze({
    version: EXPLORE_WORKSPACE_VERSION,
    id: workspaceId,
    kind: WORKSPACE_KINDS.EXPLORE,
    recipeId: bounded(recipeId),
    playgroundId: bounded(playgroundId),
    environment: createExploreEnvironmentIdentity(environment),
    sessionId: bounded(sessionId),
    lifecycle: workspaceLifecycle,
  });
}

export function createBuildExploreBridge({ build, target = null } = {}) {
  const requestedTarget = bounded(target);
  const dataset = build?.dataset;
  const adapterId = bounded(build?.modelAdapterId ?? build?.adapterId);
  const taskCompatible = ({ 'linear-regression': 'regression', knn: 'classification', mlp: 'classification' }[adapterId] ?? null) === dataset?.task;
  const supported = Boolean(
    requestedTarget === 'data-lab'
    && dataset
    && adapterId
    && ['linear-regression', 'knn', 'mlp'].includes(adapterId)
    && dataset.task
    && taskCompatible
    && Array.isArray(dataset.rows)
    && datasetMeetsAdapterContract(dataset, adapterId)
  );
  return Object.freeze({
    version: EXPLORE_WORKSPACE_VERSION,
    supported,
    kind: 'explicit-build-bridge',
    target: requestedTarget,
    reason: supported ? null : 'unsupported-build-configuration',
    workspace: supported
      ? createExploreWorkspaceRecord({
        id: `explore-custom-${requestedTarget}`,
        recipeId: `build-fork-${requestedTarget}`,
        playgroundId: requestedTarget,
        environment: { recipeId: `build-fork-${requestedTarget}`, playgroundId: requestedTarget, modelAdapterId: adapterId },
        lifecycle: EXPLORE_WORKSPACE_LIFECYCLES.EPHEMERAL,
      })
      : null,
    modelPlaygroundId: supported
      ? ({ 'linear-regression': 'linear-regression', knn: 'knn-classification', mlp: 'mlp-classification' }[adapterId] ?? null)
      : null,
  });
}
