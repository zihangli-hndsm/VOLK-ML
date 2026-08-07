import { validateScript } from './scriptValidator.js';

// Public Script Runtime facade. All script execution (including baseline
// reset/seek/replay) lives in the unified playground runtime's SCRIPT_*
// actions; this facade is the single entry point for the UI, the Agent and
// contract tests so none of them special-case a model.
//
// Driver contract:
//   { dispatch(action), getState(), getAdapterId(), resetToBaseline(), subscribe(listener) }

export function createScriptRuntime(driver) {
  return {
    load(declaration) {
      validateScript(declaration);
      driver.dispatch({ type: 'SCRIPT_LOAD', script: structuredClone(declaration) });
      return this;
    },
    initialize() {
      driver.dispatch({ type: 'SCRIPT_RESET' });
      return this.snapshot();
    },
    step() {
      driver.dispatch({ type: 'SCRIPT_STEP' });
      return this.snapshot();
    },
    play() {
      driver.dispatch({ type: 'SCRIPT_PLAY' });
      return this;
    },
    pause() {
      driver.dispatch({ type: 'SCRIPT_PAUSE' });
      return this;
    },
    seek(target) {
      driver.dispatch({ type: 'SCRIPT_SEEK', step: Number(target) });
      return this.snapshot();
    },
    reset() {
      driver.dispatch({ type: 'SCRIPT_RESET' });
      return this.snapshot();
    },
    snapshot() {
      return driver.getState();
    },
    getStatus() {
      const state = driver.getState();
      return {
        status: state.scriptState?.status ?? 'idle',
        step: state.scriptState?.step ?? 0,
        totalSteps: state.scriptState?.totalSteps ?? 0,
        scriptId: state.script?.id ?? null,
      };
    },
    subscribe(listener) {
      return driver.subscribe ? driver.subscribe(listener) : () => {};
    },
  };
}
