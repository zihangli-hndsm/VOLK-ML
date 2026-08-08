import { getPrimitiveSchema } from '../visualization/schemas.js';
import { teachingError, validateTeachingPlan } from './teachingPlan.js';
import { scriptError } from '../visualization/scriptErrors.js';

// Deterministic Composer: TeachingPlan -> Visualization Script. Primitives and
// bindings are discovered from the PR D schemas (semanticSchema +
// compatibleBindings), never from model-specific rendering code.

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

function availablePrimitiveTypes(context) {
  const fields = context?.model?.semanticFields ?? [];
  const has = (field) => fields.includes(field);
  const types = [];
  if (has('scatterPoints') || has('displayPoints')) types.push('scatter');
  if (has('line') && has('ranges')) types.push('regression-line');
  if (has('bestFitLine')) types.push('reference-line');
  if (has('residualPoints')) types.push('residual-lines');
  if (has('training')) types.push('loss-curve');
  if (has('neighbors')) types.push('neighbor-links');
  if (has('voting')) types.push('vote-bars');
  if (has('displayQuery') || has('query')) types.push('query-point');
  if (has('decisionRegions')) types.push('decision-region');
  types.push('formula', 'metric-card', 'annotation');
  return types;
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
  if (type === 'decision-region' && bindingFor(context, type, 'cells')) {
    declaration.when = '$controls.showDecisionRegions';
  }
  return declaration;
}

function pickTypes(plan, available) {
  const side = ['formula', 'metric-card', 'annotation'];
  const base = ['scatter', 'regression-line', 'reference-line', 'residual-lines', 'loss-curve'];
  const knn = ['scatter', 'decision-region', 'neighbor-links', 'query-point', 'vote-bars'];
  const has = (type) => available.includes(type);
  let stage;
  if (plan.goal.type === 'compare-control' || plan.goal.type === 'diagnose') {
    stage = knn.filter(has);
  } else if (plan.goal.type === 'what-if') {
    stage = base.filter(has);
  } else {
    stage = [...new Set([...base, ...knn])].filter(has);
  }
  if (!stage.includes('scatter')) stage.unshift('scatter');
  const all = [...new Set([...stage, ...side])].filter(has);
  return { stage, side, all };
}

function setupControl(context, ...keys) {
  const controlKeys = new Set((context?.controlSchemas ?? []).map((schema) => schema.key));
  return Object.fromEntries(
    keys.filter((key) => controlKeys.has(key)).map((key) => [key, true]),
  );
}

function stepSequence(plan, context, stage, side) {
  const operations = context?.model?.operations ?? {};
  const tracePredict = operations.tracePredict ? 'tracePredict' : null;
  const traceFit = operations.traceFit ? 'traceFit' : null;
  const has = (type) => stage.includes(type) || side.includes(type);
  const steps = [];

  if (plan.goal.type === 'compare-control') {
    const { control, values } = plan.goal;
    steps.push({
      id: 'setup',
      setControl: setupControl(context, 'showNeighborOrder', 'showDecisionRegions'),
      durationMs: 300,
    });
    steps.push({ id: 'capture-baseline', capture: { id: 'baseline' }, durationMs: 100 });
    steps.push({ id: `set-${values[0]}`, setControl: { [control]: values[0] }, durationMs: 400 });
    if (tracePredict) steps.push({ id: `evaluate-${values[0]}`, invoke: { operation: tracePredict, args: {} }, durationMs: 400 });
    steps.push({ id: 'capture-left', capture: { id: String(values[0]) }, durationMs: 100 });
    steps.push({ id: 'restore-baseline', restoreCapture: { id: 'baseline' }, durationMs: 100 });
    steps.push({ id: `set-${values[1]}`, setControl: { [control]: values[1] }, durationMs: 400 });
    if (tracePredict) steps.push({ id: `evaluate-${values[1]}`, invoke: { operation: tracePredict, args: {} }, durationMs: 400 });
    steps.push({ id: 'capture-right', capture: { id: String(values[1]) }, durationMs: 100 });
    if (has('annotation')) {
      steps.push({
        id: 'summarize',
        annotate: {
          titleKey: 'playground.comparison.title',
          bodyKey: 'playground.comparison.body',
          params: { control, left: values[0], right: values[1] },
        },
        durationMs: 500,
      });
    }
    return steps;
  }

  if (plan.goal.type === 'what-if') {
    const { control, value } = plan.goal;
    steps.push({
      id: 'setup',
      setControl: setupControl(context, 'showResiduals', 'showBestFit'),
      durationMs: 300,
    });
    steps.push({ id: 'set-control', setControl: { [control]: value }, durationMs: 300 });
    if (traceFit) steps.push({ id: 'train', invoke: { operation: traceFit, args: {} }, durationMs: 500 });
    steps.push({ id: 'reveal-1', reveal: true, durationMs: 400 });
    steps.push({ id: 'reveal-2', reveal: true, durationMs: 400 });
    if (has('annotation')) {
      steps.push({
        id: 'summarize',
        annotate: {
          titleKey: 'playground.whatIf.title',
          bodyKey: 'playground.whatIf.body',
          params: { control, value },
        },
        durationMs: 500,
      });
    }
    return steps;
  }

  // explain-process
  steps.push({
    id: 'setup',
    setControl: setupControl(context, 'showNeighborOrder', 'showDecisionRegions', 'showResiduals'),
    durationMs: 300,
  });
  if (tracePredict) {
    steps.push({ id: 'run', invoke: { operation: tracePredict, args: {} }, durationMs: 400 });
    for (let index = 0; index < 3; index += 1) steps.push({ id: `reveal-${index + 1}`, reveal: true, durationMs: 400 });
  } else if (traceFit) {
    steps.push({ id: 'run', invoke: { operation: traceFit, args: {} }, durationMs: 500 });
    steps.push({ id: 'reveal-1', reveal: true, durationMs: 400 });
  }
  if (has('annotation')) {
    steps.push({
      id: 'summarize',
      annotate: { titleKey: 'playground.process.title', bodyKey: 'playground.process.body', params: {} },
      durationMs: 500,
    });
  }
  return steps;
}

export function composeScriptFromPlan({ plan, context }) {
  validateTeachingPlan(plan);
  const available = availablePrimitiveTypes(context);
  const { stage, side, all } = pickTypes(plan, available);
  const primitives = all.map((type) => makePrimitive(context, type));
  const steps = stepSequence(plan, context, stage, side);
  return {
    version: 1,
    id: `composed-${plan.goal.type}-${plan.goal.control ?? 'plan'}`,
    model: { adapter: context?.playground?.modelAdapter },
    data: { source: 'workspace-or-default' },
    controls: (context?.controlSchemas ?? []).map((schema) => schema.key),
    layout: { stage, side },
    primitives,
    steps,
  };
}
