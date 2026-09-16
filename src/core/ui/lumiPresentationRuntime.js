// Presentation-only LUMI lifecycle. It never dispatches runtime actions or
// changes World, Experiment, Evidence, learner progress, or course stage.
export const LUMI_PRESENTATION_STATES = Object.freeze({ AMBIENT: 'AMBIENT', THINK: 'THINK', ILLUMINATE: 'ILLUMINATE', GUIDE: 'GUIDE' });
export const LUMI_REQUEST_SOURCES = Object.freeze({ ASK: 'ask', TEACHING_DIALOGUE: 'teaching-dialogue' });
export const LUMI_FEEDBACK_DURATION_MS = 1100;
export const LUMI_REDUCED_FEEDBACK_DURATION_MS = 220;
const MAX_ID = 120;
const bounded = (value) => typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_ID) : null;

export function createLumiPresentationState({ sessionId = 'session', contextId = 'explore' } = {}) {
  return Object.freeze({ version: 1, sessionId: bounded(sessionId) ?? 'session', contextId: bounded(contextId) ?? 'explore', revision: 0, activeRequest: null, feedbackEvent: null, consumedFeedbackIds: [] });
}

export function beginLumiRequest(state = createLumiPresentationState(), { source, requestId, sessionId = state.sessionId, contextId = state.contextId } = {}) {
  const id = bounded(requestId);
  if (!id || !Object.values(LUMI_REQUEST_SOURCES).includes(source)) return state;
  return Object.freeze({ ...state, sessionId: bounded(sessionId) ?? state.sessionId, contextId: bounded(contextId) ?? state.contextId, revision: state.revision + 1, activeRequest: Object.freeze({ source, requestId: id, revision: state.revision + 1 }) });
}

export function finishLumiRequest(state, { requestId, status = 'success', feedbackEvent = null } = {}) {
  if (!state?.activeRequest || state.activeRequest.requestId !== requestId) return state;
  // Only deterministic concept events may enter the ILLUMINATE state. A
  // completed Ask/teaching request is a neutral response and must return to
  // the ambient/guide state instead of pretending that a concept was found.
  const conceptFeedback = feedbackEvent?.kind === 'concept'
    && feedbackEvent?.source === 'runtime'
    && typeof feedbackEvent?.evidenceId === 'string'
    && feedbackEvent.evidenceId.trim();
  const nextFeedback = status === 'success'
    ? (conceptFeedback && feedbackEvent?.id ? Object.freeze({ ...feedbackEvent, id: bounded(feedbackEvent.id), consumed: false }) : null)
    : null;
  return Object.freeze({ ...state, revision: state.revision + 1, activeRequest: null, feedbackEvent: nextFeedback });
}

export function cancelLumiRequest(state, requestId = null) {
  if (!state?.activeRequest || (requestId && state.activeRequest.requestId !== requestId)) return state;
  return Object.freeze({ ...state, revision: state.revision + 1, activeRequest: null, feedbackEvent: null });
}

export function consumeLumiFeedback(state, eventId) {
  const id = bounded(eventId);
  if (!id || state?.feedbackEvent?.id !== id || state.feedbackEvent.consumed) return state;
  return Object.freeze({ ...state, feedbackEvent: Object.freeze({ ...state.feedbackEvent, consumed: true }), consumedFeedbackIds: [...(state.consumedFeedbackIds ?? []), id].slice(-24) });
}

export function surfaceLumiFeedback(state, feedbackEvent) {
  const id = bounded(feedbackEvent?.id);
  if (feedbackEvent?.kind === 'concept' && (feedbackEvent.source !== 'runtime' || !bounded(feedbackEvent.evidenceId))) return state;
  if (!id || state?.feedbackEvent?.id === id || (state?.consumedFeedbackIds ?? []).includes(id)) return state;
  return Object.freeze({ ...state, revision: state.revision + 1, feedbackEvent: Object.freeze({ ...feedbackEvent, id, consumed: false }) });
}

export function resetLumiPresentation(state = createLumiPresentationState()) {
  return createLumiPresentationState({ sessionId: state.sessionId, contextId: state.contextId });
}

export function deriveLumiPresentationState({ presentation = null, guideAvailable = false, illuminateEvent = null } = {}) {
  if (presentation?.activeRequest) return LUMI_PRESENTATION_STATES.THINK;
  if (presentation?.feedbackEvent && !presentation.feedbackEvent.consumed) return LUMI_PRESENTATION_STATES.ILLUMINATE;
  if (illuminateEvent?.id && !(presentation?.consumedFeedbackIds ?? []).includes(illuminateEvent.id)) return LUMI_PRESENTATION_STATES.ILLUMINATE;
  if (guideAvailable) return LUMI_PRESENTATION_STATES.GUIDE;
  return LUMI_PRESENTATION_STATES.AMBIENT;
}

export function createLumiFeedbackEvent({ id, kind = 'guidance', source = 'local', target = null } = {}) {
  const normalizedId = bounded(id);
  return normalizedId ? Object.freeze({ id: normalizedId, kind: bounded(kind) ?? 'guidance', source: bounded(source) ?? 'local', target: bounded(target), consumed: false }) : null;
}

export function lumiFeedbackDuration({ reducedMotion = false } = {}) {
  return reducedMotion ? LUMI_REDUCED_FEEDBACK_DURATION_MS : LUMI_FEEDBACK_DURATION_MS;
}
