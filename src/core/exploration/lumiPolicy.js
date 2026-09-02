import { LUMI_ACTION_TYPES } from './inquiryContracts.js';

const CLOUD_ACTIONS = new Set(LUMI_ACTION_TYPES);

function bounded(value, max = 120) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= max ? text : null;
}

function boundedIds(values, max = 8) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => bounded(value, 120)).filter(Boolean))].slice(0, max);
}

export const LUMI_ACTION_VERSION = 1;
const PROPOSALS = new Set(['SUGGEST_EXPERIMENT', 'PROPOSE_HYPOTHESIS', 'PROPOSE_COUNTEREXAMPLE', 'OFFER_COMPARISON', 'OFFER_DEPTH']);

export function validateLumiAction(action) {
  if (!action || !LUMI_ACTION_TYPES.includes(action.type)) return { valid: false, error: 'unsupported-action' };
  if (action.type === 'STAY_SILENT') return { valid: true, action: { version: LUMI_ACTION_VERSION, type: 'STAY_SILENT' } };
  const canonical = { version: LUMI_ACTION_VERSION, type: action.type, payload: action.payload ?? {}, authority: action.authority ?? (PROPOSALS.has(action.type) ? 'suggestion-only' : 'presentation'), requiresLearnerAcceptance: action.requiresLearnerAcceptance ?? PROPOSALS.has(action.type) };
  if (PROPOSALS.has(canonical.type) && (canonical.authority !== 'suggestion-only' || canonical.requiresLearnerAcceptance !== true)) return { valid: false, error: 'proposal-authority' };
  return { valid: true, action: canonical };
}

export const staySilent = () => ({ version: LUMI_ACTION_VERSION, type: 'STAY_SILENT' });

export function projectLumiCloudRequest(context = {}, requestId = `lumi-${Date.now()}`) {
  const runtime = context.inquiryRuntime ?? context;
  const evidence = runtime.evidence ?? context.evidence ?? null;
  const eventIds = (runtime.recentSemanticEvents ?? []).map((event) => event?.id);
  const observationIds = (runtime.observations ?? []).map((observation) => observation?.id);
  return {
    apiVersion: '0', requestId: bounded(requestId, 96) ?? 'lumi-request',
    inquiry: {
      contractId: bounded(runtime.contractId), questionKey: bounded(runtime.currentQuestion), stage: bounded(runtime.stage),
      prediction: runtime.prediction ? { expectation: bounded(runtime.prediction.expectation), skipped: Boolean(runtime.prediction.skipped) } : null,
      comparison: runtime.comparison ? { experimentIds: boundedIds(runtime.comparison.experimentIds, 2), changedFactors: boundedIds(runtime.comparison.changedFactors, 12), clarity: bounded(runtime.comparison.clarity) } : null,
      evidence: evidence ? { status: bounded(evidence.status), detectorId: bounded(evidence.structure?.detectorId), experimentIds: boundedIds(evidence.structure?.experimentIds, 2), observationIds: boundedIds(observationIds) } : null,
      recentSemanticEventIds: boundedIds(eventIds, 24),
      candidateConcepts: boundedIds(runtime.candidateConcepts, 8),
    },
  };
}

export function adaptCloudLumiResponse(response, { requestId, context } = {}) {
  if (!response || response.apiVersion !== '0' || response.requestId !== requestId || !CLOUD_ACTIONS.has(response.action)) return { valid: false, error: 'unsupported-cloud-response' };
  if (!response.payload || typeof response.payload !== 'object' || Array.isArray(response.payload)) return { valid: false, error: 'invalid-payload' };
  const requires = response.requiresLearnerConfirmation;
  if (typeof requires !== 'boolean') return { valid: false, error: 'invalid-confirmation' };
  if (response.action === 'STAY_SILENT' && requires) return { valid: false, error: 'silent-confirmation' };
  const proposal = PROPOSALS.has(response.action);
  if (proposal && !requires) return { valid: false, error: 'proposal-confirmation-required' };
  if (response.action === 'SUGGEST_EXPERIMENT'
    && !['RUN', 'RESAMPLE_WORLD', 'DUPLICATE_EXPERIMENT', 'SET_COMPARE'].includes(response.payload.operation)) return { valid: false, error: 'unsupported-experiment-operation' };
  if (response.action === 'OFFER_DEPTH' && !['PHENOMENON', 'EVIDENCE', 'MECHANISM', 'REPRESENTATION'].includes(response.payload.depth)) return { valid: false, error: 'unsupported-depth' };
  if (response.action === 'OFFER_COMPARISON' && boundedIds(response.payload.experimentIds, 2).length < 2) return { valid: false, error: 'comparison-reference-required' };
  if (response.action === 'HIGHLIGHT_EVIDENCE') {
    const available = new Set((context?.inquiryRuntime?.observations ?? []).map((item) => item?.id).filter(Boolean));
    const ids = boundedIds(response.payload.observationIds ?? response.payload.evidenceIds);
    if (!ids.length || ids.some((id) => !available.has(id))) return { valid: false, error: 'evidence-reference-out-of-scope' };
    response = { ...response, payload: { ...response.payload, observationIds: ids } };
  }
  return validateLumiAction({ type: response.action, payload: response.payload, authority: proposal ? 'suggestion-only' : 'presentation', requiresLearnerAcceptance: requires });
}

export function createCloudLumiPolicy(client) {
  if (!client || typeof client.lumiRespond !== 'function') return null;
  return {
    async decide(context) {
      const requestId = `lumi-${crypto.randomUUID()}`;
      const response = await client.lumiRespond(projectLumiCloudRequest(context, requestId));
      const adapted = adaptCloudLumiResponse(response, { requestId, context });
      if (!adapted.valid) throw new Error(adapted.error);
      return adapted.action;
    },
  };
}

export function localFallbackPolicy(context = {}) {
  if (context.guidance?.cooldownRemaining > 0 || context.guidance?.staySilent) return staySilent();
  const stage = context.stage ?? context.inquiryRuntime?.stage;
  if (context.evidence?.status === 'evidenced') return { version: 1, type: 'NAME_CONNECTION', payload: { conceptId: 'SAMPLING_VARIABILITY' }, authority: 'presentation', requiresLearnerAcceptance: false };
  if (context.evidence?.status === 'valid-weak') return { version: 1, type: 'SUGGEST_EXPERIMENT', payload: { operation: 'RESAMPLE_WORLD', reason: 'repeat-visible-variation' }, authority: 'suggestion-only', requiresLearnerAcceptance: true };
  if (stage === 'question' || stage === 'exploring') return { version: 1, type: 'ASK', payload: { promptKey: 'episode.one.guidance.question' }, authority: 'presentation', requiresLearnerAcceptance: false };
  if (stage === 'baseline-fit') return { version: 1, type: 'SUGGEST_EXPERIMENT', payload: { operation: 'RUN', reason: 'capture-baseline' }, authority: 'suggestion-only', requiresLearnerAcceptance: true };
  if (stage === 'resample') return { version: 1, type: 'SUGGEST_EXPERIMENT', payload: { operation: 'RESAMPLE_WORLD', reason: 'same-world-resample' }, authority: 'suggestion-only', requiresLearnerAcceptance: true };
  return staySilent();
}

export async function decideLumiAction({ context, cloudPolicy } = {}) {
  if (!cloudPolicy || typeof cloudPolicy.decide !== 'function') return localFallbackPolicy(context);
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => cloudPolicy.decide(context)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500)),
    ]);
    const validated = validateLumiAction(result);
    return validated.valid ? validated.action : localFallbackPolicy(context);
  } catch {
    return localFallbackPolicy(context);
  }
}

export function applyGuidanceBudget(history = [], action, { stage = 'unknown', conceptSurfaced = false, dismissed = false } = {}) {
  const bounded = Array.isArray(history) ? history.slice(-11) : [];
  const previous = bounded.filter((entry) => entry?.stage === stage);
  if (previous.some((entry) => entry?.action?.type === action?.type)) return bounded;
  return [...bounded, { stage, action: validateLumiAction(action).action ?? staySilent(), dismissed: Boolean(dismissed), conceptSurfaced: Boolean(conceptSurfaced) }].slice(-12);
}

export function guidanceStageState(history = [], stage = 'unknown') {
  const entries = (history ?? []).filter((entry) => entry?.stage === stage);
  return {
    hinted: entries.length > 0,
    dismissed: entries.some((entry) => entry.dismissed),
    actions: entries.map((entry) => entry.action?.type).filter(Boolean),
  };
}
