import { dispatchPlaygroundAction, derivePlaygroundSnapshot } from '../../playgrounds/session.js';
import { findOperationByIntent, teachingError } from './teachingPlan.js';
import { getSupportedTeachingObjectives } from './teachingTaxonomy.js';
import { getPrimitiveSchema } from '../visualization/schemas.js';

// Goal fidelity evaluation (PR E.2).
//
// A generated Visualization Script can be technically valid yet fail the
// user's teaching goal. evaluateGoalFidelity() turns a normalized goal into
// explicit machine-readable requirements and checks them against the
// composed Script (static fidelity) and, where an outcome is required,
// against a deterministic replay (runtime fidelity).
//
// Requirements use semantic fields, operation intents, control assignments,
// capture states and trace events - never React component names or
// model-id switches.

function findControlSchema(context, key) {
  return (context?.controlSchemas ?? []).find((schema) => schema.key === key) ?? null;
}

// Normalizes the pedagogical objective for a plan. Explicit objectives win;
// otherwise the objective is derived from the goal family and the context's
// declared operations (predict -> explain_prediction, fit -> show_training,
// otherwise introduce).
export function resolveGoalObjective(plan, context) {
  const goal = plan?.goal;
  if (goal?.objective) return goal.objective;
  if (goal?.type === 'compare-control') return 'compare';
  if (goal?.type === 'what-if') return 'show_parameter_effect';
  if (goal?.type === 'explain-process') {
    if (findOperationByIntent(context, 'predict')) return 'explain_prediction';
    if (findOperationByIntent(context, 'fit')) return 'show_training';
    return 'introduce';
  }
  throw teachingError('TEACHING_GOAL_UNSUPPORTED', { reason: 'cannot derive an objective from this goal' });
}

// Evidence candidates per objective, filtered by the semantic fields the
// context actually advertises. Paths are dot-paths into the semantic
// snapshot ({ scene, metrics, observation, formula }).
const OBJECTIVE_EVIDENCE = {
  explain_prediction: ['displayQuery', 'query', 'neighbors', 'voting', 'metrics.predictedLabel'],
  show_training: ['training.lossHistory', 'training.parameterHistory', 'metrics', 'formula'],
  show_failure_case: ['training.lossHistory', 'training.parameterHistory', 'metrics', 'observation'],
  introduce: ['metrics', 'observation'],
};

function pickEvidence(context, candidates) {
  const fields = new Set(context?.model?.semanticFields ?? []);
  return candidates.filter((path) => fields.has(path.split('.')[0]));
}

function evidenceFromPlan(plan) {
  const seen = new Set();
  for (const phase of plan?.phases ?? []) {
    for (const field of phase.evidence ?? []) seen.add(field);
  }
  return [...seen];
}

// Completion leaf evidence: the specific semantic state that proves a branch
// produced a finished result (prediction label for predict, loss/parameter
// history for fit) rather than merely invoking an operation.
function completionEvidence(context, runObjective) {
  if (runObjective === 'predict') return pickEvidence(context, ['metrics.predictedLabel']);
  if (runObjective === 'fit') return pickEvidence(context, ['training.lossHistory', 'training.parameterHistory']);
  return [];
}

function buildBranchRequirements({ plan, context, captures, minBranches }) {
  const schema = findControlSchema(context, plan.goal.control);
  const runObjective = schema?.runObjective;
  const evidence = [...new Set([
    ...evidenceFromPlan(plan),
    ...completionEvidence(context, runObjective),
  ])];
  const runtimeTraces = runObjective === 'predict'
    ? ['prediction.emitted']
    : runObjective === 'fit'
      ? ['training.completed']
      : [];
  return {
    controls: [{ key: plan.goal.control, values: plan.goal.values ?? [plan.goal.value] }],
    operations: runObjective ? [{ intent: runObjective, minCount: minBranches }] : [],
    reveals: { minCount: runObjective ? minBranches : 0 },
    evidence,
    captures,
    runtimeTraces,
  };
}

// Builds the explicit Goal Requirement / Fidelity Contract for a plan.
export function buildGoalRequirements({ plan, context }) {
  const objective = resolveGoalObjective(plan, context);
  if (!getSupportedTeachingObjectives(context).includes(objective)) {
    throw teachingError('TEACHING_GOAL_UNSUPPORTED', { objective, reason: 'unsupported in context' });
  }
  if (objective === 'compare') {
    return buildBranchRequirements({ plan, context, captures: ['left', 'right'], minBranches: 2 });
  }
  if (objective === 'show_parameter_effect') {
    return buildBranchRequirements({ plan, context, captures: ['result'], minBranches: 1 });
  }
  if (objective === 'show_failure_case') {
    return {
      controls: [{ key: plan.goal.control, values: [plan.goal.value] }],
      operations: [{ intent: 'fit', minCount: 1 }],
      reveals: { minCount: 1 },
      evidence: pickEvidence(context, OBJECTIVE_EVIDENCE.show_failure_case),
      captures: ['result'],
      runtimeTraces: ['loss.measured'],
    };
  }
  if (objective === 'explain_prediction') {
    return {
      operations: [{ intent: 'predict', minCount: 1 }],
      reveals: { minCount: 1 },
      evidence: pickEvidence(context, OBJECTIVE_EVIDENCE.explain_prediction),
      captures: [],
      finalState: true,
      runtimeTraces: ['prediction.emitted'],
    };
  }
  if (objective === 'show_training') {
    return {
      operations: [{ intent: 'fit', minCount: 1 }],
      reveals: { minCount: 1 },
      evidence: pickEvidence(context, OBJECTIVE_EVIDENCE.show_training),
      captures: [],
      finalState: true,
      runtimeTraces: ['training.completed'],
    };
  }
  if (objective === 'introduce') {
    return {
      controls: [],
      operations: [],
      reveals: { minCount: 0 },
      evidence: pickEvidence(context, OBJECTIVE_EVIDENCE.introduce),
      captures: [],
      finalState: false,
      runtimeTraces: [],
    };
  }
  throw teachingError('TEACHING_GOAL_UNSUPPORTED', { objective });
}

function operationIntentOf(context, operationName) {
  return context?.model?.operations?.[operationName]?.intent ?? null;
}

// A primitive covers a semantic field when its schema declares a compatible
// binding for it. The Composer may pick one concrete binding per prop (e.g.
// reference-line binds $model.line), but the schema still advertises the
// alternative evidence field ($model.bestFitLine), so both are satisfiable
// semantic evidence for the goal.
function primitiveCoversField(primitive, first) {
  const schema = getPrimitiveSchema(primitive?.type);
  if (!schema) return false;
  return Object.values(schema.compatibleBindings ?? {}).flat().some((binding) => {
    if (binding.startsWith('$model.')) return binding.split('.')[1] === first;
    return binding === '$metrics' && first === 'metrics';
  });
}

function resolveEvidencePath(semantic, path) {
  const parts = path.split('.');
  const root = parts[0];
  let value = semantic?.[root];
  if (value === undefined && semantic?.scene) value = semantic.scene[root];
  for (const key of parts.slice(1)) value = value?.[key];
  return value;
}

function presentNonEmpty(value) {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

// Deterministically replays a script on a detached clone and returns the
// evidence the runtime fidelity checks need: capture snapshots, trace events
// and the final snapshot. The live session is never mutated.
export function replayScriptForFidelity({ script, session }) {
  let replay = structuredClone(session);
  replay = dispatchPlaygroundAction(replay, { type: 'SCRIPT_LOAD', script: structuredClone(script) });
  const total = replay.scriptState?.totalSteps ?? 0;
  for (let index = 0; index < total; index += 1) {
    replay = dispatchPlaygroundAction(replay, { type: 'SCRIPT_STEP' });
  }
  return {
    captures: replay.captures ?? {},
    traces: replay.traces ?? [],
    finalSnapshot: derivePlaygroundSnapshot(replay),
  };
}

function checkRuntimeEvidence(checks, missing, requirements, execution, semanticFor, label) {
  for (const path of requirements.evidence ?? []) {
    const value = resolveEvidencePath(semanticFor(path), path);
    const satisfied = presentNonEmpty(value);
    checks.push({ requirement: `runtimeEvidence:${label}:${path}`, satisfied, evidence: [value] });
    if (!satisfied) missing.push(`runtimeEvidence:${label}:${path}`);
  }
}

// Deterministic goal fidelity evaluation. `execution` (optional) comes from
// replayScriptForFidelity(); when present, required captures must exist and
// hold non-empty semantic evidence, and required trace events must have been
// produced. Static checks run against the Script declaration regardless.
export function evaluateGoalFidelity({ plan, script, context, execution }) {
  const requirements = buildGoalRequirements({ plan, context });
  const checks = [];
  const missing = [];
  const steps = script?.steps ?? [];
  const primitives = script?.primitives ?? [];

  // Static: required setControl assignments.
  const setControls = [];
  for (const step of steps) {
    if (step.setControl) {
      for (const [key, value] of Object.entries(step.setControl)) setControls.push({ key, value });
    }
  }
  for (const requirement of requirements.controls ?? []) {
    for (const value of requirement.values) {
      const satisfied = setControls.some((assignment) => (
        assignment.key === requirement.key && assignment.value === value
      ));
      checks.push({
        requirement: `control:${requirement.key}=${JSON.stringify(value)}`,
        satisfied,
        evidence: setControls,
      });
      if (!satisfied) missing.push(`control:${requirement.key}=${JSON.stringify(value)}`);
    }
  }

  // Static: required operation intents invoked (min count).
  const invokes = steps.filter((step) => step.invoke);
  for (const requirement of requirements.operations ?? []) {
    const matched = invokes.filter((step) => operationIntentOf(context, step.invoke.operation) === requirement.intent);
    const satisfied = matched.length >= requirement.minCount;
    checks.push({
      requirement: `operation:${requirement.intent}>=${requirement.minCount}`,
      satisfied,
      evidence: matched.map((step) => step.invoke.operation),
    });
    if (!satisfied) missing.push(`operation:${requirement.intent}>=${requirement.minCount}`);
  }

  // Static: required reveal playback compiled.
  const revealCount = steps.filter((step) => step.reveal).length;
  const minReveals = requirements.reveals?.minCount ?? 0;
  const revealsOk = revealCount >= minReveals;
  checks.push({ requirement: `reveals>=${minReveals}`, satisfied: revealsOk, evidence: [revealCount] });
  if (!revealsOk) missing.push(`reveals>=${minReveals}`);

  // Static: required captures exist.
  const captureIds = steps.filter((step) => step.capture).map((step) => step.capture.id);
  for (const captureId of requirements.captures ?? []) {
    const satisfied = captureIds.includes(captureId);
    checks.push({ requirement: `capture:${captureId}`, satisfied, evidence: captureIds });
    if (!satisfied) missing.push(`capture:${captureId}`);
  }

  // Static: required semantic evidence has a compatible primitive binding.
  for (const path of requirements.evidence ?? []) {
    const first = path.split('.')[0];
    const satisfied = primitives.some((primitive) => primitiveCoversField(primitive, first));
    checks.push({ requirement: `evidence:${path}`, satisfied, evidence: [] });
    if (!satisfied) missing.push(`evidence:${path}`);
  }

  // Runtime: completed outcomes, not just invoked operations.
  if (execution) {
    for (const captureId of requirements.captures ?? []) {
      const capture = execution.captures?.[captureId];
      const exists = Boolean(capture);
      checks.push({
        requirement: `runtimeCapture:${captureId}`,
        satisfied: exists,
        evidence: Object.keys(execution.captures ?? {}),
      });
      if (!exists) missing.push(`runtimeCapture:${captureId}`);
      if (exists) {
        checkRuntimeEvidence(checks, missing, requirements, execution, () => capture.semantic ?? {}, captureId);
      }
    }
    if (requirements.finalState) {
      const final = execution.finalSnapshot ?? {};
      checkRuntimeEvidence(checks, missing, requirements, execution, () => ({
        ...(final.scene ?? {}),
        metrics: final.metrics ?? {},
        observation: final.observation ?? null,
        formula: final.formula ?? null,
      }), 'final');
    }
    for (const event of requirements.runtimeTraces ?? []) {
      const present = (execution.traces ?? []).some((trace) => trace.type === event);
      checks.push({ requirement: `trace:${event}`, satisfied: present, evidence: [] });
      if (!present) missing.push(`trace:${event}`);
    }
  }

  return { valid: missing.length === 0, checks, missing };
}
