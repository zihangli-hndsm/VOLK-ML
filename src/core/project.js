import { localizedError } from '../i18n.js';

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

  const nodeIds = new Set();
  project.graph.nodes.forEach((node) => {
    const manifest = node?.data?.manifest;
    if (
      !node || typeof node !== 'object'
      || typeof node.id !== 'string' || !node.id.trim() || nodeIds.has(node.id)
      || !Number.isFinite(node.position?.x) || !Number.isFinite(node.position?.y)
      || !manifest || typeof manifest !== 'object' || typeof manifest.id !== 'string' || !manifest.id
      || !node.data.parameters || typeof node.data.parameters !== 'object' || Array.isArray(node.data.parameters)
    ) invalidProject();
    nodeIds.add(node.id);
  });
  const edgeIds = new Set();
  project.graph.edges.forEach((edge) => {
    if (
      !edge || typeof edge !== 'object'
      || typeof edge.id !== 'string' || !edge.id.trim() || edgeIds.has(edge.id)
      || typeof edge.source !== 'string' || !nodeIds.has(edge.source)
      || typeof edge.target !== 'string' || !nodeIds.has(edge.target)
      || typeof edge.sourceHandle !== 'string' || typeof edge.targetHandle !== 'string'
    ) invalidProject();
    edgeIds.add(edge.id);
  });
  project.customComponents.forEach((manifest) => {
    if (
      !manifest || typeof manifest !== 'object'
      || typeof manifest.id !== 'string' || !manifest.id
      || !localizedTextIsValid(manifest.name) || !localizedTextIsValid(manifest.description)
      || !Array.isArray(manifest.inputs) || !Array.isArray(manifest.outputs) || !Array.isArray(manifest.properties)
    ) invalidProject();
  });
  return project;
}
