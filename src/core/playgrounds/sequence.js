import { playgroundError } from './session.js';
import { normalizeDomainObservationPayload } from '../exploration/domainContract.js';

export const sequenceAttentionPlayground = {
  id: 'sequence-attention',
  domain: 'sequence',
  version: 1,
  adapterId: 'sequence-attention',
  titleKey: 'playground.sequenceAttention.title',
  descriptionKey: 'playground.sequenceAttention.description',
  supportedOps: ['sequence_attention_classifier'],
  supportedTasks: ['classification'],
  sourceKinds: ['example', 'sequence-dataset'],
  controls: [
      { key: 'trainingSteps', type: 'number', min: 1, max: 20, step: 1, runObjective: 'fit', domain: 'learning', presentation: { importance: 'primary', roles: ['experiment', 'inspection'], quickControl: true } },
      { key: 'attentionTemperature', type: 'number', min: 0.25, max: 4, step: 0.25, runObjective: 'inspect', domain: 'model', presentation: { importance: 'secondary', roles: ['experiment', 'inspection'] } },
      { key: 'showAttention', type: 'boolean', domain: 'view', presentation: { importance: 'secondary', roles: ['inspection'] } },
  ],
  actions: ['SET_CONTROL', 'START_TRAINING', 'STEP', 'SEEK', 'RESET', 'RUN_SCENARIO'],
  scenarios: [],

  validateSource(source) {
    if (!source || typeof source !== 'object' || source.domain !== 'sequence' || source.task !== 'classification') {
      throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'sequence-classification-source-required' });
    }
    const samples = Array.isArray(source.samples)
      ? source.samples.map((sample, index) => {
        const payload = normalizeDomainObservationPayload('sequence', sample.payload, `samples[${index}].payload`);
        return {
          id: String(sample.id ?? `sequence-${index + 1}`),
          label: typeof sample.label === 'string' && sample.label ? sample.label : null,
          membership: sample.membership === 'test' ? 'test' : 'train',
          provenance: sample.provenance ?? 'generated',
          payload,
        };
      }).filter((sample) => sample.label && sample.payload)
      : [];
    const labels = [...new Set(samples.map((sample) => sample.label))];
    if (samples.length < 4 || labels.length < 2 || !samples.some((sample) => sample.membership === 'test')) {
      throw playgroundError('INVALID_PLAYGROUND_SOURCE', { reason: 'sequence-source-needs-train-test-and-two-labels' });
    }
    return {
      kind: source.kind ?? 'example',
      domain: 'sequence',
      task: 'classification',
      name: source.name ?? 'Sequence attention sample',
      fingerprint: source.fingerprint ?? `sequence:${samples.length}`,
      samples,
      total: samples.length,
    };
  },
};
