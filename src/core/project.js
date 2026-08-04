import { localizedError } from '../i18n.js';
import { componentById } from './components.js';
import { assessConnection } from './connections.js';
import { flattenCustomComposites } from './customComposites.js';

export const PROJECT_VERSION = 8;

const oldSamplePositions = {
  'pipeline-data': { x: 40, y: 180 },
  'pipeline-split': { x: 340, y: 180 },
  'pipeline-linear': { x: 650, y: 180 },
  'pipeline-optimizer': { x: 960, y: 180 },
  'pipeline-evaluate': { x: 1270, y: 70 },
  'pipeline-predictor': { x: 1270, y: 300 },
};

const spaciousSamplePositions = {
  'pipeline-data': { x: 40, y: 220 },
  'pipeline-split': { x: 480, y: 220 },
  'pipeline-linear': { x: 920, y: 220 },
  'pipeline-optimizer': { x: 1360, y: 220 },
  'pipeline-evaluate': { x: 1800, y: 40 },
  'pipeline-predictor': { x: 1800, y: 400 },
};

export function projectContentSignature(project) {
  return JSON.stringify({
    name: project.name,
    graph: project.graph,
    customComponents: project.customComponents,
    data: project.data,
    trainedModel: project.trainedModel,
  });
}

function migrateKnnOutputHandles(project) {
  const knnNodeIds = new Set(
    project.graph.nodes
      .filter((node) => (
        node.data?.manifest?.id === 'knn_node'
        || node.data?.manifest?.op === 'knn_classifier'
      ))
      .map((node) => node.id),
  );
  const edges = project.graph.edges.flatMap((edge) => {
    if (!knnNodeIds.has(edge.source)) return [edge];
    if (edge.sourceHandle === 'model') {
      return [{ ...edge, sourceHandle: 'trained_model' }];
    }
    if (edge.sourceHandle === 'boundary') return [];
    return [edge];
  });
  return { ...project, graph: { ...project.graph, edges } };
}

function migrateDefaultSampleLayout(project) {
  const nodeById = new Map(project.graph.nodes.map((node) => [node.id, node]));
  const isUntouchedDefault = Object.entries(oldSamplePositions).every(([id, position]) => {
    const node = nodeById.get(id);
    return node?.position?.x === position.x && node.position?.y === position.y;
  });
  if (!isUntouchedDefault) return project;
  return {
    ...project,
    graph: {
      ...project.graph,
      nodes: project.graph.nodes.map((node) => (
        spaciousSamplePositions[node.id]
          ? { ...node, position: spaciousSamplePositions[node.id] }
          : node
      )),
    },
  };
}

export function migrateProject(project) {
  if (
    project?.format !== 'VOLK-ML'
    || !Array.isArray(project.graph?.nodes)
    || !Array.isArray(project.graph?.edges)
  ) {
    throw localizedError('error.invalidProject');
  }

  let migrated = project;
  const version = Number.isFinite(project.version) ? project.version : 1;
  if (version < 5) migrated = migrateKnnOutputHandles(migrated);
  if (version < 6) {
    migrated = {
      ...migrated,
      name: migrated.name || 'Sample Project',
      customComponents: migrated.customComponents ?? [],
    };
  }
  if (version < 7) migrated = migrateDefaultSampleLayout(migrated);
  return {
    ...migrated,
    name: migrated.name || 'Sample Project',
    customComponents: migrated.customComponents ?? [],
    version: PROJECT_VERSION,
  };
}

function invalidProject() {
  throw localizedError('error.invalidProject');
}

const localizedTextIsValid = (value) => (
  typeof value === 'string'
  || (value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).length > 0
    && Object.values(value).every((translation) => typeof translation === 'string'))
);

const portsAreValid = (ports) => {
  const names = new Set();
  return ports.every((port) => {
    if (
      !port || typeof port !== 'object' || Array.isArray(port)
      || typeof port.name !== 'string' || !port.name.trim() || names.has(port.name)
      || typeof port.type !== 'string' || !port.type.trim()
    ) return false;
    names.add(port.name);
    return true;
  });
};

const propertyIsValid = (property) => {
  if (
    !property || typeof property !== 'object' || Array.isArray(property)
    || typeof property.key !== 'string' || !property.key.trim()
    || !localizedTextIsValid(property.label)
    || !['number', 'slider', 'select', 'boolean', 'text', 'code'].includes(property.type)
  ) return false;
  if (['number', 'slider'].includes(property.type)) {
    return Number.isFinite(property.default)
      && (property.min === undefined || Number.isFinite(property.min))
      && (property.max === undefined || Number.isFinite(property.max))
      && (property.step === undefined || (Number.isFinite(property.step) && property.step > 0));
  }
  if (property.type === 'select') {
    return typeof property.default === 'string'
      && Array.isArray(property.options)
      && property.options.length > 0
      && property.options.every((option) => typeof option === 'string')
      && property.options.includes(property.default);
  }
  if (property.type === 'boolean') return typeof property.default === 'boolean';
  return typeof property.default === 'string';
};

const propertyValueIsValid = (property, value) => {
  if (['number', 'slider'].includes(property.type)) {
    if (!Number.isFinite(value)) return false;
    if (Number.isFinite(property.min) && value < property.min) return false;
    if (Number.isFinite(property.max) && value > property.max) return false;
    if (Number.isFinite(property.step) && property.step > 0) {
      const base = Number.isFinite(property.min) ? property.min : 0;
      const steps = (value - base) / property.step;
      if (Math.abs(steps - Math.round(steps)) > 1e-9) return false;
    }
    return true;
  }
  if (property.type === 'select') return property.options.includes(value);
  if (property.type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'string';
};

const parametersAreValid = (manifest, parameters, referenceKeys = null) => {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return false;
  const propertyByKey = new Map(manifest.properties.map((property) => [property.key, property]));
  return Object.entries(parameters).every(([key, value]) => {
    const property = propertyByKey.get(key);
    if (!property) return false;
    if (referenceKeys && typeof value === 'string' && value.startsWith('$')) {
      return referenceKeys.has(value.slice(1));
    }
    return propertyValueIsValid(property, value);
  });
};

const sameKeys = (object, expected) => {
  if (!object || typeof object !== 'object' || Array.isArray(object)) return false;
  const keys = Object.keys(object);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
};

const exactHandlesExist = (edge, nodes) => {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  return Boolean(
    source?.data.manifest.outputs.some((port) => port.name === edge.sourceHandle)
    && target?.data.manifest.inputs.some((port) => port.name === edge.targetHandle),
  );
};

function customManifestIsValid(manifest, availableManifests, ancestors = new Set()) {
  const propertyKeys = new Set();
  if (
    !manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || manifest.customComposite !== true || manifest.kind !== 'composite'
    || typeof manifest.id !== 'string' || !manifest.id
    || typeof manifest.op !== 'string' || !manifest.op
    || typeof manifest.category !== 'string' || !manifest.category
    || (manifest.visualStage !== undefined && !['data', 'model', 'training', 'output'].includes(manifest.visualStage))
    || !localizedTextIsValid(manifest.name) || !localizedTextIsValid(manifest.description)
    || !Array.isArray(manifest.inputs) || !Array.isArray(manifest.outputs) || !Array.isArray(manifest.properties)
    || !portsAreValid(manifest.inputs) || !portsAreValid(manifest.outputs)
    || !manifest.properties.every((property) => {
      if (!propertyIsValid(property) || propertyKeys.has(property.key)) return false;
      propertyKeys.add(property.key);
      return true;
    })
    || !manifest.runtime || !['L0', 'L1', 'L2', 'L3'].includes(manifest.runtime.minimumTier)
    || !['cpu', 'none'].includes(manifest.runtime.browserBackend)
    || !manifest.compatibility
    || !['exact', 'adapted', 'approximate', 'unsupported'].includes(manifest.compatibility.pytorch)
    || !['exact', 'adapted', 'approximate', 'unsupported'].includes(manifest.compatibility.tensorflow)
  ) return false;
  if (ancestors.has(manifest.id)) return false;
  const composition = manifest.composition;
  if (
    !composition || typeof composition !== 'object'
    || !Array.isArray(composition.nodes) || composition.nodes.length === 0
    || !Array.isArray(composition.edges)
  ) return false;
  const nextAncestors = new Set(ancestors).add(manifest.id);
  const childKeys = new Set();
  const childNodes = [];
  for (const spec of composition.nodes) {
    if (
      !spec || typeof spec !== 'object' || Array.isArray(spec)
      || typeof spec.key !== 'string' || !spec.key || childKeys.has(spec.key)
      || typeof spec.componentId !== 'string' || !spec.componentId
      || (spec.position !== undefined && (!Number.isFinite(spec.position?.x) || !Number.isFinite(spec.position?.y)))
    ) return false;
    if (spec.manifest !== undefined && spec.manifest?.customComposite !== true) return false;
    const childManifest = spec.manifest ?? componentById.get(spec.componentId) ?? availableManifests.get(spec.componentId);
    if (!childManifest || childManifest.id !== spec.componentId) return false;
    if (childManifest.customComposite && spec.manifest === undefined) return false;
    if (childManifest.customComposite && !customManifestIsValid(childManifest, availableManifests, nextAncestors)) return false;
    if (!parametersAreValid(childManifest, spec.parameters ?? {}, propertyKeys)) return false;
    childKeys.add(spec.key);
    childNodes.push({ id: spec.key, data: { manifest: childManifest } });
  }
  const validatedEdges = [];
  for (const edge of composition.edges) {
    if (
      !edge || typeof edge !== 'object'
      || typeof edge.source !== 'string' || typeof edge.target !== 'string'
      || typeof edge.sourceHandle !== 'string' || typeof edge.targetHandle !== 'string'
      || !exactHandlesExist(edge, childNodes)
      || !assessConnection(edge, childNodes, validatedEdges).valid
    ) return false;
    validatedEdges.push(edge);
  }
  const inputNames = new Set(manifest.inputs.map((port) => port.name));
  const outputNames = new Set(manifest.outputs.map((port) => port.name));
  if (!sameKeys(composition.inputs, inputNames) || !sameKeys(composition.outputs, outputNames)) return false;
  const childByKey = new Map(childNodes.map((node) => [node.id, node.data.manifest]));
  const parentInputByName = new Map(manifest.inputs.map((port) => [port.name, port]));
  const parentOutputByName = new Map(manifest.outputs.map((port) => [port.name, port]));
  const occupiedInputs = new Set(validatedEdges.map((edge) => `${edge.target}:${edge.targetHandle}`));
  const mappedInputs = new Set();
  const mappedOutputs = new Set();
  const inputsValid = Object.entries(composition.inputs).every(([parentName, targets]) => (
    Array.isArray(targets) && targets.length > 0 && targets.every((target) => {
      const child = childByKey.get(target?.node);
      const childPort = child?.inputs.find((port) => port.name === target?.port);
      const endpoint = `${target?.node}:${target?.port}`;
      if (occupiedInputs.has(endpoint) || mappedInputs.has(endpoint)) return false;
      mappedInputs.add(endpoint);
      return childPort && childPort.type === parentInputByName.get(parentName)?.type;
    })
  ));
  const outputsValid = Object.entries(composition.outputs).every(([parentName, source]) => {
    const child = childByKey.get(source?.node);
    const childPort = child?.outputs.find((port) => port.name === source?.port);
    const endpoint = `${source?.node}:${source?.port}`;
    if (mappedOutputs.has(endpoint)) return false;
    mapped
Outputs.add(endpoint);
    return childPort && childPort.type === parentOutputByName.get(parentName)?.type;
  });
  return inputsValid && outputsValid;
}

const finiteArray = (value, length) => (
  Array.isArray(value)
  && (length === undefined || value.length === length)
  && value.every(Number.isFinite)
);

const metricsAreValid = (metrics) => (
  metrics === null
  || (metrics && typeof metrics === 'object' && !Array.isArray(metrics)
    && Object.values(metrics).every(Number.isFinite))
);

function trainedModelIsValid(model, topLevelNodes, expandedNodes, expandedEdges, dataset) {
  if (model === null || model === undefined) return true;
  if (
    !model || typeof model !== 'object' || Array.isArray(model)
    || !['linear_regression', 'knn_classifier', 'browser_mlp'].includes(model.type)
    || typeof model.sourceNodeId !== 'string' || !model.sourceNodeId
    || !Array.isArray(model.featureColumns) || model.featureColumns.length === 0
    || !model.featureColumns.every((column) => typeof column === 'string' && column)
    || new Set(model.featureColumns).size !== model.featureColumns.length
    || typeof model.targetColumn !== 'string' || !model.targetColumn
    || typeof model.hasPredictor !== 'boolean'
    || !finiteArray(model.lossHistory)
    || !metricsAreValid(model.metrics)
    || typeof model.trainedAt !== 'string'
    || !Number.isInteger(model.trainRows) || model.trainRows < 0
    || !Number.isInteger(model.testRows) || model.testRows < 0
  ) return false;
  const topLevelIds = new Set(topLevelNodes.map((node) => node.id));
  const sourceNodes = expandedNodes.filter((node) => (node.data.runtimeOwnerId ?? node.id) === model.sourceNodeId);
  const sourceManifest = sourceNodes.find((node) => (
    ['gradient_descent_node', 'knn_node', 'supervised_trainer_node'].includes(node.data.manifest.id)
  ))?.data.manifest;
  if (
    !topLevelIds.has(model.sourceNodeId) || !sourceManifest || !dataset
    || dataset.targetColumn !== model.targetColumn
    || !Array.isArray(dataset.featureColumns)
    || dataset.featureColumns.length !== model.featureColumns.length
    || dataset.featureColumns.some((column, index) => column !== model.featureColumns[index])
  ) return false;
  if (model.hasPredictor && !expandedEdges.some((edge) => (
    (expandedNodes.find((node) => node.id === edge.source)?.data.runtimeOwnerId ?? edge.source) === model.sourceNodeId
    && expandedNodes.find((node) => node.id === edge.target)?.data.manifest.id === 'predictor_node'
  ))) return false;
  const featureCount = model.featureColumns.length;
  const testSamplesAreValid = (classification) => (
    model.test === undefined
    || (Array.isArray(model.test)
      && model.test.length === model.testRows
      && model.test.every((sample) => (
        sample && typeof sample === 'object'
        && finiteArray(sample.x, featureCount)
        && (classification ? typeof sample.y === 'string' && sample.y : Number.isFinite(sample.y))
      )))
  );
  if (model.type === 'browser_mlp') {
    if (
      sourceManifest.id !== 'supervised_trainer_node'
      || !['regression', 'classification'].includes(model.task)
      || dataset.task !== model.task
      || typeof model.modelNodeId !== 'string' || !model.modelNodeId
      || !expandedNodes.some((node) => (
        (node.data.runtimeOwnerId ?? node.id) === model.modelNodeId
        && node.data.manifest.id === 'model_output_node'
      ))
      || !model.normalization || typeof model.normalization !== 'object'
      || !finiteArray(model.normalization.means, featureCount)
      || !finiteArray(model.normalization.stds, featureCount)
      || model.normalization.stds.some((value) => value === 0)
      || !Array.isArray(model.layers) || model.layers.length === 0
      || !Array.isArray(model.labels)
      || !Number.isInteger(model.epochs) || model.epochs <= 0
      || !Number.isFinite(model.learningRate) || model.learningRate <= 0
      || !testSamplesAreValid(model.task === 'classification')
    ) return false;
    let width = featureCount;
    let denseLayers = 0;
    for (const layer of model.layers) {
      if (!layer || typeof layer !== 'object' || Array.isArray(layer) || layer.adam !== undefined || layer.sgd !== undefined) return false;
      if (layer.op === 'dense') {
        if (
          !Number.isInteger(layer.input_features) || layer.input_features !== width
          || !Number.isInteger(layer.units) || layer.units <= 0
          || typeof layer.use_bias !== 'boolean'
          || !Array.isArray(layer.weights) || layer.weights.length !== layer.units
          || !layer.weights.every((row) => finiteArray(row, width))
          || !finiteArray(layer.bias, layer.units)
        ) return false;
        width = layer.units;
        denseLayers += 1;
      } else if (!['relu', 'sigmoid', 'tanh', 'softmax'].includes(layer.op)) return false;
    }
    if (model.task === 'classification') {
      return denseLayers > 0 && model.layers.at(-1)?.op === 'softmax'
        && model.labels.length === width && model.labels.length >= 2
        && model.labels.every((label) => typeof label === 'string' && label)
        && new Set(model.labels).size === model.labels.length;
    }
    return denseLayers > 0 && width === 1 && model.layers.at(-1)?.op !== 'softmax' && model.labels.length === 0;
  }
  if (model.type === 'linear_regression') {
    return dataset.task === 'regression'
      && sourceManifest.id === 'gradient_descent_node'
      && typeof model.modelNodeId === 'string' && model.modelNodeId
      && expandedNodes.some((node) => (
        node.data.manifest.id === 'linear_regression_node'
        && (node.id === model.modelNodeId || (node.data.runtimeOwnerId ?? node.id) === model.sourceNodeId)
      ))
      && finiteArray(model.weights, featureCount)
      && Number.isFinite(model.bias)
      && model.normalization && typeof model.normalization === 'object'
      && finiteArray(model.normalization.xMeans, featureCount)
      && finiteArray(model.normalization.xStds, featureCount)
      && model.normalization.xStds.every((value) => value !== 0)
      && Number.isFinite(model.normalization.yMean)
      && Number.isFinite(model.normalization.yStd) && model.normalization.yStd !== 0
      && Number.isInteger(model.epochs) && model.epochs > 0
      && Number.isFinite(model.learningRate) && model.learningRate > 0
      && testSamplesAreValid(false);
  }
  return dataset.task === 'classification'
    && sourceManifest.id === 'knn_node'
    && Array.isArray(model.train) && model.train.length > 0
    && model.train.every((sample) => (
      sample && typeof sample === 'object'
      && finiteArray(sample.x, featureCount)
      && typeof sample.y === 'string'
    ))
    && Number.isInteger(model.k) && model.k > 0 && model.k <= model.train.length
    && model.normalization && typeof model.normalization === 'object'
    && finiteArray(model.normalization.means, featureCount)
    && finiteArray(model.normalization.stds, featureCount)
    && model.normalization.stds.every((value) => value !== 0)
    && testSamplesAreValid(true);
}

export function validateProjectForWorkspace(rawProject) {
  const project = migrateProject(rawProject);
  if (typeof project.name !== 'string' || !Array.isArray(project.customComponents)) invalidProject();
  if (project.language !== undefined && (
    !project.language
    || typeof project.language !== 'object'
    || (project.language.primary !== undefined && typeof project.language.primary !== 'string')
    || (project.language.secondary !== undefined && project.language.secondary !== null && typeof project.language.secondary !== 'string')
  )) invalidProject();
  if (project.workspace !== undefined && (!project.workspace || typeof project.workspace !== 'object')) invalidProject();

  const customById = new Map();
  project.customComponents.forEach((manifest) => {
    if (!manifest || typeof manifest.id !== 'string' || customById.has(manifest.id) || componentById.has(manifest.id)) invalidProject();
    customById.set(manifest.id, manifest);
  });
  project.customComponents.forEach((manifest) => {
    if (!customManifestIsValid(manifest, customById)) invalidProject();
  });

  const nodeIds = new Set();
  const nodeManifests = new Map();
  const validationNodes = [];
  project.graph.nodes.forEach((node) => {
    const embeddedManifest = node?.data?.manifest;
    const embeddedInstance = embeddedManifest?.customComposite === true
      ? (customManifestIsValid(embeddedManifest, customById) ? embeddedManifest : null)
      : null;
    const manifest = embeddedInstance
      ?? componentById.get(embeddedManifest?.id)
      ?? customById.get(embeddedManifest?.id);
    if (
      !node || typeof node !== 'object'
      || typeof node.id !== 'string' || !node.id.trim() || nodeIds.has(node.id)
      || !Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)
      || !manifest || !parametersAreValid(manifest, node.data.parameters ?? {})
    ) invalidProject();
    nodeIds.add(node.id);
    nodeManifests.set(node.id, manifest);
    validationNodes.push({ ...node, data: { ...node.data, manifest } });
  });
  const edgeIds = new Set();
  const validatedEdges = [];
  project.graph.edges.forEach((edge) => {
    if (
      !edge || typeof edge !== 'object'
      || typeof edge.id !== 'string' || !edge.id.trim() || edgeIds.has(edge.id)
      || typeof edge.source !== 'string' || !nodeIds.has(edge.source)
      || typeof edge.target !== 'string' || !nodeIds.has(edge.target)
      || typeof edge.sourceHandle !== 'string' || typeof edge.targetHandle !== 'string'
      || !exactHandlesExist(edge, validationNodes)
      || !assessConnection(edge, validationNodes, validatedEdges).valid
    ) invalidProject();
    edgeIds.add(edge.id);
    validatedEdges.push(edge);
  });
  let expanded;
  try {
    expanded = flattenCustomComposites(validationNodes, validatedEdges);
  } catch {
    invalidProject();
  }
  if (!trainedModelIsValid(project.trainedModel, validationNodes, expanded.nodes, expanded.edges, project.data)) invalidProject();
  return project;
}

