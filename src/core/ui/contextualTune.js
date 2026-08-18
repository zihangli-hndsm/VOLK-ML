const IMPORTANCES = new Set(['primary', 'secondary', 'advanced']);
const FACTOR_BY_DOMAIN = Object.freeze({ model: 'model', learning: 'learning', evaluation: 'evaluation', view: 'evaluation' });

const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

export function normalizeControlPresentation(control = {}) {
  const presentation = control.presentation && typeof control.presentation === 'object' ? control.presentation : {};
  const importance = IMPORTANCES.has(presentation.importance) ? presentation.importance : 'secondary';
  const roles = Array.isArray(presentation.roles)
    ? presentation.roles.filter((role) => role === 'experiment' || role === 'inspection').slice(0, 2)
    : [];
  return {
    importance,
    roles,
    ...(typeof presentation.explanationKey === 'string' && presentation.explanationKey ? { explanationKey: presentation.explanationKey } : {}),
  };
}

export function deriveChangedTuneControlKeys(diff = {}) {
  const factors = diff.factors ?? {};
  const changed = new Set();
  for (const factor of ['model', 'learning', 'evaluation']) {
    const left = factors[factor]?.left?.controls ?? {};
    const right = factors[factor]?.right?.controls ?? {};
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      if (stable(left[key]) !== stable(right[key])) changed.add(key);
    }
  }
  return changed;
}

export function deriveTuneControlState(control, diff = {}) {
  const factor = FACTOR_BY_DOMAIN[control?.domain];
  const changedKeys = deriveChangedTuneControlKeys(diff);
  const comparisonActive = Boolean(diff && (diff.factors || diff.changed));
  const factorControls = factor ? diff.factors?.[factor] : null;
  const hasControlEvidence = Boolean(factorControls?.left?.controls && factorControls?.right?.controls
    && Object.prototype.hasOwnProperty.call(factorControls.left.controls, control?.key)
    && Object.prototype.hasOwnProperty.call(factorControls.right.controls, control?.key));
  const controlHeld = hasControlEvidence
    && stable(factorControls.left.controls[control.key]) === stable(factorControls.right.controls[control.key]);
  return {
    changed: comparisonActive && changedKeys.has(control?.key),
    held: comparisonActive && Boolean(factor) && (Array.isArray(diff.unchanged) && diff.unchanged.includes(factor)
      || controlHeld),
  };
}

export function deriveTuneControlGroups(playground, snapshot = {}) {
  const controls = Array.isArray(playground?.controls) ? playground.controls : [];
  const primary = controls.filter((control) => normalizeControlPresentation(control).importance === 'primary');
  const more = controls.filter((control) => !primary.includes(control));
  const comparisonDiff = snapshot.experimentWorkspace?.comparison?.enabled
    ? snapshot.experimentWorkspace.comparison.diff
    : null;
  return {
    primary,
    more,
    changedKeys: deriveChangedTuneControlKeys(comparisonDiff ?? {}),
    comparisonDiff,
  };
}
