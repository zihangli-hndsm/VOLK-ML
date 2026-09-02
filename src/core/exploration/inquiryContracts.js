// Declarative contracts for local-first inquiry episodes. Contracts are JSON
// safe data; validation is intentionally strict so a malformed episode cannot
// silently claim capabilities the host does not provide.
import { listWorldOperations } from './operationRegistry.js';
import { OBSERVABLE_IDS } from './observables.js';
import { messages } from '../../locales/ui.js';

export const EXPLORATION_CONTRACT_VERSION = 1;
export const ORCHESTRATION_CONTRACT_VERSION = 1;

export const LUMI_ACTION_TYPES = Object.freeze([
  'ASK', 'SUGGEST_EXPERIMENT', 'PROPOSE_HYPOTHESIS', 'PROPOSE_COUNTEREXAMPLE',
  'HIGHLIGHT_EVIDENCE', 'OFFER_COMPARISON', 'OFFER_DEPTH', 'NAME_CONNECTION',
  'REFLECT_PATH', 'STAY_SILENT',
]);

const EPISODE_ID = 'episode-1-sampling-variability';
const worldOperations = new Set(listWorldOperations().map((item) => item.type));
const observableIds = new Set(OBSERVABLE_IDS);

export const EPISODE_ONE_EXPLORATION_CONTRACT = Object.freeze({
  version: EXPLORATION_CONTRACT_VERSION,
  id: EPISODE_ID,
  identity: { world: 'world.linear-regression-v1', sampleLineage: 'same-world-resample-v1', model: 'linear-regression' },
  world: {
    factors: ['relation.slope', 'relation.bias', 'noise.amount', 'train.samples'],
    relation: { slope: 1.5, bias: 0.5 }, noise: 0.8, trainSamples: 12,
  },
  observation: {
    operation: 'RESAMPLE_WORLD', sampleSize: 12, seed: { initial: 7101, increment: 1 },
    preserves: ['world.identity', 'world.factors', 'observation.rule', 'observation.sampleSize'],
    changes: ['observation.realizationSeed', 'sample.identity', 'dataset.identity'],
    viewOperationsNonSemantic: ['SET_WORKSPACE_VIEW', 'SET_VISUAL'],
  },
  model: { family: 'linear-regression', fitOperation: 'RUN', configuration: 'default' },
  experiment: { baseline: 'first-completed-fit', duplicateOperation: 'DUPLICATE_EXPERIMENT', compareOperation: 'SET_COMPARE', repeat: true },
  observables: ['world.trainSampleCount', 'model.slope', 'model.bias', 'outcome.trainMse'],
  evidence: { detectorId: 'sampling-variability-linear-fit-v1' },
  presentation: { depths: ['PHENOMENON', 'EVIDENCE', 'MECHANISM', 'REPRESENTATION'], capabilities: ['fitted-line-overlay', 'structured-comparison'] },
});

export const EPISODE_ONE_ORCHESTRATION_CONTRACT = Object.freeze({
  version: ORCHESTRATION_CONTRACT_VERSION,
  id: EPISODE_ID,
  explorationContractId: EPISODE_ID,
  learningIntent: 'sampling-variability',
  entry: { titleKey: 'episode.one.title', questionKey: 'episode.one.question', orientationKey: 'episode.one.orientation' },
  prediction: { mode: 'optional', choices: ['same', 'different', 'unsure'], maxReasoningLength: 240 },
  graph: [
    { id: 'question', next: ['baseline-fit'] }, { id: 'baseline-fit', next: ['resample'] },
    { id: 'resample', next: ['second-fit'] }, { id: 'second-fit', next: ['compare'] },
    { id: 'compare', next: ['evidence'] }, { id: 'evidence', next: ['concept', 'resample'] },
    { id: 'concept', next: ['continuation'] }, { id: 'continuation', next: [] },
  ],
  fallbackSpine: ['question', 'baseline-fit', 'resample', 'second-fit', 'compare', 'evidence', 'concept', 'continuation'],
  evidenceRule: { detectorId: 'sampling-variability-linear-fit-v1', eligibleOutcome: 'evidenced', weakOutcome: 'valid-weak' },
  conceptEligibility: { conceptId: 'SAMPLING_VARIABILITY', outcome: 'evidenced' },
  guidance: { policy: 'local-fallback', maxHintsPerStage: 1, cooldownEventsAfterConcept: 3, maxHistory: 12 },
  continuations: [
    { id: 'collect-more-data', questionKey: 'episode.one.continue.moreData' },
    { id: 'repeat-many-times', questionKey: 'episode.one.continue.repeat' },
    { id: 'noisier-world', questionKey: 'episode.one.continue.noisier' },
  ],
  transferHooks: ['more-data', 'repeated-sampling', 'noise'],
  agentPolicy: { authority: 'suggestion-only', actionTypes: LUMI_ACTION_TYPES },
});

export const EXPLORATION_CONTRACTS = Object.freeze({ [EPISODE_ID]: EPISODE_ONE_EXPLORATION_CONTRACT });
export const ORCHESTRATION_CONTRACTS = Object.freeze({ [EPISODE_ID]: EPISODE_ONE_ORCHESTRATION_CONTRACT });

export function getExplorationContract(id) { return EXPLORATION_CONTRACTS[id] ?? null; }
export function getOrchestrationContract(id) { return ORCHESTRATION_CONTRACTS[id] ?? null; }

export function validateExplorationContract(contract) {
  const errors = [];
  if (contract?.version !== EXPLORATION_CONTRACT_VERSION || typeof contract?.id !== 'string') errors.push('identity');
  if (!worldOperations.has(contract?.observation?.operation)) errors.push('observation.operation');
  if (contract?.model?.family !== 'linear-regression' || contract?.model?.fitOperation !== 'RUN') errors.push('model.capability');
  if (!['DUPLICATE_EXPERIMENT'].includes(contract?.experiment?.duplicateOperation)) errors.push('experiment.duplicateOperation');
  if (!['SET_COMPARE', 'COMPARE_EXPERIMENTS'].includes(contract?.experiment?.compareOperation)) errors.push('experiment.compareOperation');
  for (const id of contract?.observables ?? []) if (!observableIds.has(id)) errors.push(`observable:${id}`);
  if (contract?.evidence?.detectorId !== 'sampling-variability-linear-fit-v1') errors.push('evidence.detectorId');
  return { valid: errors.length === 0, errors };
}

export function validateOrchestrationContract(contract) {
  const errors = [];
  if (contract?.version !== ORCHESTRATION_CONTRACT_VERSION || typeof contract?.id !== 'string') errors.push('identity');
  if (!getExplorationContract(contract?.explorationContractId)) errors.push('explorationContractId');
  if (!['mandatory', 'optional', 'disabled'].includes(contract?.prediction?.mode)) errors.push('prediction.mode');
  for (const action of contract?.agentPolicy?.actionTypes ?? []) if (!LUMI_ACTION_TYPES.includes(action)) errors.push(`action:${action}`);
  if (!contract?.entry?.titleKey || !contract?.entry?.questionKey) errors.push('entry.localization');
  for (const key of [contract?.entry?.titleKey, contract?.entry?.questionKey, contract?.entry?.orientationKey, ...(contract?.continuations ?? []).map((item) => item.questionKey)]) {
    if (key && !messages[key]) errors.push(`localization:${key}`);
  }
  if (!Array.isArray(contract?.fallbackSpine) || !contract.fallbackSpine.length) errors.push('fallbackSpine');
  return { valid: errors.length === 0, errors };
}

export function validateInquiryContracts() {
  return { exploration: validateExplorationContract(EPISODE_ONE_EXPLORATION_CONTRACT), orchestration: validateOrchestrationContract(EPISODE_ONE_ORCHESTRATION_CONTRACT) };
}
