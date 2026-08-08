import { getPrimitiveSchema } from '../visualization/schemas.js';
import { findOperationByIntent, teachingError, validatePlanAgainstContext } from './teachingPlan.js';

// Deterministic Composer (PR E.1.1): TeachingPlan -> Visualization Script.
// The Composer iterates/compiles plan.phases; it never regenerates the
// teaching sequence from plan.goal.type. Primitive selection, binding and
// placement all come from the primitive schemas (compatibleBindings +
// placement + whenControl), and run operations are looked up by the
// declarative `intent` on context.model.operations. There is no
// model-specific rendering code and no hardcoded operation/control names.

function bindingFor(context, type, prop) {
  const schema = getPrimitiveSchema(type);
  if (!schema) return null;
  const candidates = schema.compatibleBindings?.[prop] ?? [];
  const semanticFields = context?.model?.semanticFields ?? [];
  const controlKeys = (context?.controlSchemas ?? []).map((item) => item.key);
  for (const binding of candidates) {
    if (binding.startsWith('$model.')) {
      const first = binding.replace('$model.', '').split('.')[0];
      if (semanticFields.includes(first)) return binding;
    } else if (binding.startsWith('$controls.')) {
      if (controlKeys.includes(binding.replace('$controls.', ''))) return binding;
    } else if (binding.startsWith('$metrics')) {
      return binding;
    }
  }
  return null;
}

// A primitive is materializable in this context when every required prop has
// a compatible binding that the schema/context can satisfy.
function primitiveAvailable(context, type) {
  const schema = getPrimitiveSchema(type);
  if (!schema) return false;
  return Object.entries(schema.props).every(
    ([prop, propSchema]) => !propSchema.required || Boolean(bindingFor(context, type, prop)),
  );
}

function makePrimitive(context, type) {
  const schema = getPrimitiveSchema(type);
  const props = {};
  for (const [prop, propSchema] of Object.entries(schema.props)) {
    const binding = bindingFor(context, type, prop);
    if (binding) props[prop] = binding;
    else if (propSchema.required) {
      throw teachingError('TEACHING_PLAN_INVALID', { reason: `no compatible binding for ${type}.${prop}` });
    }
  }
  const declaration = { id: type, type, props };
  if (schema.whenControl && (context.controlSchemas ?? []).some((item) => item.key === schema.whenControl)) {
    declaration.when = `$controls.${schema.whenControl}`;
  }
  return declaration;
}

function compilePhases(plan, context) {
  const steps = [];
  for (const phase of plan.phases) {
    if (phase.kind === 'observe') {
      steps.push({ id: phase.id, wait: true, durationMs: 300 });
    } else if (phase.kind === 'set-control') {
      steps.push({ id: phase.id, setControl: { [phase.control]: phase.value }, durationMs: 400 });
    } else if (phase.kind === 'run') {
      const operation = findOperationByIntent(context, phase.objective);
      if (operation) steps.push({ id: phase.id, invoke: { operation, args: {} }, durationMs: 500 });
    } else if (phase.kind === 'reveal') {
      for (let index = 0; index < phase.count; index += 1) {
        steps.push({ id: `${phase.id}-${index + 1}`, reveal: true, durationMs: 350 });
      }
    } else if (phase.kind === 'capture') {
      steps.push({ id: phase.id, capture: { id: phase.captureId }, durationMs: 100 });
    } else if (phase.kind === 'restore') {
      steps.push({ id: phase.id, restoreCapture: { id: phase.captureId }, durationMs: 100 });
    } else if (phase.kind === 'summarize') {
      steps.push({
        id: phase.id,
        annotate: {
          titleKey: phase.titleKey,
          bodyKey: phase.bodyKey,
          params: phase.params ?? {},
        },
        durationMs: 500,
      });
    }
  }
  return steps;
}

export function composeScriptFromPlan({ plan, context }) {
  // A plan must belong to this playground and reference only controls /
  // semantic fields / run objectives that still exist here.
  validatePlanAgainstContext(plan, context);

  const available = (context?.primitives ?? [])
    .map((schema) => schema.type)
    .filter((type) => primitiveAvailable(context, type));
  const stage = available.filter((type) => getPrimitiveSchema(type)?.placement === 'stage');
  const side = available.filter((type) => getPrimitiveSchema(type)?.placement === 'side');
  const primitives = [...stage, ...side].map((type) => makePrimitive(context, type));

  return {
    version: 1,
    id: `composed-${plan.id}`,
    model: { adapter: context?.playground?.modelAdapter },
    data: { source: 'workspace-or-default' },
    controls: (context?.controlSchemas ?? []).map((schema) => schema.key),
    layout: { stage, side },
    primitives,
    steps: compilePhases(plan, context),
  };
}
