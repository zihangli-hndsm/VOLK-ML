import { EXPLORATION_DOMAIN_CONTRACTS, normalizeExplorationDomain, summarizeExplorationDomain } from './domainContract.js';

// Static Phase 9A fixtures pressure-test the cross-domain exploration grammar
// before a domain receives a browser training backend. They are not executable
// Worlds and cannot mutate a Playground session.
const PROBES = Object.freeze([
  {
    id: 'tabular-regression',
    domain: 'tabular',
    task: 'regression',
    world: { kind: 'finite-observations', split: 'train-test', manipulables: ['input', 'noise', 'sample-count'] },
    model: { family: 'linear-regression', inductiveBias: ['linear-function'] },
    evidence: { observableIds: ['world.trainXRange', 'world.testXRange', 'outcome.trainMse', 'outcome.testMse'] },
    depths: { phenomenon: 'plot2d', evidence: 'comparison', mechanism: 'training-trace', representation: 'formula' },
  },
  {
    id: 'image-classification',
    domain: 'image',
    task: 'classification',
    world: { kind: 'finite-labeled-images', split: 'train-test', manipulables: ['crop', 'occlusion', 'augmentation', 'label'] },
    model: { family: 'cnn', inductiveBias: ['locality', 'translation-equivariance'] },
    evidence: { observableIds: ['image.testAccuracy', 'image.classBalance', 'comparison.clarity'] },
    depths: { phenomenon: 'image-grid', evidence: 'comparison', mechanism: 'feature-map', representation: 'activation-map' },
  },
  {
    id: 'sequence-attention',
    domain: 'sequence',
    task: 'sequence-prediction',
    world: { kind: 'finite-token-sequences', split: 'train-test', manipulables: ['context-window', 'mask', 'token-order'] },
    model: { family: 'transformer', inductiveBias: ['position', 'content-dependent-attention'] },
    evidence: { observableIds: ['sequence.testAccuracy', 'sequence.contextCoverage', 'comparison.clarity'] },
    depths: { phenomenon: 'token-sequence', evidence: 'comparison', mechanism: 'attention-matrix', representation: 'embedding-2d' },
  },
]);

function clone(value) {
  return structuredClone(value);
}

export function listPhase9Probes() {
  return PROBES.map((probe) => ({
    ...clone(probe),
    domainContract: summarizeExplorationDomain(probe.domain),
    executable: false,
  }));
}

export function getPhase9Probe(id) {
  const probe = PROBES.find((item) => item.id === id);
  return probe ? listPhase9Probes().find((item) => item.id === id) : null;
}

export function validatePhase9Probe(probe) {
  if (!probe || typeof probe !== 'object' || Array.isArray(probe)) return { valid: false, reason: 'probe-object-required' };
  if (typeof probe.id !== 'string' || !probe.id) return { valid: false, reason: 'probe-id-required' };
  let domain;
  try { domain = normalizeExplorationDomain(probe.domain); } catch { return { valid: false, reason: 'unsupported-domain' }; }
  const contract = EXPLORATION_DOMAIN_CONTRACTS[domain];
  if (!contract || contract.probeId !== probe.id) return { valid: false, reason: 'domain-probe-mismatch' };
  if (!contract.taskKinds.includes(probe.task)) return { valid: false, reason: 'unsupported-task' };
  if (!probe.world?.kind || !Array.isArray(probe.world?.manipulables) || !probe.world.manipulables.length) {
    return { valid: false, reason: 'world-contract-incomplete' };
  }
  if (!probe.model?.family || !Array.isArray(probe.model?.inductiveBias)) {
    return { valid: false, reason: 'model-contract-incomplete' };
  }
  if (!Array.isArray(probe.evidence?.observableIds) || !probe.evidence.observableIds.length) {
    return { valid: false, reason: 'evidence-contract-incomplete' };
  }
  const depths = Object.values(probe.depths ?? {});
  if (depths.length !== 4 || depths.some((value) => typeof value !== 'string' || !value)) {
    return { valid: false, reason: 'depth-contract-incomplete' };
  }
  return { valid: true, domain };
}

export function validateAllPhase9Probes() {
  return PROBES.map((probe) => ({ id: probe.id, ...validatePhase9Probe(probe) }));
}

