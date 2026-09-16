export const RECOVERY_CONTEXT = Object.freeze({ ISSUED: 'issued', REISSUED: 'reissued', RESET: 'reset' });

export function createRecoveryPresentationState() {
  return Object.freeze({ code: null, context: null });
}

export function transitionRecoveryPresentation(state = createRecoveryPresentationState(), event = {}) {
  if (['SIGN_OUT', 'DISMISS', 'AUTH_INVALIDATED', 'LEAVE_CONTEXT'].includes(event.type)) return createRecoveryPresentationState();
  if (['ISSUED', 'REISSUED', 'RESET_COMPLETED'].includes(event.type) && typeof event.code === 'string' && event.code.trim()) {
    return Object.freeze({ code: event.code.trim(), context: event.type === 'ISSUED' ? RECOVERY_CONTEXT.ISSUED : event.type === 'REISSUED' ? RECOVERY_CONTEXT.REISSUED : RECOVERY_CONTEXT.RESET });
  }
  return state;
}
