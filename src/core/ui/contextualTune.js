const IMPORTANCES = new Set(['primary', 'secondary', 'advanced']);
const ROLES = new Set(['experiment', 'inspection']);
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

export function validatePlaygroundControlPresentation(playground = {}) {
  const controls = Array.isArray(playground.controls) ? playground.controls : [];
  let primaryCount = 0;

  for (const control of controls) {
    if (control?.presentation === undefined) continue;
    const presentation = control.presentation;
    if (!presentation || typeof presentation !== 'object' || Array.isArray(presentation)) {
      throw new Error(`Invalid control presentation for ${control?.key ?? 'unknown control'}`);
    }
    if (!IMPORTANCES.has(presentation.importance)) {
      throw new Error(`Invalid control presentation importance for ${control?.key ?? 'unknown control'}`);
    }
    if (!Array.isArray(presentation.roles)
      || presentation.roles.length > 2
      || new Set(presentation.roles).size !== presentation.roles.length
      || presentation.roles.some((role) => !ROLES.has(role))) {
      throw new Error(`Invalid control presentation roles for ${control?.key ?? 'unknown control'}`);
    }
    if (Object.prototype.hasOwnProperty.call(presentation, 'explanationKey')
      && (typeof presentation.explanationKey !== 'string' || !presentation.explanationKey.trim())) {
      throw new Error(`Invalid control presentation explanationKey for ${control?.key ?? 'unknown control'}`);
    }
    if (presentation.importance === 'primary') primaryCount += 1;
  }

  if (primaryCount > 3) {
    throw new Error(`Playground ${playground.id ?? 'unknown'} declares more than three primary controls`);
  }
  return playground;
}

export function deriveChangedTuneControlKeys(diff = {}) {
  const factors = diff.factors ?? {};
  const changed = new Set();
  for (const factor of ['model', 'learning', 'evaluation']) {
    const left = factors[factor]?.left?.controls ?? {};
    const right = factors[factor]?.right?.controls ?? {};
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      if (Object.prototype.hasOwnProperty.call(left, key)
        && Object.prototype.hasOwnProperty.call(right, key)
        && stable(left[key]) !== stable(right[key])) changed.add(key);
    }
  }
  return changed;
}

export function deriveTuneControlState(control, diff = {}) {
  const factor = FACTOR_BY_DOMAIN[control?.domain];
  const comparisonActive = Boolean(diff && (diff.factors || diff.changed));
  const factorControls = factor ? diff.factors?.[factor] : null;
  const hasControlEvidence = Boolean(factorControls?.left?.controls && factorControls?.right?.controls
    && Object.prototype.hasOwnProperty.call(factorControls.left.controls, control?.key)
    && Object.prototype.hasOwnProperty.call(factorControls.right.controls, control?.key));
  const controlHeld = hasControlEvidence
    && stable(factorControls.left.controls[control.key]) === stable(factorControls.right.controls[control.key]);
  return {
    changed: comparisonActive && hasControlEvidence && !controlHeld,
    held: comparisonActive && controlHeld,
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
