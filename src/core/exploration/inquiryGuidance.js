// Goal 5 optional inquiry guidance. This is deliberately a presentation
// policy over already-grounded inquiry candidates and suggestions. It never
// creates evidence, changes an Experiment, or authorizes execution.
import { normalizeAiConfig } from '../ai/aiSettings.js';
import { createProviderGateway } from '../ai/providerRegistry.js';

export const INQUIRY_GUIDANCE_VERSION = 1;
export const MAX_INQUIRY_GUIDANCE_HISTORY = 12;
export const MAX_INQUIRY_INTERRUPTS = 3;
export const INQUIRY_GUIDANCE_COOLDOWN_EVENTS = 3;

export const INQUIRY_GUIDANCE_POLICIES = Object.freeze({
  IGNORE: 'ignore',
  SURFACE_CONCEPT: 'surface-concept',
  SUGGEST_EXPERIMENT: 'suggest-experiment',
  SUGGEST_DEEPER_INSPECTION: 'suggest-deeper-inspection',
});

const POLICY_IDS = Object.freeze(Object.values(INQUIRY_GUIDANCE_POLICIES));
const MAX_HYPOTHESIS_LENGTH = 240;
const MAX_GUIDANCE_CANDIDATES = 4;
const MAX_GUIDANCE_SUGGESTIONS = 2;
const GUIDANCE_FIELDS = new Set(['policy', 'conceptId', 'suggestionId', 'depth', 'hypothesis']);

function safeString(value, max = 120) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text && text.length <= max ? text : null;
}

function safeIds(values, max) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => safeString(value))
    .filter(Boolean))].slice(0, max);
}

function normalizedEvents(semanticEvents) {
  const records = Array.isArray(semanticEvents) ? semanticEvents : semanticEvents?.events;
  return (records ?? []).map((event) => {
    const id = safeString(event?.id);
    const sequence = Number.isInteger(event?.sequence) && event.sequence > 0 ? event.sequence : null;
    return id && sequence ? { id, sequence, type: safeString(event?.type), reasonCode: safeString(event?.reasonCode) } : null;
  }).filter(Boolean).sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id));
}

function normalizedHistory(history) {
  return (Array.isArray(history) ? history : []).map((entry) => {
    const eventId = safeString(entry?.eventId);
    const sequence = Number.isInteger(entry?.sequence) && entry.sequence > 0 ? entry.sequence : null;
    const policy = POLICY_IDS.includes(entry?.policy) ? entry.policy : null;
    return eventId && sequence && policy ? { eventId, sequence, policy } : null;
  }).filter(Boolean).slice(-MAX_INQUIRY_GUIDANCE_HISTORY);
}

function candidateForEvent(inquiry, eventId) {
  const candidates = Array.isArray(inquiry?.candidates) ? inquiry.candidates : [];
  return candidates.map((candidate) => {
    const conceptId = safeString(candidate?.conceptId);
    const reasonCode = safeString(candidate?.reasonCode);
    const supportingEventIds = safeIds(candidate?.supportingEventIds, 6);
    return conceptId && reasonCode && candidate?.confidence === 'direct'
      ? { conceptId, reasonCode, supportingEventIds }
      : null;
  }).filter(Boolean)
    .filter((candidate) => candidate.supportingEventIds.includes(eventId))
    .slice(0, MAX_GUIDANCE_CANDIDATES);
}

function directSuggestions(suggestions, conceptIds) {
  return (Array.isArray(suggestions?.suggestions) ? suggestions.suggestions : []).map((suggestion) => {
    const id = safeString(suggestion?.id);
    const relatedConceptIds = safeIds(suggestion?.relatedConceptIds, 2);
    return id && relatedConceptIds.some((conceptId) => conceptIds.includes(conceptId))
      ? { id, relatedConceptIds, kind: safeString(suggestion?.kind), intervention: safeString(suggestion?.intervention?.factor) }
      : null;
  }).filter(Boolean).slice(0, MAX_GUIDANCE_SUGGESTIONS);
}

// A trigger exists only for a newly completed semantic event which directly
// supports a current deterministic candidate. This makes provider use opt-in
// and event-triggered, rather than a render-time polling loop.
export function deriveInquiryGuidanceTrigger({ inquiry, semanticEvents, suggestions, history = [] } = {}) {
  const events = normalizedEvents(semanticEvents);
  const latest = events.at(-1);
  if (!latest) return null;
  const previous = normalizedHistory(history);
  if (previous.some((entry) => entry.eventId === latest.id)) return null;
  const candidates = candidateForEvent(inquiry, latest.id);
  if (!candidates.length) return null;
  const interruptions = previous.filter((entry) => entry.policy !== INQUIRY_GUIDANCE_POLICIES.IGNORE);
  if (interruptions.length >= MAX_INQUIRY_INTERRUPTS) return null;
  const lastInterruption = interruptions.at(-1);
  if (lastInterruption && latest.sequence - lastInterruption.sequence < INQUIRY_GUIDANCE_COOLDOWN_EVENTS) return null;
  const conceptIds = candidates.map((candidate) => candidate.conceptId);
  return {
    version: INQUIRY_GUIDANCE_VERSION,
    eventId: latest.id,
    eventSequence: latest.sequence,
    eventType: latest.type,
    candidateConceptIds: conceptIds,
    candidates,
    suggestions: directSuggestions(suggestions, conceptIds),
  };
}

function allowedDepths(context) {
  return safeIds(context?.presentation?.availableDepths, 4);
}

// Deterministic fallback stays quiet unless there is an already-preflighted,
// directly related suggestion. It does not turn every concept candidate into
// an interruption because Goal 3 already owns the quiet concept-card surface.
export function deriveDeterministicInquiryGuidance({ trigger } = {}) {
  if (!trigger) return { version: INQUIRY_GUIDANCE_VERSION, policy: INQUIRY_GUIDANCE_POLICIES.IGNORE, source: 'deterministic' };
  const suggestion = trigger.suggestions?.[0];
  return suggestion
    ? {
      version: INQUIRY_GUIDANCE_VERSION,
      policy: INQUIRY_GUIDANCE_POLICIES.SUGGEST_EXPERIMENT,
      suggestionId: suggestion.id,
      conceptId: trigger.candidateConceptIds[0] ?? null,
      hypothesis: null,
      source: 'deterministic',
    }
    : { version: INQUIRY_GUIDANCE_VERSION, policy: INQUIRY_GUIDANCE_POLICIES.IGNORE, source: 'deterministic' };
}

export function inquiryGuidanceResponseSchema({ trigger, context } = {}) {
  const conceptIds = safeIds(trigger?.candidateConceptIds, MAX_GUIDANCE_CANDIDATES);
  const suggestionIds = safeIds(trigger?.suggestions?.map((suggestion) => suggestion.id), MAX_GUIDANCE_SUGGESTIONS);
  const depths = allowedDepths(context);
  const nullable = (schema) => ({ anyOf: [schema, { type: 'null' }] });
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      policy: { type: 'string', enum: POLICY_IDS },
      conceptId: nullable({ type: 'string', enum: conceptIds.length ? conceptIds : ['unavailable'] }),
      suggestionId: nullable({ type: 'string', enum: suggestionIds.length ? suggestionIds : ['unavailable'] }),
      depth: nullable({ type: 'string', enum: depths.length ? depths : ['unavailable'] }),
      hypothesis: nullable({ type: 'string', maxLength: MAX_HYPOTHESIS_LENGTH }),
    },
    required: ['policy', 'conceptId', 'suggestionId', 'depth', 'hypothesis'],
  };
}

export function validateInquiryGuidance(value, { trigger, context } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !POLICY_IDS.includes(value.policy)) return null;
  if (Object.keys(value).some((key) => !GUIDANCE_FIELDS.has(key))
    || [...GUIDANCE_FIELDS].some((key) => !Object.hasOwn(value, key))) return null;
  const conceptIds = safeIds(trigger?.candidateConceptIds, MAX_GUIDANCE_CANDIDATES);
  const suggestionIds = safeIds(trigger?.suggestions?.map((suggestion) => suggestion.id), MAX_GUIDANCE_SUGGESTIONS);
  const depths = allowedDepths(context);
  const conceptId = value.conceptId === null ? null : safeString(value.conceptId);
  const suggestionId = value.suggestionId === null ? null : safeString(value.suggestionId);
  const depth = value.depth === null ? null : safeString(value.depth);
  const hypothesis = value.hypothesis === null ? null : safeString(value.hypothesis, MAX_HYPOTHESIS_LENGTH);
  if (conceptId && !conceptIds.includes(conceptId)) return null;
  if (suggestionId && !suggestionIds.includes(suggestionId)) return null;
  if (depth && !depths.includes(depth)) return null;
  if (value.policy === INQUIRY_GUIDANCE_POLICIES.IGNORE && (conceptId || suggestionId || depth || hypothesis)) return null;
  if (value.policy === INQUIRY_GUIDANCE_POLICIES.SURFACE_CONCEPT && !conceptId) return null;
  if (value.policy === INQUIRY_GUIDANCE_POLICIES.SUGGEST_EXPERIMENT && !suggestionId) return null;
  if (value.policy === INQUIRY_GUIDANCE_POLICIES.SUGGEST_DEEPER_INSPECTION && !depth) return null;
  return {
    version: INQUIRY_GUIDANCE_VERSION,
    policy: value.policy,
    conceptId,
    suggestionId,
    depth,
    hypothesis,
  };
}

export function nextInquiryGuidanceHistory(history, { trigger, guidance } = {}) {
  if (!trigger || !guidance || !POLICY_IDS.includes(guidance.policy)) return normalizedHistory(history);
  return [...normalizedHistory(history), {
    eventId: trigger.eventId,
    sequence: trigger.eventSequence,
    policy: guidance.policy,
  }].slice(-MAX_INQUIRY_GUIDANCE_HISTORY);
}

export function projectInquiryGuidanceAiContext({ trigger, context } = {}) {
  return {
    version: INQUIRY_GUIDANCE_VERSION,
    trigger: {
      eventType: safeString(trigger?.eventType) ?? null,
      candidateConceptIds: safeIds(trigger?.candidateConceptIds, MAX_GUIDANCE_CANDIDATES),
      candidates: (trigger?.candidates ?? []).map((candidate) => ({ conceptId: candidate.conceptId, reasonCode: candidate.reasonCode })),
    },
    suggestions: (trigger?.suggestions ?? []).map((suggestion) => ({
      id: suggestion.id,
      kind: suggestion.kind,
      intervention: suggestion.intervention,
      relatedConceptIds: suggestion.relatedConceptIds,
    })),
    task: safeString(context?.data?.task ?? context?.playground?.task),
    modelKind: safeString(context?.playground?.modelAdapter ?? context?.playground?.modelAdapterId),
    availableDepths: allowedDepths(context),
    inquiryStage: safeString(context?.exploration?.learnerInquiry?.inquiryStage),
  };
}

function parseJsonObject(text) {
  try {
    const parsed = JSON.parse(String(text ?? '').trim());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function promptFor({ trigger, context }) {
  return [
    'Choose one quiet VOLK-ML inquiry guidance policy for a newly completed semantic event.',
    'Return JSON only. You may select only the supplied direct candidates, validated suggestions, or conceptual depths.',
    'The supplied concepts, suggestions, and runtime facts are authoritative deterministic context. Never invent metrics, observations, changed factors, causal claims, runtime operations, or an execution result.',
    'Do not authorize, perform, or describe a mutation. Suggestions remain explicit learner choices and run through existing validation.',
    'Use ignore by default. Surface guidance only when the supplied opportunity has clear value. A hypothesis is optional and must be framed as a possible idea to test, not a fact or causal conclusion.',
    `Bounded semantic context: ${JSON.stringify(projectInquiryGuidanceAiContext({ trigger, context }))}`,
  ].join('\n\n');
}

// Provider failure and malformed/provider-untrusted output both return the
// deterministic policy. The provider is therefore an optional phrasing and
// ranking layer, never an inquiry-state authority.
export function createInquiryGuidanceAiInterpreter({ gateway, fetchImpl = globalThis.fetch } = {}) {
  const providerGateway = gateway ?? createProviderGateway({ fetchImpl });
  return Object.freeze({
    async interpret({ trigger, context, config, providerId = 'openai-compatible', apiKey, model, endpoint }) {
      const fallback = deriveDeterministicInquiryGuidance({ trigger, context });
      const resolvedConfig = normalizeAiConfig(config ?? { protocol: providerId, apiKey, model, endpoint });
      if (!trigger || !resolvedConfig?.apiKey.trim()) return fallback;
      try {
        const response = await providerGateway.complete({
          config: resolvedConfig,
          system: 'You are VOLK-ML\'s optional inquiry guidance interpreter. Deterministic evidence and validation remain authoritative.',
          messages: [{ role: 'user', content: promptFor({ trigger, context }) }],
          responseMode: 'json',
          responseSchema: { name: 'volk_ml_inquiry_guidance', schema: inquiryGuidanceResponseSchema({ trigger, context }) },
        });
        const guidance = validateInquiryGuidance(parseJsonObject(response.text), { trigger, context });
        return guidance ? { ...guidance, source: 'ai', providerId: response.protocol } : fallback;
      } catch {
        return fallback;
      }
    },
  });
}
