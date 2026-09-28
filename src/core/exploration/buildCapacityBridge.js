import { componentById } from '../components.js';
import { analyzeBrowserExecutionGraph, profileBrowserDataset } from '../browserExecutionContract.js';
import { BROWSER_MLP_SEED, executeBrowserGraph } from '../browserRuntime.js';
import { estimateExecutionPlan } from '../runtimeTiers.js';
import { artifactFingerprintJsonV1 } from '../graph/artifactFingerprint.js';
import { graphSemanticFingerprintV1 } from '../graph/identity.js';
import { deterministicShuffle, stratifiedSplit } from '../knnMath.js';

export const EXPLORE_BRIDGE_SESSION_TYPE = 'ExploreBridgeSessionV1';
export const EXPLORE_BRIDGE_SESSION_VERSION = 1;

const HIDDEN_ACTIVATIONS = new Set(['relu', 'sigmoid', 'tanh']);
const TARGET_ACTIVATIONS = Object.freeze({ regression: null, classification: 'softmax' });
const METRICS_BY_TASK = Object.freeze({
  regression: Object.freeze(['rmse', 'r2']),
  classification: Object.freeze(['accuracy', 'macroF1']),
});
const denseManifest = componentById.get('dense_node');
const hiddenWidthProperty = denseManifest?.properties?.find((property) => property.key === 'units');
const HIDDEN_WIDTH_MIN = hiddenWidthProperty?.min ?? 1;
const HIDDEN_WIDTH_MAX = hiddenWidthProperty?.max ?? 4096;
let fallbackIdCounter = 0;

function makeId(prefix) {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return `${prefix}-${random}`;
  fallbackIdCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${fallbackIdCounter.toString(36)}`;
}

function clone(value) {
  return structuredClone(value);
}

function nodeOp(node) {
  return node?.data?.manifest?.op ?? null;
}

function nodeIdByOp(nodes, op) {
  return nodes.filter((node) => nodeOp(node) === op);
}

function oneNode(nodes, op) {
  const matches = nodeIdByOp(nodes, op);
  return matches.length === 1 ? matches[0] : null;
}

function matchingEdges(edges, predicate) {
  return edges.filter(predicate);
}

function incomingEdge(edges, nodeId, targetHandle) {
  const matches = matchingEdges(edges, (edge) => edge.target === nodeId && edge.targetHandle === targetHandle);
  return matches.length === 1 ? matches[0] : null;
}

function datasetSemanticProjection(dataset) {
  return {
    task: dataset.task,
    columns: dataset.columns,
    featureColumns: dataset.featureColumns,
    targetColumn: dataset.targetColumn,
    rows: dataset.rows,
  };
}

function manifestSemanticProjection(manifest) {
  return {
    schemaVersion: manifest?.schemaVersion,
    id: manifest?.id,
    op: manifest?.op,
    kind: manifest?.kind,
    customComposite: manifest?.customComposite === true,
    inputs: Array.isArray(manifest?.inputs) ? manifest.inputs.map(({ name, type }) => ({ name, type })) : null,
    outputs: Array.isArray(manifest?.outputs) ? manifest.outputs.map(({ name, type }) => ({ name, type })) : null,
    properties: Array.isArray(manifest?.properties) ? manifest.properties.map(({ label: _label, ...property }) => property) : null,
    runtime: manifest?.runtime ?? null,
    compatibility: manifest?.compatibility ?? null,
    composition: manifest?.composition ?? null,
  };
}

function nonCapacityTrainingProjection(nodes, edges, hiddenNodeId, outputNodeId) {
  const semanticNodes = nodes.map((node) => {
    const parameters = { ...node.data.parameters };
    if (node.id === hiddenNodeId) delete parameters.units;
    if (node.id === outputNodeId) delete parameters.input_features;
    return {
      id: node.id,
      componentId: node.data.manifest.id,
      op: node.data.manifest.op,
      parameters,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  const semanticEdges = edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
  })).sort((left, right) => left.id.localeCompare(right.id));
  return artifactFingerprintJsonV1({ nodes: semanticNodes, edges: semanticEdges });
}

function splitIdentityFor(dataset, splitNode) {
  const seed = BROWSER_MLP_SEED;
  const profile = profileBrowserDataset(dataset);
  const trainRatio = Number(splitNode.data.parameters.train_ratio);
  let train;
  let test;
  if (dataset.task === 'classification') {
    ({ train, test } = stratifiedSplit(profile.samples, trainRatio, seed));
  } else {
    const shuffled = deterministicShuffle(profile.samples, seed);
    const splitIndex = Math.max(1, Math.min(shuffled.length - 1, Math.floor(shuffled.length * trainRatio)));
    train = shuffled.slice(0, splitIndex);
    test = shuffled.slice(splitIndex);
  }
  const trainRowIds = train.map((sample) => sample.index);
  const testRowIds = test.map((sample) => sample.index);
  return {
    seed,
    trainRatio,
    trainRows: train.length,
    testRows: test.length,
    identity: artifactFingerprintJsonV1({
      datasetFingerprint: artifactFingerprintJsonV1(datasetSemanticProjection(dataset)),
      task: dataset.task,
      seed,
      trainRatio,
      trainRowIds,
      testRowIds,
    }),
  };
}

function exactRegisteredComponents(nodes) {
  return nodes.every((node) => {
    const componentId = node?.data?.manifest?.id;
    const registered = componentById.get(componentId);
    if (!registered || node.data.manifest.customComposite === true) return false;
    try {
      return artifactFingerprintJsonV1(manifestSemanticProjection(node.data.manifest))
        === artifactFingerprintJsonV1(manifestSemanticProjection(registered));
    } catch {
      return false;
    }
  });
}

function modelChain({ nodes, edges, outputNode }) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const reverse = [outputNode];
  let current = outputNode;
  const seen = new Set([current.id]);
  while (nodeOp(current) !== 'tensor_input') {
    const edge = incomingEdge(edges, current.id, 'input');
    const previous = edge && nodeById.get(edge.source);
    if (!previous || seen.has(previous.id)) return null;
    seen.add(previous.id);
    reverse.push(previous);
    current = previous;
  }
  return reverse.reverse();
}

function expectedGraphNodes(task, modelNodes, nodes) {
  const evaluationOp = task === 'classification' ? 'evaluate_classification' : 'evaluate_regression';
  const predictors = nodeIdByOp(nodes, 'interactive_predictor');
  const outsideModel = [
    oneNode(nodes, 'tabular_data'),
    oneNode(nodes, 'train_test_split'),
    oneNode(nodes, 'supervised_trainer'),
    oneNode(nodes, task === 'classification' ? 'cross_entropy_loss' : 'mse_loss'),
    oneNode(nodes, nodes.find((node) => ['sgd_optimizer', 'adam_optimizer'].includes(nodeOp(node)))?.data?.manifest?.op),
    oneNode(nodes, evaluationOp),
  ];
  return outsideModel.every(Boolean) && predictors.length <= 1
    && modelNodes.length + outsideModel.length + predictors.length === nodes.length;
}

function unsupported(reasonCode, details = {}) {
  return { supported: false, reasonCode, ...details };
}

/** Strict eligibility for the existing browser L0 executor's one-hidden-layer tabular MLP. */
function inspectExploreCapacityBuildInternal(build = {}) {
  const nodes = Array.isArray(build.nodes) ? build.nodes : [];
  const edges = Array.isArray(build.edges) ? build.edges : [];
  const dataset = build.dataset ?? null;
  const customComponents = Array.isArray(build.customComponents) ? build.customComponents : [];

  if (!dataset) return unsupported('DATASET_MISSING');
  if (customComponents.length || !exactRegisteredComponents(nodes)) return unsupported('CUSTOM_COMPONENTS_UNSUPPORTED');
  if (!nodes.length || nodes.some((node) => !node?.id || !node?.data?.manifest || !node?.data?.parameters)) {
    return unsupported('GRAPH_INVALID');
  }

  let graphFingerprint;
  let datasetFingerprint;
  try {
    graphFingerprint = graphSemanticFingerprintV1({ nodes, edges, componentDefinitions: [] });
    datasetFingerprint = artifactFingerprintJsonV1(datasetSemanticProjection(dataset));
  } catch {
    return unsupported('GRAPH_INVALID');
  }

  const rootNodes = nodes.filter((node) => ['supervised_trainer', 'knn_classifier', 'gradient_descent'].includes(nodeOp(node)));
  if (rootNodes.length > 1) return unsupported('MULTIPLE_TRAINING_ROOTS');
  if (rootNodes.length !== 1 || nodeOp(rootNodes[0]) !== 'supervised_trainer') return unsupported('UNSUPPORTED_TRAINER');

  const contract = analyzeBrowserExecutionGraph({ nodes, edges, dataset });
  if (!contract.valid) return unsupported('L0_GRAPH_UNSUPPORTED', { diagnosticCode: contract.reason });
  const plan = estimateExecutionPlan(nodes, dataset, { edges });
  if (!plan.canRunHere) return unsupported('BASELINE_EXCEEDS_L0_BUDGET', { recommendedTier: plan.recommendedTier });

  const trainer = rootNodes[0];
  const outputNode = oneNode(nodes, 'model_output');
  if (!outputNode || matchingEdges(edges, (edge) => edge.target === trainer.id && edge.targetHandle === 'model' && edge.source === outputNode.id).length !== 1) {
    return unsupported('UNSUPPORTED_MODEL_PATH');
  }
  const chain = modelChain({ nodes, edges, outputNode });
  if (!chain) return unsupported('UNSUPPORTED_MODEL_PATH');
  const expectedTaskActivation = TARGET_ACTIVATIONS[dataset.task];
  const denseNodes = chain.filter((node) => nodeOp(node) === 'dense');
  const hiddenActivations = chain.filter((node) => HIDDEN_ACTIVATIONS.has(nodeOp(node)));
  const softmaxNodes = chain.filter((node) => nodeOp(node) === 'softmax');
  const pathOps = chain.map(nodeOp);
  const expectedPathOps = [
    'tensor_input', 'dense', nodeOp(hiddenActivations[0]), 'dense',
    ...(expectedTaskActivation ? [expectedTaskActivation] : []), 'model_output',
  ];
  if (dataset.task !== 'classification' && dataset.task !== 'regression') return unsupported('UNSUPPORTED_TASK');
  if (hiddenActivations.length !== 1 || denseNodes.length !== 2 || softmaxNodes.length !== (expectedTaskActivation ? 1 : 0)
    || hiddenActivations[0] === denseNodes[1] || pathOps.some((op) => !op) || JSON.stringify(pathOps) !== JSON.stringify(expectedPathOps)) {
    return unsupported('UNSUPPORTED_MODEL_PATH');
  }
  if (!expectedGraphNodes(dataset.task, chain, nodes)) return unsupported('UNSUPPORTED_GRAPH_BRANCH');

  const hiddenNode = denseNodes[0];
  const outputDense = denseNodes[1];
  const splitNode = oneNode(nodes, 'train_test_split');
  const evaluator = oneNode(nodes, dataset.task === 'classification' ? 'evaluate_classification' : 'evaluate_regression');
  const activeIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
  if (activeIds.size !== nodes.length || !splitNode || !evaluator) return unsupported('UNSUPPORTED_GRAPH_BRANCH');

  const modelEdges = chain.slice(1).map((node, index) => ({
    source: chain[index].id,
    sourceHandle: chain[index].data.manifest.outputs[0]?.name,
    target: node.id,
    targetHandle: node.data.manifest.inputs[0]?.name,
  }));
  const expectedEdges = [
    ...modelEdges,
    { source: oneNode(nodes, 'tabular_data').id, sourceHandle: 'dataset', target: splitNode.id, targetHandle: 'dataset' },
    { source: splitNode.id, sourceHandle: 'split', target: trainer.id, targetHandle: 'dataset' },
    { source: outputNode.id, sourceHandle: 'model', target: trainer.id, targetHandle: 'model' },
    { source: oneNode(nodes, dataset.task === 'classification' ? 'cross_entropy_loss' : 'mse_loss').id, sourceHandle: 'loss', target: trainer.id, targetHandle: 'loss' },
    { source: nodes.find((node) => ['sgd_optimizer', 'adam_optimizer'].includes(nodeOp(node))).id, sourceHandle: 'optimizer', target: trainer.id, targetHandle: 'optimizer' },
    { source: trainer.id, sourceHandle: 'trained_model', target: evaluator.id, targetHandle: 'trained_model' },
  ];
  const predictor = nodeIdByOp(nodes, 'interactive_predictor')[0];
  if (predictor) expectedEdges.push({ source: trainer.id, sourceHandle: 'trained_model', target: predictor.id, targetHandle: 'trained_model' });
  const edgeKey = (edge) => `${edge.source}\0${edge.sourceHandle}\0${edge.target}\0${edge.targetHandle}`;
  if (edges.length !== expectedEdges.length || expectedEdges.some((expected) => !edges.some((edge) => edgeKey(edge) === edgeKey(expected)))) {
    return unsupported('UNSUPPORTED_GRAPH_BRANCH');
  }

  const split = splitIdentityFor(dataset, splitNode);
  const trainingConfigFingerprint = nonCapacityTrainingProjection(nodes, edges, hiddenNode.id, outputDense.id);
  const trainerSettings = { ...trainer.data.parameters };
  const lossNode = oneNode(nodes, dataset.task === 'classification' ? 'cross_entropy_loss' : 'mse_loss');
  const optimizerNode = nodes.find((node) => ['sgd_optimizer', 'adam_optimizer'].includes(nodeOp(node)));
  return {
    supported: true,
    reasonCode: null,
    graphFingerprint,
    datasetFingerprint,
    task: dataset.task,
    featureColumns: [...dataset.featureColumns],
    targetColumn: dataset.targetColumn,
    hiddenNodeId: hiddenNode.id,
    hiddenNodeRegistryIdentity: { componentId: 'dense_node', op: 'dense' },
    outputNodeId: outputDense.id,
    outputNodeRegistryIdentity: { componentId: 'dense_node', op: 'dense' },
    baselineWidth: Number(hiddenNode.data.parameters.units),
    split,
    seed: BROWSER_MLP_SEED,
    trainingConfigFingerprint,
    trainerSettings,
    lossOp: nodeOp(lossNode),
    optimizer: { op: nodeOp(optimizerNode), parameters: { ...optimizerNode.data.parameters } },
    evaluatorNodeId: evaluator.id,
    recommendedTier: plan.recommendedTier,
    source: { nodes, edges, dataset },
  };
}

/** Return only bounded semantic metadata; input rows stay outside the session projection. */
export function inspectExploreCapacityBuild(build = {}) {
  const { source: _privateSource, ...publicAssessment } = inspectExploreCapacityBuildInternal(build);
  return publicAssessment;
}

function makeCapacityVariant(source, hiddenNodeId, outputNodeId, width) {
  const nodes = source.nodes.map((node) => {
    if (node.id === hiddenNodeId) {
      return { ...node, data: { ...node.data, parameters: { ...node.data.parameters, units: width } } };
    }
    if (node.id === outputNodeId) {
      return { ...node, data: { ...node.data, parameters: { ...node.data.parameters, input_features: width } } };
    }
    return node;
  });
  return { nodes, edges: clone(source.edges), dataset: clone(source.dataset), customComponents: [] };
}

function validateVariant(source, width) {
  if (!Number.isSafeInteger(width) || width < HIDDEN_WIDTH_MIN || width > HIDDEN_WIDTH_MAX) {
    return { valid: false, reasonCode: 'VARIANT_WIDTH_OUT_OF_RANGE', min: HIDDEN_WIDTH_MIN, max: HIDDEN_WIDTH_MAX };
  }
  if (width === source.baselineWidth) return { valid: false, reasonCode: 'VARIANT_WIDTH_MUST_DIFFER', min: HIDDEN_WIDTH_MIN, max: HIDDEN_WIDTH_MAX };
  const variant = makeCapacityVariant(source.source, source.hiddenNodeId, source.outputNodeId, width);
  const assessment = inspectExploreCapacityBuildInternal(variant);
  if (!assessment.supported) {
    return {
      valid: false,
      reasonCode: assessment.reasonCode === 'BASELINE_EXCEEDS_L0_BUDGET' ? 'VARIANT_EXCEEDS_L0_BUDGET' : 'VARIANT_NOT_RUNNABLE',
      min: HIDDEN_WIDTH_MIN,
      max: HIDDEN_WIDTH_MAX,
      recommendedTier: assessment.recommendedTier ?? null,
    };
  }
  if (assessment.datasetFingerprint !== source.datasetFingerprint
    || assessment.split.identity !== source.split.identity
    || assessment.trainingConfigFingerprint !== source.trainingConfigFingerprint) {
    return { valid: false, reasonCode: 'VARIANT_IDENTITY_MISMATCH', min: HIDDEN_WIDTH_MIN, max: HIDDEN_WIDTH_MAX };
  }
  return { valid: true, reasonCode: null, graph: variant, assessment, min: HIDDEN_WIDTH_MIN, max: HIDDEN_WIDTH_MAX };
}

function detachedSnapshot(state) {
  return clone(state);
}

function metricProjection(model, task) {
  const allowed = METRICS_BY_TASK[task] ?? [];
  return Object.fromEntries(allowed
    .filter((key) => Number.isFinite(model?.metrics?.[key]))
    .map((key) => [key, model.metrics[key]]));
}

function yieldToBrowser(signal) {
  if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  if (typeof requestAnimationFrame !== 'function') {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => signal.aborted ? reject(new DOMException('Cancelled', 'AbortError')) : resolve(), 0);
      signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) reject(new DOMException('Cancelled', 'AbortError'));
      else resolve();
    };
    const frame = requestAnimationFrame(finish);
    const cancel = () => {
      cancelAnimationFrame(frame);
      signal.removeEventListener('abort', cancel);
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    signal.addEventListener('abort', cancel, { once: true });
  });
}

/**
 * Create one detached Build→Explore capacity session. Its private source copy
 * is only an input snapshot for the existing L0 executor; it is never written
 * back to Build or project JSON.
 */
export function createExploreBridgeSessionV1({
  build,
  projectSessionId = makeId('project-session'),
  createId = makeId,
  runBrowserGraph = executeBrowserGraph,
} = {}) {
  const inspection = inspectExploreCapacityBuildInternal(build);
  const source = inspection.supported ? {
    nodes: clone(inspection.source.nodes),
    edges: clone(inspection.source.edges),
    dataset: clone(inspection.source.dataset),
    customComponents: [],
  } : null;
  const requestedVariantWidth = inspection.supported ? inspection.baselineWidth * 2 : null;
  const defaultVariant = inspection.supported ? validateVariant(inspection, requestedVariantWidth) : null;
  const defaultVariantWidth = defaultVariant?.valid ? requestedVariantWidth : null;
  const sessionId = createId('explore-bridge-session');
  let state = {
    type: EXPLORE_BRIDGE_SESSION_TYPE,
    version: EXPLORE_BRIDGE_SESSION_VERSION,
    sessionId,
    projectSessionId,
    lifecycle: inspection.supported ? (defaultVariant?.valid ? 'ready' : 'draft') : 'failed',
    reasonCode: inspection.supported ? (defaultVariant?.valid ? null : defaultVariant?.reasonCode ?? 'VARIANT_WIDTH_REQUIRED') : inspection.reasonCode,
    diagnosticCode: inspection.diagnosticCode ?? null,
    provenance: inspection.supported ? {
      kind: 'build-project-snapshot',
      projectSessionId,
      graphFingerprint: inspection.graphFingerprint,
      datasetFingerprint: inspection.datasetFingerprint,
    } : { kind: 'build-project-snapshot', projectSessionId },
    graphIdentity: inspection.supported ? { semanticFingerprint: inspection.graphFingerprint } : null,
    selectedHiddenNode: inspection.supported ? {
      nodeId: inspection.hiddenNodeId,
      registryIdentity: inspection.hiddenNodeRegistryIdentity,
    } : null,
    dataset: inspection.supported ? {
      fingerprint: inspection.datasetFingerprint,
      features: inspection.featureColumns,
      target: inspection.targetColumn,
      task: inspection.task,
    } : null,
    split: inspection.supported ? {
      identity: inspection.split.identity,
      seed: inspection.split.seed,
      trainRatio: inspection.split.trainRatio,
      trainRows: inspection.split.trainRows,
      testRows: inspection.split.testRows,
    } : null,
    training: inspection.supported ? {
      identity: inspection.trainingConfigFingerprint,
      seed: inspection.seed,
      epochs: inspection.trainerSettings.epochs,
      batchSize: inspection.trainerSettings.batch_size,
      shuffle: inspection.trainerSettings.shuffle,
      loss: inspection.lossOp,
      optimizer: inspection.optimizer,
    } : null,
    capacity: inspection.supported ? {
      baselineWidth: inspection.baselineWidth,
      variantWidth: defaultVariantWidth,
      requestedVariantWidth,
      derivedOutputNodeId: inspection.outputNodeId,
      minWidth: HIDDEN_WIDTH_MIN,
      maxWidth: HIDDEN_WIDTH_MAX,
    } : null,
    evaluatorNodeId: inspection.evaluatorNodeId ?? null,
    activeRun: null,
    runs: [],
    comparison: null,
  };
  const listeners = new Set();
  let activePromise = null;
  let activeAbortController = null;
  let attemptGeneration = 0;
  let disposed = false;

  const publish = () => {
    const snapshot = detachedSnapshot(state);
    listeners.forEach((listener) => listener(snapshot));
  };
  const setState = (patch) => {
    if (disposed) return;
    state = { ...state, ...patch };
    publish();
  };
  const abortCurrent = () => {
    attemptGeneration += 1;
    activeAbortController?.abort();
    activeAbortController = null;
    activePromise = null;
  };

  const validateRequestedVariant = (width) => inspection.supported ? validateVariant(inspection, width) : ({ valid: false, reasonCode: inspection.reasonCode });

  return Object.freeze({
    getSnapshot: () => detachedSnapshot(state),
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Listener must be a function.');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setVariantWidth(width) {
      if (!inspection.supported || ['running', 'completed', 'stale', 'closed'].includes(state.lifecycle)) return state.reasonCode;
      const numericWidth = width === null || width === '' ? NaN : typeof width === 'number' ? width : Number(width);
      const validation = validateRequestedVariant(numericWidth);
      setState({
        lifecycle: validation.valid ? 'ready' : 'draft',
        reasonCode: validation.reasonCode,
        capacity: { ...state.capacity, variantWidth: validation.valid ? numericWidth : null, requestedVariantWidth: Number.isFinite(numericWidth) ? numericWidth : null },
      });
      return validation.reasonCode;
    },
    reconcileSource(currentBuild, currentProjectSessionId = projectSessionId) {
      if (disposed || state.lifecycle === 'stale') return false;
      if (currentProjectSessionId !== projectSessionId) {
        abortCurrent();
        setState({ lifecycle: 'stale', reasonCode: 'PROJECT_SESSION_CHANGED', activeRun: null });
        return true;
      }
      const current = inspectExploreCapacityBuildInternal(currentBuild);
      if (!inspection.supported || !current.supported
        || current.graphFingerprint !== inspection.graphFingerprint
        || current.datasetFingerprint !== inspection.datasetFingerprint
        || current.trainingConfigFingerprint !== inspection.trainingConfigFingerprint
        || current.split.identity !== inspection.split.identity) {
        abortCurrent();
        setState({ lifecycle: 'stale', reasonCode: 'SOURCE_CHANGED', activeRun: null });
        return true;
      }
      return false;
    },
    async runComparison() {
      if (activePromise) return activePromise;
      if (!inspection.supported || !source) throw new Error(state.reasonCode ?? 'SOURCE_UNSUPPORTED');
      if (!['ready', 'failed'].includes(state.lifecycle) || !Number.isSafeInteger(state.capacity?.variantWidth)) {
        throw new Error(state.reasonCode ?? 'SESSION_NOT_READY');
      }
      const variantValidation = validateRequestedVariant(state.capacity.variantWidth);
      if (!variantValidation.valid) {
        setState({ lifecycle: 'draft', reasonCode: variantValidation.reasonCode });
        throw new Error(variantValidation.reasonCode);
      }
      const attempt = ++attemptGeneration;
      const comparisonId = createId('capacity-comparison');
      const baselineRunId = createId('capacity-run');
      const variantRunId = createId('capacity-run');
      const abortController = new AbortController();
      activeAbortController = abortController;
      setState({
        lifecycle: 'running',
        reasonCode: null,
        activeRun: { comparisonId, baselineRunId, variantRunId, stage: 'baseline' },
        runs: [],
        comparison: null,
      });
      const stillCurrent = () => !disposed && attempt === attemptGeneration && !abortController.signal.aborted;
      const execute = async ({ runId, role, width, nodes, graphFingerprint }) => {
        const model = await runBrowserGraph({
          nodes: clone(nodes),
          edges: clone(source.edges),
          dataset: clone(source.dataset),
          signal: abortController.signal,
          onNodeStatus: () => {},
          onLoss: () => {},
          onYield: () => yieldToBrowser(abortController.signal),
        });
        if (!stillCurrent()) throw new DOMException('Cancelled', 'AbortError');
        const metrics = metricProjection(model, inspection.task);
        const expectedMetricKeys = METRICS_BY_TASK[inspection.task] ?? [];
        if (model?.type !== 'browser_mlp' || !expectedMetricKeys.some((key) => Number.isFinite(metrics[key]))) {
          throw new Error('RUNTIME_METRICS_UNAVAILABLE');
        }
        return {
          runId,
          role,
          width,
          graphFingerprint,
          task: inspection.task,
          metrics,
          metricProvenance: {
            source: 'executeBrowserGraph',
            evaluatorNodeId: inspection.evaluatorNodeId,
            modelNodeId: inspection.outputNodeId,
            runId,
          },
        };
      };
      const promise = (async () => {
        try {
          const baselineGraphFingerprint = inspection.graphFingerprint;
          const baseline = await execute({
            runId: baselineRunId,
            role: 'baseline',
            width: inspection.baselineWidth,
            nodes: source.nodes,
            graphFingerprint: baselineGraphFingerprint,
          });
          if (!stillCurrent()) return null;
          setState({ activeRun: { comparisonId, baselineRunId, variantRunId, stage: 'variant' } });
          const variantGraphFingerprint = graphSemanticFingerprintV1({
            nodes: variantValidation.graph.nodes,
            edges: variantValidation.graph.edges,
            componentDefinitions: [],
          });
          const variant = await execute({
            runId: variantRunId,
            role: 'variant',
            width: state.capacity.variantWidth,
            nodes: variantValidation.graph.nodes,
            graphFingerprint: variantGraphFingerprint,
          });
          if (!stillCurrent()) return null;
          if (baseline.task !== variant.task
            || baseline.width !== inspection.baselineWidth
            || variant.width !== state.capacity.variantWidth
            || baseline.role !== 'baseline'
            || variant.role !== 'variant'
            || inspection.datasetFingerprint !== state.dataset.fingerprint
            || inspection.split.identity !== state.split.identity
            || inspection.trainingConfigFingerprint !== state.training.identity) {
            throw new Error('COMPARISON_IDENTITY_MISMATCH');
          }
          const sharedMetricKeys = Object.keys(baseline.metrics).filter((key) => Number.isFinite(variant.metrics[key]));
          const metrics = Object.fromEntries(sharedMetricKeys.map((key) => [key, {
            baseline: baseline.metrics[key],
            variant: variant.metrics[key],
            delta: variant.metrics[key] - baseline.metrics[key],
          }]));
          const comparison = {
            comparisonId,
            runIds: [baseline.runId, variant.runId],
            datasetFingerprint: inspection.datasetFingerprint,
            splitIdentity: inspection.split.identity,
            trainingIdentity: inspection.trainingConfigFingerprint,
            seed: inspection.seed,
            task: inspection.task,
            widths: { baseline: baseline.width, variant: variant.width },
            metrics,
            metricProvenance: [baseline.metricProvenance, variant.metricProvenance],
            interpretation: 'descriptive-capacity-comparison',
          };
          setState({ lifecycle: 'completed', reasonCode: null, activeRun: null, runs: [baseline, variant], comparison });
          return detachedSnapshot(state);
        } catch (error) {
          if (!stillCurrent()) return null;
          const cancelled = error?.name === 'AbortError';
          setState({
            lifecycle: cancelled ? 'ready' : 'failed',
            reasonCode: cancelled ? 'RUN_CANCELLED' : 'RUN_FAILED',
            activeRun: null,
            runs: [],
            comparison: null,
          });
          if (!cancelled) throw error;
          return null;
        } finally {
          if (attempt === attemptGeneration) {
            activeAbortController = null;
            activePromise = null;
          }
        }
      })();
      activePromise = promise;
      return promise;
    },
    cancel() {
      if (state.lifecycle !== 'running') return false;
      abortCurrent();
      setState({ lifecycle: 'ready', reasonCode: 'RUN_CANCELLED', activeRun: null, runs: [], comparison: null });
      return true;
    },
    close() {
      if (disposed || ['closed', 'stale'].includes(state.lifecycle)) return;
      abortCurrent();
      setState({ lifecycle: 'closed', activeRun: null });
    },
    dispose() {
      if (disposed) return;
      abortCurrent();
      disposed = true;
      listeners.clear();
    },
  });
}

export const EXPLORE_CAPACITY_BRIDGE_WIDTH_BOUNDS = Object.freeze({ min: HIDDEN_WIDTH_MIN, max: HIDDEN_WIDTH_MAX });
