// Model-independent playback scheduling. The React surface supplies the
// current snapshot and dispatch function; this module owns action selection,
// delay policy, cancellation and failure handoff so timers never retry a
// rejected semantic action.

export function getPlaybackAction(snapshot) {
  if (snapshot?.scriptState?.status === 'playing'
    && snapshot.scriptState.step < snapshot.scriptState.totalSteps) {
    return { type: 'SCRIPT_STEP' };
  }
  if (snapshot?.status === 'playing'
    && snapshot.timeline?.totalSteps > snapshot.timeline?.step) {
    return { type: 'STEP' };
  }
  return null;
}

export function getPlaybackDelay(snapshot, action, { reducedMotion = false } = {}) {
  if (reducedMotion) return 0;
  const stepDefinition = snapshot?.script?.steps?.[snapshot.scriptState?.step];
  const base = action?.type === 'SCRIPT_STEP' ? stepDefinition?.durationMs ?? 600 : 600;
  const speed = Math.max(0.25, Number(snapshot?.timeline?.speed) || 1);
  return base / speed;
}

export function createPlaybackScheduler({
  dispatch,
  onError,
  schedule = globalThis.setTimeout,
  cancelScheduled = globalThis.clearTimeout,
} = {}) {
  let timer = null;
  let generation = 0;

  const cancel = () => {
    generation += 1;
    if (timer !== null) cancelScheduled(timer);
    timer = null;
  };

  const scheduleSnapshot = (snapshot, options) => {
    cancel();
    const action = getPlaybackAction(snapshot);
    if (!action) return false;
    const scheduledGeneration = generation;
    timer = schedule(async () => {
      timer = null;
      if (scheduledGeneration !== generation) return;
      try {
        await dispatch(action);
      } catch (error) {
        if (scheduledGeneration === generation) onError?.({ action, error, snapshot });
      }
    }, getPlaybackDelay(snapshot, action, options));
    return true;
  };

  return { schedule: scheduleSnapshot, cancel };
}
