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
const PROPOSALS = new Set(['SUGGEST_EXPERIMENT', 'PROPOSE_HYPOTHESIS', 'PROPOSE_COUNTEREXAMPLE']);

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
  const observations = (runtime.observations ?? []).filter((observation) => bounded(observation?.id));
  const request = {
    apiVersion: '0', requestId: bounded(requestId, 96) ?? 'lumi-request',
    inquiry: {
      ...(bounded(runtime.currentInquiry) ? { inquiryId: bounded(runtime.currentInquiry) } : {}),
      ...(bounded(runtime.contractId) ? { orchestrationId: bounded(runtime.contractId) } : {}),
      ...(bounded(runtime.currentQuestion) ? { currentQuestion: bounded(runtime.currentQuestion) } : {}),
      ...(bounded(runtime.currentDepth) ? { currentDepth: bounded(runtime.currentDepth) } : {}),
    },
    ...(runtime.prediction && !runtime.prediction.skipped && bounded(runtime.prediction.expectation)
      ? { prediction: { expectation: bounded(runtime.prediction.expectation), ...(bounded(runtime.prediction.reasoning, 240) ? { reasoning: bounded(runtime.prediction.reasoning, 240) } : {}) } }
      : {}),
    ...(runtime.baseline || runtime.comparison || runtime.worldIdentity ? { experiment: {
      ...(bounded(runtime.worldIdentity) ? { worldIdentity: bounded(runtime.worldIdentity, 256) } : {}),
      ...(runtime.baseline?.experimentId ? { baseline: bounded(runtime.baseline.experimentId, 1000) } : {}),
      ...(runtime.comparison ? { activeComparison: boundedIds(runtime.comparison.experimentIds, 2).join(' vs ') || 'active-comparison' } : {}),
    } } : {}),
    recentEvents: (runtime.recentSemanticEvents ?? []).slice(-24).map((event) => ({
      ...(bounded(event?.id) ? { eventId: bounded(event.id) } : {}),
      eventType: bounded(event?.type) ?? 'semantic.event',
      ...(bounded(event?.reasonCode) ? { summary: bounded(event.reasonCode) } : {}),
    })),
    evidence: observations.map((observation) => ({
      evidenceId: bounded(observation.id),
      evidenceType: observation.id === 'SAMPLING_VARIABILITY_EVIDENCED' ? 'sampling_variability' : (bounded(observation.id) ?? 'observation'),
      ...(bounded(observation.messageKey) ? { summary: bounded(observation.messageKey) } : {}),
      ...(observation.evidence && typeof observation.evidence === 'object' ? { facts: boundedIds([
        ...(observation.evidence.evidence?.changed ?? []),
        ...(observation.evidence.evidence?.held ?? []),
        ...(observation.evidence.evidence?.observed ? Object.keys(observation.evidence.evidence.observed) : []),
      ], 16) } : {}),
    })),
    candidateConcepts: boundedIds(runtime.candidateConcepts, 8).map((conceptId) => ({ conceptId, label: conceptId })),
    conceptsEncountered: boundedIds(runtime.encounteredConcepts, 8),
    conceptsEvidenced: boundedIds(runtime.evidencedConcepts, 8),
    recentLumiActions: (runtime.guidanceHistory ?? []).slice(-12).map((entry) => entry?.action?.type).filter((type) => CLOUD_ACTIONS.has(type)).map((action) => ({ action })),
    policy: { autonomyLevel: 'suggestion-only', proactiveAllowed: true },
  };
  if (!Object.keys(request.inquiry).length) delete request.inquiry;
  return request;
}

export function validateLumiCloudRequestV0(request) {
  const errors = [];
  const topKeys = new Set(['apiVersion', 'requestId', 'inquiry', 'prediction', 'experiment', 'recentEvents', 'evidence', 'candidateConcepts', 'conceptsEncountered', 'conceptsEvidenced', 'recentLumiActions', 'policy']);
  for (const key of Object.keys(request ?? {})) if (!topKeys.has(key)) errors.push(`unknown:${key}`);
  if (request?.apiVersion !== '0' || typeof request?.requestId !== 'string' || !request.requestId) errors.push('identity');
  if (!request?.inquiry || typeof request.inquiry !== 'object') errors.push('inquiry');
  for (const event of request?.recentEvents ?? []) if (!event || typeof event.eventType !== 'string') errors.push('recentEvents');
  for (const item of request?.evidence ?? []) if (!item || typeof item.evidenceId !== 'string' || typeof item.evidenceType !== 'string' || !Array.isArray(item.facts ?? [])) errors.push('evidence');
  for (const item of request?.candidateConcepts ?? []) if (!item || typeof item.conceptId !== 'string' || typeof item.label !== 'string') errors.push('candidateConcepts');
  for (const item of request?.recentLumiActions ?? []) if (!item || !CLOUD_ACTIONS.has(item.action)) errors.push('recentLumiActions');
  if (request?.policy && (typeof request.policy.proactiveAllowed !== 'boolean' || typeof request.policy.autonomyLevel !== 'string')) errors.push('policy');
  return { valid: errors.length === 0, errors };
}

export const validateLumiCloudRequest = validateLumiCloudRequestV0;

export function adaptCloudLumiResponse(response, { requestId, context } = {}) {
  if (!response || response.apiVersion !== '0' || response.requestId !== requestId || !CLOUD_ACTIONS.has(response.action)) return { valid: false, error: 'unsupported-cloud-response' };
  if (!response.payload || typeof response.payload !== 'object' || Array.isArray(response.payload)) return { valid: false, error: 'invalid-payload' };
  const requires = response.requiresLearnerConfirmation;
  if (typeof requires !== 'boolean') return { valid: false, error: 'invalid-confirmation' };
  if (response.action === 'STAY_SILENT' && requires) return { valid: false, error: 'silent-confirmation' };
  const proposal = PROPOSALS.has(response.action);
  if (proposal && !requires) return { valid: false, error: 'proposal-confirmation-required' };
  const payload = response.payload;
  if (response.action === 'ASK' && !bounded(payload.question, 2000)) return { valid: false, error: 'invalid-ask-payload' };
  if (['PROPOSE_HYPOTHESIS', 'PROPOSE_COUNTEREXAMPLE', 'NAME_CONNECTION', 'REFLECT_PATH'].includes(response.action) && !bounded(payload.text, 2000)) return { valid: false, error: 'invalid-text-payload' };
  if (response.action === 'SUGGEST_EXPERIMENT' && (!bounded(payload.recipeId, 128) || !bounded(payload.description, 2000))) return { valid: false, error: 'invalid-experiment-proposal' };
  if (response.action === 'OFFER_DEPTH' && !['evidence', 'mechanism', 'representation', 'math', 'builder'].includes(payload.target)) return { valid: false, error: 'unsupported-depth' };
  if (response.action === 'HIGHLIGHT_EVIDENCE') {
    const available = new Set((context?.inquiryRuntime?.observations ?? []).map((item) => item?.id).filter(Boolean));
    const ids = boundedIds(payload.evidenceIds);
    if (!ids.length || ids.some((id) => !available.has(id))) return { valid: false, error: 'evidence-reference-out-of-scope' };
  }
  if (response.action === 'HIGHLIGHT_EVIDENCE') {
    response = { ...response, payload: { evidenceIds: boundedIds(payload.evidenceIds), facts: boundedIds(payload.facts, 16) } };
  }
  const internalPayload = response.action === 'OFFER_DEPTH'
    ? { depth: payload.target }
    : response.action === 'HIGHLIGHT_EVIDENCE'
      ? response.payload
      : payload;
  return validateLumiAction({ type: response.action, payload: internalPayload, authority: proposal ? 'suggestion-only' : 'presentation', requiresLearnerAcceptance: requires });
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
