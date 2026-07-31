import { localizedError } from '../i18n.js';

export const PROJECT_VERSION = 6;

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
  return {
    ...migrated,
    name: migrated.name || 'Sample Project',
    customComponents: migrated.customComponents ?? [],
    version: PROJECT_VERSION,
  };
}
