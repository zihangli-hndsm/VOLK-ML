import { playgroundError } from './session.js';
import { normalizeDomainObservationPayload } from '../exploration/domainContract.js';

export const imageClassificationPlayground = {
  id: 'image-classification',
  domain: 'image',
  version: 1,
  adapterId: 'image-cnn',
  titleKey: 'playground.imageClassification.title',
  descriptionKey: 'playground.imageClassification.description',
  supportedOps: ['cnn_classifier'],
  supportedTasks: ['classification'],
  sourceKinds: ['example', 'image-dataset'],
  controls: [
    { key: 'trainingSteps', type: 'number', min: 1, max: 20, step: 1, runObjective: 'fit', domain: 'learning', presentation: { importance: 'primary', roles: ['experiment', 'inspection'], quickControl: true } },
    { key: 'showFeatureMap', type: 'boolean', domain: 'view', presentation: { importance: 'secondary', roles: ['inspection'] } },
  ],
  actions: ['SET_CONTROL', 'START_TRAINING', 'STEP', 'SEEK', 'RESET', 'RUN_SCENARIO'],
  scenarios: [],

  validateSource(source) {
    if (!source || typeof source !== 'object' || source.domain !== 'image' || source.task !== 'classification') {
      throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'image-classification-source-required' });
    }
    const samples = Array.isArray(source.samples)
      ? source.samples.map((sample, index) => {
        const payload = normalizeDomainObservationPayload('image', sample.payload, `samples[${index}].payload`);
        return {
          id: String(sample.id ?? `image-${index + 1}`),
          label: typeof sample.label === 'string' && sample.label ? sample.label : null,
          membership: sample.membership === 'test' ? 'test' : 'train',
          provenance: sample.provenance ?? 'generated',
          payload,
        };
      }).filter((sample) => sample.label && sample.payload)
      : [];
    const labels = [...new Set(samples.map((sample) => sample.label))];
    if (samples.length < 4 || labels.length < 2 || !samples.some((sample) => sample.membership === 'test')) {
      throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'image-source-needs-train-test-and-two-labels' });
    }
    return {
      kind: source.kind ?? 'example',
      domain: 'image',
      task: 'classification',
      name: source.name ?? 'Image classification sample',
      fingerprint: source.fingerprint ?? `image:${samples.length}`,
      samples,
      total: samples.length,
    };
  },
};
