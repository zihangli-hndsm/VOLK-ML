import { deriveTuneControlState, normalizeControlPresentation } from './contextualTune.js';

function eligibleControls(playground) {
  return (playground?.controls ?? []).filter((control) => {
    const presentation = normalizeControlPresentation(control);
    return presentation.quickControl === true && presentation.roles.includes('experiment');
  });
}

function scenarioControlKeys(snapshot) {
  const scenario = snapshot?.scenario;
  const changeKeys = (scenario?.change ?? [])
    .filter((change) => change?.operation === 'SET_CONTROL' || change?.type === 'SET_CONTROL')
    .map((change) => change.parameters?.key ?? change.key)
    .filter((key) => typeof key === 'string');
  return [
    snapshot?.experiment?.activeControlKey,
    snapshot?.experimentWorkspace?.activeControlKey,
    scenario?.quickControlKey,
    scenario?.controlKey,
    scenario?.variableKey,
    scenario?.variable?.key,
    ...changeKeys,
  ].filter((key) => typeof key === 'string');
}

function isWorldOnlyScenario(snapshot) {
  const scenario = snapshot?.scenario;
  const goal = scenario?.pedagogicalDesign?.goal ?? scenario?.interpretation?.design?.goal;
  const changes = scenario?.change ?? [];
  const hasControlChange = changes.some((change) => change?.operation === 'SET_CONTROL' || change?.type === 'SET_CONTROL');
  return Boolean(goal && !hasControlChange);
}

export function derivePlayQuickControl(playground, snapshot = {}) {
  const candidates = eligibleControls(playground);
  if (candidates.length === 0) return null;

  // A current World-only pedagogical experiment owns the learner's attention.
  // Do not let a stale model comparison or descriptor default leak into Play.
  if (isWorldOnlyScenario(snapshot)) return null;

  const byKey = new Map(candidates.map((control) => [control.key, control]));
  const contextControl = scenarioControlKeys(snapshot).map((key) => byKey.get(key)).find(Boolean);
  if (contextControl) return contextControl;

  const comparison = snapshot.experimentWorkspace?.comparison;
  const diff = comparison?.enabled ? comparison.diff : null;
  if (diff) {
    const changed = candidates.filter((control) => deriveTuneControlState(control, diff).changed);
    if (changed.length === 1) return changed[0];
    if (changed.length > 1) return null;
  }

  const defaults = candidates.filter((control) => normalizeControlPresentation(control).quickControlDefault === true);
  return defaults.length === 1 ? defaults[0] : null;
}
