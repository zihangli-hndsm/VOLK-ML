import { validateScript } from '../visualization/scriptValidator.js';
import { createBindingContext, resolveValue } from '../visualization/bindings.js';
import { getModelAdapter } from '../model/modelRegistry.js';
import { dispatchPlaygroundAction } from '../../playgrounds/session.js';

// Dry run for a Visualization Script before it is accepted by the Agent:
//
//   1. structural validation (scriptValidator);
//   2. model compatibility check against the current session;
//   3. binding resolution against the current semantic snapshot;
//   4. real replay on a detached session clone (every step must produce a
//      valid snapshot without throwing);
//   5. cost estimates (steps, primitive updates, decision grid).
//
// The live session is never mutated. Any step that throws makes the dry run
// invalid, so an Agent can never execute a script that only looks valid.

function collectBindings(value, bindings) {
  if (typeof value === 'string' && (value.startsWith('$') || /^[A-Za-z]+\(\$[A-Za-z0-9_.]+\)$/.test(value))) {
    bindings.push(value);
  }
  if (Array.isArray(value)) value.forEach((item) => collectBindings(item, bindings));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectBindings(item, bindings));
}

export function dryRunScript({ script, session }) {
  const warnings = [];
  try {
    validateScript(script);
  } catch (error) {
    return { valid: false, code: error.code ?? 'INVALID_SCRIPT', details: error.details ?? {}, warnings };
  }

  const adapter = getModelAdapter(script.model.adapter);
  if (session && script.model.adapter !== session.adapterId) {
    return {
      valid: false,
      code: 'SCRIPT_MODEL_MISMATCH',
      details: { expected: session.adapterId, received: script.model.adapter },
      warnings,
    };
  }

  // Bindings: try to resolve every declared binding against the current
  // snapshot; unresolved bindings are warnings, not hard failures.
  if (session) {
    const snapshot = deriveSnapshotForBindings(session);
    const context = createBindingContext({
      model: snapshot.scene,
      data: snapshot.dataState ?? {},
      controls: snapshot.controls,
      trace: snapshot.traces ?? [],
      metrics: snapshot.metrics ?? {},
    });
    const bindings = [];
    collectBindings(script, bindings);
    for (const binding of bindings) {
      const resolved = resolveValue(binding, context);
      if (resolved === undefined) warnings.push(`binding ${binding} resolved to undefined`);
    }
  }

  // Real replay on a detached clone.
  let replaySession = session ? structuredClone(session) : null;
  if (replaySession) {
    try {
      replaySession = dispatchPlaygroundAction(replaySession, { type: 'SCRIPT_LOAD', script: structuredClone(script) });
      const total = script.steps.length;
      for (let index = 0; index < total; index += 1) {
        replaySession = dispatchPlaygroundAction(replaySession, { type: 'SCRIPT_STEP' });
      }
    } catch (error) {
      return {
        valid: false,
        code: error.code ?? 'SCRIPT_TOO_COMPLEX',
        details: error.details ?? { message: error.message },
        warnings,
      };
    }
  }

  const estimatedSteps = script.steps.length;
  const estimatedPrimitiveUpdates = script.steps.reduce((sum, step) => (
    sum + Object.keys(step).filter((key) => (
      ['setControl', 'invoke', 'show', 'hide', 'highlight', 'reveal', 'annotate', 'reset'].includes(key)
    )).length
  ), 0);
  const decisionGridCost = script.primitives
    .filter((primitive) => primitive.type === 'decision-region')
    .reduce((sum, primitive) => {
      const resolution = primitive.props?.resolution ?? 48;
      return sum + resolution * resolution;
    }, 0);
  return {
    valid: true,
    estimatedSteps,
    estimatedPrimitiveUpdates,
    decisionGridCost,
    warnings,
  };
}

function deriveSnapshotForBindings(session) {
  // The session is JSON-safe; build a lightweight snapshot without touching
  // the live runtime to keep the dry run side-effect free.
  const adapter = getModelAdapter(session.adapterId);
  const derived = adapter.deriveScene(session.modelState, { controls: session.controls, source: session.sourceData });
  return {
    scene: { ...derived.scene, metrics: derived.metrics, formula: derived.formula, observation: derived.observation },
    controls: session.controls,
    dataState: session.dataState,
    traces: session.traces,
    metrics: derived.metrics,
  };
}
