import { localizedError } from '../i18n.js';
import { componentById } from './components.js';
import { assessConnection } from './connections.js';

export const PROJECT_VERSION = 7;

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

function customManifestIsValid(manifest, availableManifests, ancestors = new Set()) {
  const propertyKeys = new Set();
  if (
    !manifest || typeof manifest !== 'object' || Array.isArray(manifest)
    || manifest.customComposite !== true || manifest.kind !== 'composite'
    || typeof manifest.id !== 'string' || !manifest.id
    || typeof manifest.op !== 'string' || !manifest.op
    || typeof manifest.category !== 'string' || !manifest.category
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
  const inputsValid = Object.entries(composition.inputs).every(([parentName, targets]) => (
    Array.isArray(targets) && targets.length > 0 && targets.every((target) => {
      const child = childByKey.get(target?.node);
      const childPort = child?.inputs.find((port) => port.name === target?.port);
      return childPort && childPort.type === parentInputByName.get(parentName)?.type;
    })
  ));
  const outputsValid = Object.entries(composition.outputs).every(([parentName, source]) => {
    const child = childByKey.get(source?.node);
    const childPort = child?.outputs.find((port) => port.name === source?.port);
    return childPort && childPort.type === parentOutputByName.get(parentName)?.type;
  });
  return inputsValid && outputsValid;
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
  const validationNodes = [];
  project.graph.nodes.forEach((node) => {
    const embeddedManifest = node?.data?.manifest;
    const manifest = componentById.get(embeddedManifest?.id)
      ?? customById.get(embeddedManifest?.id)
      ?? (embeddedManifest?.customComposite && customManifestIsValid(embeddedManifest, customById) ? embeddedManifest : null);
    if (
      !node || typeof node !== 'object'
      || typeof node.id !== 'string' || !node.id.trim() || nodeIds.has(node.id)
      || !Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)
      || !manifest || !parametersAreValid(manifest, node.data.parameters ?? {})
    ) invalidProject();
    nodeIds.add(node.id);
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
      || !assessConnection(edge, validationNodes, validatedEdges).valid
    ) invalidProject();
    edgeIds.add(edge.id);
    validatedEdges.push(edge);
  });
  return project;
}
