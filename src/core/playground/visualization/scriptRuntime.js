import { validateScript } from './scriptValidator.js';

// Runs a Visualization Script on top of the unified playground runtime. The
// runtime is the only reducer: every script step is translated into the same
// JSON actions the UI and the Agent dispatch, so a script + seed + data
// replays to exactly the same trace.

const BINDING_TRANSFORMS = {
  mean: (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length),
  min: (values) => Math.min(...values),
  max: (values) => Math.max(...values),
  extent: (values) => [Math.min(...values), Math.max(...values)],
  formatNumber: (values) => values.map((value) => (Number.isInteger(value) ? String(value) : Number(value).toFixed(3))),
  take: (values, count) => values.slice(0, count),
  filterByEvent: (values, eventType) => values.filter((value) => value?.type === eventType),
};

function resolvePath(context, path) {
  return path.split('.').reduce((current, key) => (current == null ? undefined : current[key]), context);
}

export function resolveBinding(binding, context) {
  if (typeof binding !== 'string' || !binding.startsWith('$')) return binding;
  const match = /^([A-Za-z]+)\((\$[A-Za-z0-9_.]+)\)$/.exec(binding);
  if (match) {
    const [transform, rawPath] = [match[1], match[2]];
    const value = resolvePath(context, rawPath.slice(1));
    if (Array.isArray(value) && BINDING_TRANSFORMS[transform]) return BINDING_TRANSFORMS[transform](value);
    return value;
  }
  return resolvePath(context, binding.slice(1));
}

export function resolveArgs(args, context) {
  if (args == null) return {};
  return Object.fromEntries(Object.entries(args).map(([key, value]) => [
    key,
    typeof value === 'string' && value.startsWith('$') ? resolveBinding(value, context) : value,
  ]));
}

function stepToActions(step, snapshot, adapterId) {
  const actions = [];
  if (step.setControl) {
    for (const [key, value] of Object.entries(step.setControl)) {
      actions.push({ type: 'SET_CONTROL', key, value });
    }
  }
  if (step.invoke) {
    const operation = step.invoke.operation;
    const args = resolveArgs(step.invoke.args, snapshot);
    if (operation === 'traceFit' && adapterId === 'linear-regression') actions.push({ type: 'START_TRAINING' });
    if (operation === 'tracePredict' && adapterId === 'knn') actions.push({ type: 'START_NEIGHBOR_REVEAL' });
    if (operation === 'setBestFit') actions.push({ type: 'SET_BEST_FIT' });
    if (operation === 'moveQuery') actions.push({ type: 'MOVE_QUERY_POINT', x: args.x ?? null, y: args.y ?? null });
  }
  if (step.reveal) actions.push({ type: 'STEP' });
  if (step.show) actions.push({ type: 'SET_VISUAL', patch: { [step.show]: true } });
  if (step.hide) actions.push({ type: 'SET_VISUAL', patch: { [step.hide]: false } });
  if (step.highlight) actions.push({ type: 'SET_VISUAL', patch: { highlight: step.highlight } });
  if (step.annotate) actions.push({ type: 'SET_VISUAL', patch: { annotation: resolveArgs(step.annotate, snapshot) } });
  if (step.reset) actions.push({ type: 'RESET' });
  return actions;
}

// `driver` provides { dispatch(action), getState(), getPlaygroundId() }.
export function createScriptRuntime(driver) {
  let script = null;
  let stepIndex = 0;
  let status = 'idle';

  return {
    load(declaration) {
      validateScript(declaration);
      script = structuredClone(declaration);
      stepIndex = 0;
      status = 'idle';
      return this;
    },
    initialize() {
      stepIndex = 0;
      status = 'ready';
      return this.snapshot();
    },
    step() {
      if (!script || stepIndex >= script.steps.length) return this.snapshot();
      const stepDefinition = script.steps[stepIndex];
      const actions = stepToActions(stepDefinition, driver.getState(), driver.getPlaygroundId());
      actions.forEach((action) => driver.dispatch(action));
      stepIndex += 1;
      if (stepIndex >= script.steps.length) status = 'completed';
      return this.snapshot();
    },
    play() { status = 'playing'; return this; },
    pause() { status = 'paused'; return this; },
    seek(target) {
      this.reset();
      const count = Math.max(0, Math.min(target, script?.steps.length ?? 0));
      for (let index = 0; index < count; index += 1) this.step();
      return this.snapshot();
    },
    reset() {
      driver.dispatch({ type: 'RESET' });
      stepIndex = 0;
      status = 'ready';
      return this.snapshot();
    },
    snapshot() { return driver.getState(); },
    getStatus() { return { status, step: stepIndex, totalSteps: script?.steps.length ?? 0, scriptId: script?.id ?? null }; },
    subscribe(listener) { return driver.subscribe ? driver.subscribe(listener) : () => {}; },
  };
}
