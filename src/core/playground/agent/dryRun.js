import { validateScript } from '../visualization/scriptValidator.js';
import { createBindingContext, resolveValue } from '../visualization/bindings.js';
import { getPrimitiveSchema, validatePrimitiveContract } from '../visualization/schemas.js';
import { materializePrimitives } from '../visualization/primitiveMaterializer.js';
import { getModelAdapter } from '../model/modelRegistry.js';
import { dispatchPlaygroundAction, derivePlaygroundSnapshot } from '../../playgrounds/session.js';
import { scriptError } from '../visualization/scriptErrors.js';
import { RESOURCE_LIMITS } from '../visualization/scriptValidator.js';

// Strict dry run for a Visualization Script before it is accepted:
//
//   1. structural validation;
//   2. model compatibility against the current session;
//   3. binding resolution: required primitive props must resolve (undefined
//      is SCRIPT_BINDING_UNRESOLVED, not a warning);
//   4. real replay on a detached session clone where every step is followed
//      by derive -> materialize -> primitive contract validation;
//   5. resource estimates based on resolved props.
//
// The live session is never mutated.

function collectBindings(value, bindings) {
  if (typeof value === 'string' && (value.startsWith('$') || /^[A-Za-z]+\(\$[A-Za-z0-9_.]+\)$/.test(value))) {
    bindings.push(value);
  }
  if (Array.isArray(value)) value.forEach((item) => collectBindings(item, bindings));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectBindings(item, bindings));
}

function buildModelContext(snapshot) {
  return {
    ...snapshot.scene,
    metrics: snapshot.metrics ?? {},
    formula: snapshot.formula ?? null,
    observation: snapshot.observation ?? null,
  };
}

function checkPrimitiveBindings(script, context, warnings) {
  const seen = new Set();
  for (const primitive of script.primitives) {
    const schema = getPrimitiveSchema(primitive.type);
    if (!schema) continue;
    for (const [prop, propSchema] of Object.entries(schema.props)) {
      const raw = primitive.props?.[prop];
      if (typeof raw !== 'string' || !raw.startsWith('$')) continue;
      if (resolveValue(raw, context) !== undefined) continue;
      if (propSchema.required) {
        throw scriptError('SCRIPT_BINDING_UNRESOLVED', { primitiveId: primitive.id, type: primitive.type, prop, binding: raw });
      }
      const key = `${primitive.id}.${prop}`;
      if (!seen.has(key)) {
        seen.add(key);
        warnings.push(`optional binding ${raw} for ${primitive.id}.${prop} resolved to undefined`);
      }
    }
  }
}

function materializeAndValidate(snapshot, script) {
  const primitives = materializePrimitives({
    script,
    semanticState: buildModelContext(snapshot),
    traces: snapshot.traces ?? [],
    controls: snapshot.controls ?? {},
    metrics: snapshot.metrics ?? {},
    visualState: snapshot.visualState ?? {},
    dataState: snapshot.dataState ?? {},
  });
  for (const primitive of primitives) {
    const result = validatePrimitiveContract(primitive);
    if (!result.valid) throw scriptError(result.code, result.details);
  }
  return primitives;
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

  let replaySession = session ? structuredClone(session) : null;
  if (replaySession) {
    try {
      replaySession = dispatchPlaygroundAction(replaySession, { type: 'SCRIPT_LOAD', script: structuredClone(script) });
      // Required binding resolution against the state right after load.
      const initialSnapshot = derivePlaygroundSnapshot(replaySession);
      const initialContext = createBindingContext({
        model: buildModelContext(initialSnapshot),
        data: initialSnapshot.dataState ?? {},
        controls: initialSnapshot.controls,
        trace: initialSnapshot.traces ?? [],
        metrics: initialSnapshot.metrics ?? {},
      });
      checkPrimitiveBindings(script, initialContext, warnings);
      materializeAndValidate(initialSnapshot, script);

      const total = script.steps.length;
      for (let index = 0; index < total; index += 1) {
        replaySession = dispatchPlaygroundAction(replaySession, { type: 'SCRIPT_STEP' });
        const stepSnapshot = derivePlaygroundSnapshot(replaySession);
        materializeAndValidate(stepSnapshot, script);
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

  // Estimates from resolved props.
  const estimatedSteps = script.steps.length;
  const estimatedPrimitiveUpdates = script.steps.reduce((sum, step) => (
    sum + Object.keys(step).filter((key) => (
      ['setControl', 'invoke', 'show', 'hide', 'highlight', 'reveal', 'annotate', 'reset'].includes(key)
    )).length
  ), 0);
  let decisionGridCost = 0;
  let decisionGridCells = 0;
  if (replaySession) {
    const snapshot = derivePlaygroundSnapshot(replaySession);
    const context = createBindingContext({
      model: buildModelContext(snapshot),
      data: snapshot.dataState ?? {},
      controls: snapshot.controls,
      trace: snapshot.traces ?? [],
      metrics: snapshot.metrics ?? {},
    });
    for (const primitive of script.primitives) {
      if (primitive.type !== 'decision-region') continue;
      const resolution = Number(resolveValue(primitive.props?.resolution ?? 48, context)) || 48;
      if (resolution > RESOURCE_LIMITS.maxDecisionResolution) {
        return {
          valid: false,
          code: 'SCRIPT_TOO_COMPLEX',
          details: { reason: 'decision resolution', resolution, max: RESOURCE_LIMITS.maxDecisionResolution },
          warnings,
        };
      }
      decisionGridCells += resolution * resolution;
    }
  }
  decisionGridCost = decisionGridCells;
  const finalSnapshot = replaySession ? derivePlaygroundSnapshot(replaySession) : null;
  const scatterPoints = finalSnapshot?.primitives?.find((primitive) => primitive.type === 'scatter')?.props?.points ?? [];
  const pointCount = Array.isArray(scatterPoints) ? scatterPoints.length : 0;
  return {
    valid: true,
    estimatedSteps,
    estimatedPrimitiveUpdates,
    decisionGridCost,
    stepCount: estimatedSteps,
    primitiveCount: script.primitives.length,
    decisionGridCells,
    pointCount,
    traceEvents: finalSnapshot?.traces?.length ?? 0,
    warnings,
  };
}
