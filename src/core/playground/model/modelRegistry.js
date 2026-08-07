import { linearRegressionAdapter } from './linearRegressionAdapter.js';
import { knnAdapter } from './knnAdapter.js';

// Model Adapter contract:
//   { id, capabilities, defaultVisualizationPreset,
//     initialize({source, controls, seed, recorder}),
//     applyModelAction(modelState, action, {controls, recorder}),
//     deriveScene(modelState, {controls}),
//     buildPrimitives(modelState, scene, derived, {controls}) }
// Adapters are pure model logic: they never import React, DOM, SVG or the
// session reducer. The unified playground runtime owns the session.
const adapters = [linearRegressionAdapter, knnAdapter];
const byId = new Map(adapters.map((adapter) => [adapter.id, adapter]));

export function listModelAdapters() {
  return adapters.map((adapter) => ({
    id: adapter.id,
    capabilities: { ...adapter.capabilities },
    defaultVisualizationPreset: adapter.defaultVisualizationPreset,
  }));
}

export function getModelAdapter(id) {
  return byId.get(id) ?? null;
}

export function requireModelAdapter(id) {
  const adapter = getModelAdapter(id);
  if (!adapter) {
    throw Object.assign(new Error('PLAYGROUND_NOT_FOUND'), {
      code: 'PLAYGROUND_NOT_FOUND',
      details: { adapterId: id },
    });
  }
  return adapter;
}
