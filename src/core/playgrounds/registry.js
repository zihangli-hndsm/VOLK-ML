import { linearRegressionPlayground } from './linearRegression.js';
import { knnPlayground } from './knn.js';
import { mlpPlayground } from './mlp.js';
import { dataLabPlayground } from './dataLab.js';
import { imageClassificationPlayground } from './image.js';
import { sequenceAttentionPlayground } from './sequence.js';
import { ragPlayground, retrievalPlayground } from './retrieval.js';
import { validatePlaygroundControlPresentation } from '../ui/contextualTune.js';

const playgrounds = [linearRegressionPlayground, knnPlayground, mlpPlayground, imageClassificationPlayground, sequenceAttentionPlayground, retrievalPlayground, ragPlayground, dataLabPlayground];
playgrounds.forEach(validatePlaygroundControlPresentation);
const byId = new Map(playgrounds.map((playground) => [playground.id, playground]));

const summarize = (playground) => ({
  id: playground.id,
  domain: playground.domain ?? 'tabular',
  version: playground.version,
  titleKey: playground.titleKey,
  descriptionKey: playground.descriptionKey,
  supportedOps: [...playground.supportedOps],
  supportedTasks: [...playground.supportedTasks],
  sourceKinds: [...playground.sourceKinds],
  controls: playground.controls.map(({ key, type, min, max, step, options, domain, runObjective, presentation }) => ({
    key, type,
    ...(domain ? { domain } : {}),
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(step !== undefined ? { step } : {}),
    ...(options ? { options: [...options] } : {}),
    ...(runObjective ? { runObjective } : {}),
    ...(presentation ? { presentation: structuredClone(presentation) } : {}),
  })),
  actions: [...playground.actions],
  scenarios: playground.scenarios.map(({ id, titleKey }) => ({ id, titleKey })),
});

export function listPlaygrounds() {
  return playgrounds.filter((playground) => playground.kind !== 'session').map(summarize);
}

export function listPlaygroundDescriptors() {
  return playgrounds.map((playground) => playground);
}

export function getPlayground(id) {
  return byId.get(id) ?? null;
}

// A playground is available when the component manifest's operation is in its
// supportedOps set. The dataset parameter is kept for source validation at open
// time; it does not widen availability.
export function playgroundsFor({ manifest, dataset }) {
  if (!manifest) return [];
  return playgrounds
    .filter((playground) => playground.supportedOps.includes(manifest.op))
    .map(summarize);
}
