import { LUMI_ACTION_TYPES } from './inquiryContracts.js';

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
