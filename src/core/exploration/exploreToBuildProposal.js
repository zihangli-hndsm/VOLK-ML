import { artifactFingerprintJsonV1 } from '../graph/artifactFingerprint.js';
import { createGraphPatchProposal, validateGraphPatchProposal } from '../graph/graphPatchProposal.js';
import { graphPatchBaseFromProject } from '../graph/workspacePatchApply.js';

export const EXPLORE_TO_BUILD_PROPOSAL_TYPE = 'ExploreToBuildProposalV1';
export const EXPLORE_TO_BUILD_PROPOSAL_VERSION = 1;

const ROOT_FIELDS = [
  'type', 'version', 'proposalId', 'source', 'conditions', 'runs',
  'measurements', 'change', 'derivedChanges', 'graphPatchProposal',
];
const SOURCE_FIELDS = [
  'sessionType', 'sessionVersion', 'sessionId', 'comparisonId', 'runIds',
  'projectSessionId', 'graphSemanticFingerprint', 'registryIdentity',
  'dataset', 'split', 'training',
];
const RUN_FIELDS = [
  'runId', 'role', 'status', 'configuration', 'provenance', 'metrics',
];
const CONFIGURATION_FIELDS = [
  'width', 'graphSemanticFingerprint', 'datasetFingerprint',
  'splitIdentity', 'trainingIdentity', 'seed', 'epochs', 'batchSize',
  'shuffle', 'loss', 'optimizer',
];
const PROVENANCE_FIELDS = ['source', 'evaluatorNodeId', 'modelNodeId', 'runId'];
const TASK_METRICS = Object.freeze({
  classification: Object.freeze(['accuracy', 'macroF1']),
  regression: Object.freeze(['rmse', 'r2']),
});
const TRANSFER_RATIONALE = 'g3:paired-capacity-transfer-v1';

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype);
}

function exactKeys(value, allowed, path, errors) {
  if (!isRecord(value)) {
    errors.push(`${path}:object-required`);
    return false;
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) errors.push(`${path}:unknown:${unknown.join(',')}`);
  return unknown.length === 0;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function jsonValueIssues(value, path = 'proposal', ancestors = new WeakSet(), issues = []) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return issues;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) issues.push(`${path}:non-finite`);
    return issues;
  }
  if (typeof value !== 'object' || ancestors.has(value)) {
    issues.push(`${path}:not-json`);
    return issues;
  }
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) {
    issues.push(`${path}:not-plain`);
    return issues;
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length) issues.push(`${path}:array-shape`);
    value.forEach((item, index) => jsonValueIssues(item, `${path}[${index}]`, ancestors, issues));
  } else {
    Object.entries(value).forEach(([key, item]) => jsonValueIssues(item, `${path}.${key}`, ancestors, issues));
  }
  ancestors.delete(value);
  return issues;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function boundedId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 160
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function requiredId(value, path, errors) {
  if (!boundedId(value)) errors.push(`${path}:invalid-id`);
}

function validMetrics(value, task, path, errors) {
  const allowed = TASK_METRICS[task] ?? [];
  if (!exactKeys(value, allowed, path, errors)) return [];
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || allowed.some((key) => !Object.hasOwn(value, key))) errors.push(`${path}:incomplete`);
  keys.forEach((key) => {
    if (!finite(value[key])) errors.push(`${path}.${key}:non-finite`);
  });
  return keys;
}

function equalIdentityFields(source, snapshot, inspection, current, projectSessionId, errors) {
  const expected = {
    sourceProjectSessionId: snapshot.projectSessionId,
    currentProjectSessionId: projectSessionId,
    sourceGraph: inspection.graphFingerprint,
    currentGraph: current.graphFingerprint,
    snapshotGraph: snapshot.graphIdentity?.semanticFingerprint,
    provenanceGraph: snapshot.provenance?.graphFingerprint,
    sourceDataset: inspection.datasetFingerprint,
    currentDataset: current.datasetFingerprint,
    snapshotDataset: snapshot.dataset?.fingerprint,
    sourceTraining: inspection.trainingConfigFingerprint,
    currentTraining: current.trainingConfigFingerprint,
    snapshotTraining: snapshot.training?.identity,
    sourceSplit: inspection.split?.identity,
    currentSplit: current.split?.identity,
    snapshotSplit: snapshot.split?.identity,
    sourceHiddenNode: inspection.hiddenNodeId,
    snapshotHiddenNode: snapshot.selectedHiddenNode?.nodeId,
    sourceOutputNode: inspection.outputNodeId,
    snapshotOutputNode: snapshot.capacity?.derivedOutputNodeId,
    sourceBaselineWidth: inspection.baselineWidth,
    snapshotBaselineWidth: snapshot.capacity?.baselineWidth,
  };
  const equalPairs = [
    ['sourceProjectSessionId', 'currentProjectSessionId'],
    ['sourceGraph', 'currentGraph'],
    ['sourceGraph', 'snapshotGraph'],
    ['sourceGraph', 'provenanceGraph'],
    ['sourceDataset', 'currentDataset'],
    ['sourceDataset', 'snapshotDataset'],
    ['sourceTraining', 'currentTraining'],
    ['sourceTraining', 'snapshotTraining'],
    ['sourceSplit', 'currentSplit'],
    ['sourceSplit', 'snapshotSplit'],
    ['sourceHiddenNode', 'snapshotHiddenNode'],
    ['sourceOutputNode', 'snapshotOutputNode'],
    ['sourceBaselineWidth', 'snapshotBaselineWidth'],
  ];
  equalPairs.forEach(([left, right]) => {
    if (expected[left] === undefined || expected[right] === undefined || expected[left] !== expected[right]) {
      errors.push(`identity:${left}:${right}`);
    }
  });
  if (source !== snapshot.provenance?.projectSessionId) errors.push('identity:provenance-project-session');
}

function copyTraining(training) {
  return {
    identity: training.identity,
    seed: training.seed,
    epochs: training.epochs,
    batchSize: training.batchSize,
    shuffle: training.shuffle,
    loss: training.loss,
    optimizer: structuredClone(training.optimizer),
  };
}

function expectedRunConfiguration({ run, training, dataset, split }) {
  return {
    width: run.width,
    graphSemanticFingerprint: run.graphFingerprint,
    datasetFingerprint: dataset.fingerprint,
    splitIdentity: split.identity,
    trainingIdentity: training.identity,
    seed: training.seed,
    epochs: training.epochs,
    batchSize: training.batchSize,
    shuffle: training.shuffle,
    loss: training.loss,
    optimizer: structuredClone(training.optimizer),
  };
}

function sourceSnapshotMatchesInspection(snapshot, inspection, errors) {
  const dataset = snapshot.dataset;
  const split = snapshot.split;
  const training = snapshot.training;
  if (dataset?.task !== inspection.task
    || dataset?.fingerprint !== inspection.datasetFingerprint
    || dataset?.target !== inspection.targetColumn
    || stableJson(dataset?.features) !== stableJson(inspection.featureColumns)) errors.push('source:dataset-projection');
  if (split?.identity !== inspection.split?.identity
    || split?.seed !== inspection.split?.seed
    || split?.trainRatio !== inspection.split?.trainRatio
    || split?.trainRows !== inspection.split?.trainRows
    || split?.testRows !== inspection.split?.testRows) errors.push('source:split-projection');
  if (training?.identity !== inspection.trainingConfigFingerprint
    || training?.seed !== inspection.seed
    || training?.epochs !== inspection.trainerSettings?.epochs
    || training?.batchSize !== inspection.trainerSettings?.batch_size
    || training?.shuffle !== inspection.trainerSettings?.shuffle
    || training?.loss !== inspection.lossOp
    || stableJson(training?.optimizer) !== stableJson(inspection.optimizer)) errors.push('source:training-projection');
}

function makeOperations(baseGraph, hiddenNodeId, outputNodeId, variantWidth) {
  const hidden = baseGraph.nodes.filter((node) => node.id === hiddenNodeId);
  const output = baseGraph.nodes.filter((node) => node.id === outputNodeId);
  if (hidden.length !== 1 || output.length !== 1
    || hidden[0].data?.manifest?.op !== 'dense'
    || output[0].data?.manifest?.op !== 'dense') return null;
  const hiddenParams = hidden[0].data.parameters;
  const outputParams = output[0].data.parameters;
  if (!isRecord(hiddenParams) || !isRecord(outputParams)
    || !Number.isSafeInteger(hiddenParams.units)
    || outputParams.input_features !== hiddenParams.units
    || !Number.isSafeInteger(variantWidth) || variantWidth === hiddenParams.units) return null;
  return [
    {
      op: 'UPDATE_PARAMETERS',
      nodeId: hiddenNodeId,
      parameters: { ...structuredClone(hiddenParams), units: variantWidth },
    },
    {
      op: 'UPDATE_PARAMETERS',
      nodeId: outputNodeId,
      parameters: { ...structuredClone(outputParams), input_features: variantWidth },
    },
  ];
}

function checkPatchOperations(patch, baseGraph, proposal, errors) {
  const { change, derivedChanges } = proposal;
  if (!Array.isArray(patch.operations) || patch.operations.length !== 2) {
    errors.push('patch:operation-count');
    return;
  }
  const [hiddenUpdate, outputUpdate] = patch.operations;
  const hiddenNode = baseGraph.nodes.find((node) => node.id === change.nodeId);
  const derived = derivedChanges[0];
  const outputNode = baseGraph.nodes.find((node) => node.id === derived?.nodeId);
  if (!hiddenNode || !outputNode
    || hiddenUpdate?.op !== 'UPDATE_PARAMETERS'
    || hiddenUpdate.nodeId !== change.nodeId
    || outputUpdate?.op !== 'UPDATE_PARAMETERS'
    || outputUpdate.nodeId !== derived?.nodeId) {
    errors.push('patch:operation-target');
    return;
  }
  const hiddenKeys = Object.keys(hiddenUpdate.parameters ?? {}).filter((key) => (
    hiddenUpdate.parameters[key] !== hiddenNode.data.parameters[key]
  ));
  const outputKeys = Object.keys(outputUpdate.parameters ?? {}).filter((key) => (
    outputUpdate.parameters[key] !== outputNode.data.parameters[key]
  ));
  if (stableJson(hiddenUpdate.parameters) !== stableJson({ ...hiddenNode.data.parameters, units: change.to })) errors.push('patch:hidden-parameters');
  if (stableJson(outputUpdate.parameters) !== stableJson({ ...outputNode.data.parameters, input_features: derived.to })) errors.push('patch:derived-parameters');
  if (stableJson(hiddenKeys) !== stableJson(['units'])) errors.push('patch:hidden-extra-change');
  if (stableJson(outputKeys) !== stableJson(['input_features'])) errors.push('patch:derived-extra-change');
  const checked = validateGraphPatchProposal(patch);
  if (!checked.valid) errors.push('patch:c1-invalid');
  else {
    const hiddenResult = checked.resultGraph.nodes.find((node) => node.id === change.nodeId);
    const outputResult = checked.resultGraph.nodes.find((node) => node.id === derived.nodeId);
    if (hiddenResult?.data?.parameters?.units !== change.to
      || outputResult?.data?.parameters?.input_features !== derived.to) errors.push('patch:replay-result');
    if (checked.resultGraph.edges.length !== baseGraph.edges.length
      || stableJson(checked.resultGraph.edges) !== stableJson(baseGraph.edges)) errors.push('patch:edges-changed');
  }
}

function validateProposalShape(value) {
  const errors = [];
  errors.push(...jsonValueIssues(value));
  if (errors.length) return { valid: false, errors };
  if (!exactKeys(value, ROOT_FIELDS, 'proposal', errors)) return { valid: false, errors };
  if (value.type !== EXPLORE_TO_BUILD_PROPOSAL_TYPE || value.version !== EXPLORE_TO_BUILD_PROPOSAL_VERSION) errors.push('proposal:version');
  requiredId(value.proposalId, 'proposal.proposalId', errors);
  if (exactKeys(value.source, SOURCE_FIELDS, 'source', errors)) {
    if (value.source.sessionType !== 'ExploreBridgeSessionV1' || value.source.sessionVersion !== 1) errors.push('source:session-type');
    for (const key of ['sessionId', 'comparisonId', 'projectSessionId', 'graphSemanticFingerprint']) requiredId(value.source[key], `source.${key}`, errors);
    if (!Array.isArray(value.source.runIds) || value.source.runIds.length !== 2
      || value.source.runIds.some((id) => !boundedId(id))
      || value.source.runIds[0] === value.source.runIds[1]) errors.push('source:run-ids');
    if (exactKeys(value.source.registryIdentity, ['componentId', 'op'], 'source.registryIdentity', errors)) {
      if (value.source.registryIdentity.componentId !== 'dense_node' || value.source.registryIdentity.op !== 'dense') errors.push('source:registry-component');
    }
    if (exactKeys(value.source.dataset, ['fingerprint', 'features', 'target', 'task'], 'source.dataset', errors)) {
      requiredId(value.source.dataset.fingerprint, 'source.dataset.fingerprint', errors);
      if (!Array.isArray(value.source.dataset.features) || !value.source.dataset.features.length
        || value.source.dataset.features.some((feature) => typeof feature !== 'string' || !feature || feature.length > 120)) errors.push('source.dataset.features');
      if (typeof value.source.dataset.target !== 'string' || !value.source.dataset.target) errors.push('source.dataset.target');
      if (!TASK_METRICS[value.source.dataset.task]) errors.push('source.dataset.task');
    }
    if (exactKeys(value.source.split, ['identity', 'seed', 'trainRatio', 'trainRows', 'testRows'], 'source.split', errors)) {
      requiredId(value.source.split.identity, 'source.split.identity', errors);
      if (!Number.isSafeInteger(value.source.split.seed) || !finite(value.source.split.trainRatio)
        || !Number.isSafeInteger(value.source.split.trainRows) || value.source.split.trainRows < 1
        || !Number.isSafeInteger(value.source.split.testRows) || value.source.split.testRows < 1) errors.push('source.split:values');
    }
    if (exactKeys(value.source.training, ['identity', 'seed', 'epochs', 'batchSize', 'shuffle', 'loss', 'optimizer'], 'source.training', errors)) {
      requiredId(value.source.training.identity, 'source.training.identity', errors);
      if (!Number.isSafeInteger(value.source.training.seed)
        || !Number.isSafeInteger(value.source.training.epochs) || value.source.training.epochs < 1
        || !Number.isSafeInteger(value.source.training.batchSize) || value.source.training.batchSize < 1
        || typeof value.source.training.shuffle !== 'boolean'
        || typeof value.source.training.loss !== 'string') errors.push('source.training:values');
      if (exactKeys(value.source.training.optimizer, ['op', 'parameters'], 'source.training.optimizer', errors)
        && (typeof value.source.training.optimizer.op !== 'string' || !isRecord(value.source.training.optimizer.parameters))) errors.push('source.training.optimizer:values');
    }
  }
  if (exactKeys(value.conditions, ['interpretation', 'sameSeedWeightNote', 'claimBoundary'], 'conditions', errors)) {
    if (value.conditions.interpretation !== 'paired-explore-measurement'
      || value.conditions.sameSeedWeightNote !== 'different-width-initialization-shape'
      || value.conditions.claimBoundary !== 'exact-pair-only') errors.push('conditions:claim-boundary');
  }
  if (!Array.isArray(value.runs) || value.runs.length !== 2) errors.push('runs:pair-required');
  else {
    const task = value.source?.dataset?.task;
    value.runs.forEach((run, index) => {
      const prefix = `runs[${index}]`;
      if (!exactKeys(run, RUN_FIELDS, prefix, errors)) return;
      if (run.runId !== value.source?.runIds?.[index]
        || run.role !== (index === 0 ? 'baseline' : 'variant')
        || run.status !== 'succeeded') errors.push(`${prefix}:identity`);
      if (exactKeys(run.configuration, CONFIGURATION_FIELDS, `${prefix}.configuration`, errors)) {
        if (!Number.isSafeInteger(run.configuration.width)
          || !boundedId(run.configuration.graphSemanticFingerprint)
          || run.configuration.datasetFingerprint !== value.source?.dataset?.fingerprint
          || run.configuration.splitIdentity !== value.source?.split?.identity
          || run.configuration.trainingIdentity !== value.source?.training?.identity
          || run.configuration.seed !== value.source?.training?.seed
          || run.configuration.epochs !== value.source?.training?.epochs
          || run.configuration.batchSize !== value.source?.training?.batchSize
          || run.configuration.shuffle !== value.source?.training?.shuffle
          || run.configuration.loss !== value.source?.training?.loss
          || stableJson(run.configuration.optimizer) !== stableJson(value.source?.training?.optimizer)) errors.push(`${prefix}:configuration`);
      }
      if (exactKeys(run.provenance, PROVENANCE_FIELDS, `${prefix}.provenance`, errors)) {
        if (run.provenance.source !== 'executeBrowserGraph'
          || run.provenance.runId !== run.runId
          || !boundedId(run.provenance.evaluatorNodeId)
          || !boundedId(run.provenance.modelNodeId)) errors.push(`${prefix}:provenance`);
      }
      validMetrics(run.metrics, task, `${prefix}.metrics`, errors);
    });
  }
  if (exactKeys(value.measurements, ['metrics'], 'measurements', errors)) {
    if (!Array.isArray(value.measurements.metrics) || value.measurements.metrics.length === 0) errors.push('measurements:empty');
    else {
      const seen = new Set();
      value.measurements.metrics.forEach((item, index) => {
        const prefix = `measurements.metrics[${index}]`;
        if (!exactKeys(item, ['metric', 'baseline', 'variant', 'delta'], prefix, errors)) return;
        if (typeof item.metric !== 'string' || seen.has(item.metric)) errors.push(`${prefix}:metric`);
        seen.add(item.metric);
        if (!finite(item.baseline) || !finite(item.variant) || !finite(item.delta)
          || item.delta !== item.variant - item.baseline) errors.push(`${prefix}:value`);
      });
    }
  }
  if (exactKeys(value.change, ['parameter', 'nodeId', 'from', 'to'], 'change', errors)) {
    if (value.change.parameter !== 'Dense.units' || !boundedId(value.change.nodeId)
      || !Number.isSafeInteger(value.change.from) || !Number.isSafeInteger(value.change.to)
      || value.change.from === value.change.to) errors.push('change:invalid');
  }
  if (!Array.isArray(value.derivedChanges) || value.derivedChanges.length !== 1) errors.push('derivedChanges:count');
  else if (exactKeys(value.derivedChanges[0], ['parameter', 'nodeId', 'from', 'to'], 'derivedChanges[0]', errors)) {
    if (value.derivedChanges[0].parameter !== 'Dense.input_features'
      || !boundedId(value.derivedChanges[0].nodeId)
      || !Number.isSafeInteger(value.derivedChanges[0].from)
      || !Number.isSafeInteger(value.derivedChanges[0].to)
      || value.derivedChanges[0].from !== value.change?.from
      || value.derivedChanges[0].to !== value.change?.to) errors.push('derivedChanges:value');
  }
  if (value.runs?.length === 2 && Array.isArray(value.source?.runIds)) {
    const [baseline, variant] = value.runs;
    if (isRecord(baseline) && isRecord(variant)) {
      const baselineMetrics = isRecord(baseline.metrics) ? baseline.metrics : {};
      const variantMetrics = isRecord(variant.metrics) ? variant.metrics : {};
      const sharedMetrics = Object.keys(baselineMetrics).filter((key) => Object.hasOwn(variantMetrics, key));
      const expected = sharedMetrics.map((metric) => ({
        metric,
        baseline: baselineMetrics[metric],
        variant: variantMetrics[metric],
        delta: variantMetrics[metric] - baselineMetrics[metric],
      }));
      if (stableJson(value.measurements?.metrics) !== stableJson(expected)) errors.push('measurements:run-mismatch');
      if (baseline.configuration?.width !== value.change?.from
        || variant.configuration?.width !== value.change?.to) errors.push('runs:width-mismatch');
    }
    if (value.source?.training?.seed !== value.source?.split?.seed) errors.push('source:seed-mismatch');
  }
  const patchCheck = validateGraphPatchProposal(value.graphPatchProposal);
  if (!patchCheck.valid) errors.push('patch:c1-invalid');
  else {
    if (patchCheck.proposal.source?.producer !== 'adapter'
      || patchCheck.proposal.source?.provenance?.artifactId !== 'g3-explore-to-build-v1'
      || patchCheck.proposal.rationale !== TRANSFER_RATIONALE) errors.push('patch:source');
  }
  if (value.proposalId) {
    const { proposalId: _proposalId, ...withoutId } = value;
    const expectedId = `explore-to-build-${artifactFingerprintJsonV1(withoutId)}`;
    if (value.proposalId !== expectedId) errors.push('proposal:identity');
  }
  if (errors.length === 0) {
    const baseGraph = value.graphPatchProposal.baseGraph;
    checkPatchOperations(value.graphPatchProposal, baseGraph, value, errors);
  }
  return { valid: errors.length === 0, errors };
}

/** Build a volatile transfer contract from the bridge's resolved live source records. */
export function createExploreToBuildProposalV1({
  resolvedSource,
  sourceInspection,
  currentInspection,
  currentProjectSessionId,
} = {}) {
  const sessionSnapshot = resolvedSource?.sessionSnapshot;
  const comparison = resolvedSource?.comparison;
  const runs = resolvedSource?.runs;
  const initialErrors = [];
  if (sessionSnapshot?.type !== 'ExploreBridgeSessionV1' || sessionSnapshot.version !== 1) initialErrors.push('session:unsupported');
  if (sessionSnapshot?.lifecycle !== 'completed' || !sessionSnapshot?.comparison
    || stableJson(comparison) !== stableJson(sessionSnapshot.comparison)) initialErrors.push('session:not-completed');
  if (!sourceInspection?.supported || !currentInspection?.supported) initialErrors.push('source:unsupported');
  if (initialErrors.length) return { ok: false, reasonCode: 'EXPLORE_TO_BUILD_SOURCE_INVALID', diagnostics: initialErrors };

  equalIdentityFields(
    sessionSnapshot.projectSessionId,
    sessionSnapshot,
    sourceInspection,
    currentInspection,
    currentProjectSessionId,
    initialErrors,
  );
  sourceSnapshotMatchesInspection(sessionSnapshot, sourceInspection, initialErrors);
  if (stableJson(sourceInspection.hiddenNodeRegistryIdentity) !== stableJson(currentInspection.hiddenNodeRegistryIdentity)) initialErrors.push('identity:registry');
  if (initialErrors.length) return { ok: false, reasonCode: 'EXPLORE_TO_BUILD_SOURCE_STALE', diagnostics: initialErrors };

  const snapshotRuns = sessionSnapshot.runs;
  const snapshotRunsById = new Map();
  if (!Array.isArray(snapshotRuns) || snapshotRuns.length !== 2
    || new Set(snapshotRuns.map((run) => run?.runId)).size !== snapshotRuns.length
    || snapshotRuns.some((run) => !run?.runId)) {
    return { ok: false, reasonCode: 'EXPLORE_TO_BUILD_RUN_PAIR_INVALID' };
  }
  snapshotRuns.forEach((run) => snapshotRunsById.set(run.runId, run));
  if (!Array.isArray(runs) || runs.length !== 2
    || runs[0]?.role !== 'baseline' || runs[1]?.role !== 'variant'
    || !runs[0]?.runId || !runs[1]?.runId || runs[0].runId === runs[1].runId
    || runs.some((run) => stableJson(snapshotRunsById.get(run.runId)) !== stableJson(run))
    || comparison.runIds?.length !== 2
    || comparison.runIds[0] !== runs[0].runId || comparison.runIds[1] !== runs[1].runId) {
    return { ok: false, reasonCode: 'EXPLORE_TO_BUILD_RUN_PAIR_INVALID' };
  }
  const sourceDataset = sessionSnapshot.dataset;
  const sourceSplit = sessionSnapshot.split;
  const sourceTraining = sessionSnapshot.training;
  if (comparison.datasetFingerprint !== sourceDataset?.fingerprint
    || comparison.splitIdentity !== sourceSplit?.identity
    || comparison.trainingIdentity !== sourceTraining?.identity
    || comparison.seed !== sourceTraining?.seed
    || comparison.task !== sourceDataset?.task
    || comparison.interpretation !== 'descriptive-capacity-comparison'
    || stableJson(comparison.metricProvenance) !== stableJson(runs.map((run) => run.metricProvenance))) {
    return { ok: false, reasonCode: 'EXPLORE_TO_BUILD_COMPARISON_INVALID' };
  }
  const expectedMetricNames = TASK_METRICS[sourceDataset?.task] ?? [];
  const sortedExpectedMetricNames = [...expectedMetricNames].sort();
  if (runs.some((run) => {
    const metricNames = Object.keys(run.metrics ?? {}).sort();
    return metricNames.length !== expectedMetricNames.length
      || metricNames.some((name, index) => name !== sortedExpectedMetricNames[index])
      || expectedMetricNames.some((name) => !finite(run.metrics?.[name]));
  })) return { ok: false, reasonCode: 'EXPLORE_TO_BUILD_METRICS_INCOMPLETE' };
  const hiddenNodeId = sourceInspection.hiddenNodeId;
  const outputNodeId = sourceInspection.outputNodeId;
  const from = sourceInspection.baselineWidth;
  const to = comparison.widths?.variant;
  const baseGraph = graphPatchBaseFromProject({
    graph: { nodes: sourceInspection.source.nodes, edges: sourceInspection.source.edges },
    customComponents: [],
  });
  const operations = makeOperations(baseGraph, hiddenNodeId, outputNodeId, to);
  if (!operations || comparison.widths?.baseline !== from
    || runs[0].width !== from || runs[1].width !== to) {
    return { ok: false, reasonCode: 'EXPLORE_TO_BUILD_CONFIGURATION_INVALID' };
  }

  const source = {
    sessionType: sessionSnapshot.type,
    sessionVersion: sessionSnapshot.version,
    sessionId: sessionSnapshot.sessionId,
    comparisonId: comparison.comparisonId,
    runIds: [runs[0].runId, runs[1].runId],
    projectSessionId: sessionSnapshot.projectSessionId,
    graphSemanticFingerprint: sourceInspection.graphFingerprint,
    registryIdentity: structuredClone(sourceInspection.hiddenNodeRegistryIdentity),
    dataset: {
      fingerprint: sourceDataset.fingerprint,
      features: [...sourceDataset.features],
      target: sourceDataset.target,
      task: sourceDataset.task,
    },
    split: {
      identity: sourceSplit.identity,
      seed: sourceSplit.seed,
      trainRatio: sourceSplit.trainRatio,
      trainRows: sourceSplit.trainRows,
      testRows: sourceSplit.testRows,
    },
    training: copyTraining(sourceTraining),
  };
  const outerRuns = runs.map((run, index) => ({
    runId: run.runId,
    role: index === 0 ? 'baseline' : 'variant',
    status: 'succeeded',
    configuration: expectedRunConfiguration({ run, training: sourceTraining, dataset: sourceDataset, split: sourceSplit }),
    provenance: structuredClone(run.metricProvenance),
    metrics: structuredClone(run.metrics),
  }));
  if (runs.some((run, index) => run.status !== 'succeeded'
    || run.task !== sourceDataset.task
    || run.configuration?.width !== run.width
    || run.configuration?.graphSemanticFingerprint !== run.graphFingerprint
    || stableJson(run.configuration) !== stableJson(expectedRunConfiguration({ run, training: sourceTraining, dataset: sourceDataset, split: sourceSplit }))
    || run.metricProvenance?.source !== 'executeBrowserGraph'
    || run.metricProvenance?.runId !== run.runId
    || run.metricProvenance?.evaluatorNodeId !== sourceInspection.evaluatorNodeId
    || run.metricProvenance?.modelNodeId !== sourceInspection.outputNodeId)) {
    return { ok: false, reasonCode: 'EXPLORE_TO_BUILD_RUN_RECORD_INVALID' };
  }
  const metricNames = [...expectedMetricNames];
  if (!metricNames.length) return { ok: false, reasonCode: 'EXPLORE_TO_BUILD_METRICS_INCOMPLETE' };
  const measurements = {
    metrics: metricNames.map((metric) => ({
      metric,
      baseline: outerRuns[0].metrics[metric],
      variant: outerRuns[1].metrics[metric],
      delta: outerRuns[1].metrics[metric] - outerRuns[0].metrics[metric],
    })),
  };
  if (stableJson(comparison.metrics) !== stableJson(Object.fromEntries(measurements.metrics.map((item) => [item.metric, {
    baseline: item.baseline, variant: item.variant, delta: item.delta,
  }])))) return { ok: false, reasonCode: 'EXPLORE_TO_BUILD_MEASUREMENT_MISMATCH' };

  const change = { parameter: 'Dense.units', nodeId: hiddenNodeId, from, to };
  const derivedChanges = [{
    parameter: 'Dense.input_features',
    nodeId: outputNodeId,
    from: baseGraph.nodes.find((node) => node.id === outputNodeId)?.data?.parameters?.input_features,
    to,
  }];
  if (derivedChanges[0].from !== from) return { ok: false, reasonCode: 'EXPLORE_TO_BUILD_DERIVED_SOURCE_INVALID' };

  const references = [source.sessionId, source.comparisonId, ...source.runIds];
  const patchResult = createGraphPatchProposal({
    baseGraph,
    operations,
    source: {
      producer: 'adapter',
      provenance: {
        artifactId: 'g3-explore-to-build-v1',
        revision: 'v1',
        fingerprint: source.graphSemanticFingerprint,
        references,
        location: 'inline',
      },
    },
    rationale: TRANSFER_RATIONALE,
  });
  if (!patchResult.ok) return { ok: false, reasonCode: 'EXPLORE_TO_BUILD_PATCH_INVALID', diagnostics: patchResult.diagnostics };

  const candidate = {
    type: EXPLORE_TO_BUILD_PROPOSAL_TYPE,
    version: EXPLORE_TO_BUILD_PROPOSAL_VERSION,
    source,
    conditions: {
      interpretation: 'paired-explore-measurement',
      sameSeedWeightNote: 'different-width-initialization-shape',
      claimBoundary: 'exact-pair-only',
    },
    runs: outerRuns,
    measurements,
    change,
    derivedChanges,
    graphPatchProposal: patchResult.proposal,
  };
  const jsonIssues = jsonValueIssues(candidate);
  if (jsonIssues.length) return { ok: false, reasonCode: 'EXPLORE_TO_BUILD_NOT_JSON_SAFE', diagnostics: jsonIssues };
  let proposalFingerprint;
  try {
    proposalFingerprint = artifactFingerprintJsonV1(candidate);
  } catch (error) {
    return { ok: false, reasonCode: 'EXPLORE_TO_BUILD_NOT_JSON_SAFE', diagnostics: [...jsonValueIssues(candidate), String(error?.message ?? 'fingerprint-failed')] };
  }
  const proposalId = `explore-to-build-${proposalFingerprint}`;
  const proposal = { ...candidate, proposalId };
  const checked = validateProposalShape(proposal);
  if (!checked.valid) return { ok: false, reasonCode: 'EXPLORE_TO_BUILD_PROPOSAL_INVALID', diagnostics: checked.errors };
  return { ok: true, proposal };
}

/** Recreate from the live session closure, then compare every supplied field. */
export function revalidateExploreToBuildProposalV1(value, liveSource) {
  const rebuilt = createExploreToBuildProposalV1(liveSource);
  if (!rebuilt.ok) return { valid: false, reasonCode: rebuilt.reasonCode, diagnostics: rebuilt.diagnostics ?? [] };
  const shape = validateProposalShape(value);
  if (!shape.valid || stableJson(value) !== stableJson(rebuilt.proposal)) {
    return { valid: false, reasonCode: 'EXPLORE_TO_BUILD_PROPOSAL_MISMATCH', diagnostics: shape.errors ?? [] };
  }
  return { valid: true, proposal: rebuilt.proposal };
}
