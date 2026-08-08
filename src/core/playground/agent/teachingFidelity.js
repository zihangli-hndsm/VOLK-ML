import { dispatchPlaygroundAction, derivePlaygroundSnapshot } from '../../playgrounds/session.js';
import { findOperationByIntent, teachingError } from './teachingPlan.js';
import { getSupportedTeachingObjectives } from './teachingTaxonomy.js';

// Goal fidelity evaluation (PR E.2 / E.2.1).
//
// A generated Visualization Script can be technically valid yet fail the
// user's teaching goal. evaluateGoalFidelity() turns a normalized goal into
// explicit machine-readable requirements and checks them against the
// composed Script and a deterministic replay.
//
// Requirements use three explicit evidence classes (PR E.2.1):
//   visualEvidence  - the Script declaration actually binds this semantic
//                     path through a concrete primitive.props binding
//   runtimeEvidence - the replayed semantic state actually contains the
//                     result (checked on required captures / final state)
//   traceEvidence   - the required semantic event actually occurred, with
//                     optional payload predicates ({ trace, where })
// Requirements come from the model's declarative teachingCapabilities for
// explain_prediction / show_training / show_failure_case, and from generic
// structural rules for compare / show_parameter_effect / introduce. There
// are no model-id switches.

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

function evidenceFromPlan(plan) {
  const seen = new Set();
  for (const phase of plan?.phases ?? []) {
    for (const field of phase.evidence ?? []) seen.add(field);
  }
  return [...seen];
}

function completionRuntimeEvidence(context, runObjective) {
  if (runObjective === 'predict') return ['metrics.predictedLabel'];
  if (runObjective === 'fit') return ['training.parameterHistory'];
  return [];
}

function buildBranchRequirements({ plan, context, captures, minBranches }) {
  const schema = findControlSchema(context, plan.goal.control);
  const runObjective = schema?.runObjective;
  const traceEvidence = runObjective === 'predict'
    ? ['prediction.emitted']
    : runObjective === 'fit'
      ? ['training.completed']
      : [];
  return {
    controls: [{ key: plan.goal.control, values: plan.goal.values ?? [plan.goal.value] }],
    operations: runObjective ? [{ intent: runObjective, minCount: minBranches }] : [],
    reveals: { minCount: runObjective ? minBranches : 0 },
    captures,
    visualEvidence: evidenceFromPlan(plan),
    runtimeEvidence: completionRuntimeEvidence(context, runObjective),
    traceEvidence,
  };
}

function buildDeclaredRequirements({ plan, context, objective, captures, finalState }) {
  const capability = context?.teachingCapabilities?.[objective];
  if (!capability) {
    throw teachingError('TEACHING_GOAL_UNSUPPORTED', { objective, reason: 'no declared teaching capability' });
  }
  return {
    controls: objective === 'show_failure_case'
      ? [{ key: plan.goal.control, values: [plan.goal.value] }]
      : [],
    operations: [{ intent: capability.operationIntent, minCount: 1 }],
    reveals: { minCount: 1 },
    captures,
    visualEvidence: capability.visualEvidence ?? [],
    runtimeEvidence: capability.runtimeEvidence ?? [],
    traceEvidence: capability.traceEvidence ?? [],
    finalState,
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
    return buildDeclaredRequirements({ plan, context, objective, captures: ['result'], finalState: false });
  }
  if (objective === 'explain_prediction') {
    return buildDeclaredRequirements({ plan, context, objective, captures: [], finalState: true });
  }
  if (objective === 'show_training') {
    return buildDeclaredRequirements({ plan, context, objective, captures: [], finalState: true });
  }
  if (objective === 'introduce') {
    return {
      controls: [],
      operations: [],
      reveals: { minCount: 0 },
      captures: [],
      visualEvidence: [],
      runtimeEvidence: [],
      traceEvidence: [],
      finalState: false,
    };
  }
  throw teachingError('TEACHING_GOAL_UNSUPPORTED', { objective });
}

function operationIntentOf(context, operationName) {
  return context?.model?.operations?.[operationName]?.intent ?? null;
}

// Normalizes a concrete primitive binding to a semantic path:
//   '$model.training.lossHistory' -> 'training.lossHistory'
//   '$metrics'                    -> 'metrics'
// visualEvidence is satisfied only when a declared primitive actually binds
// the required path - a primitive that could theoretically bind it is
// insufficient.
function normalizeBinding(binding) {
  if (typeof binding !== 'string') return null;
  if (binding.startsWith('$model.')) return binding.slice('$model.'.length);
  if (binding === '$metrics') return 'metrics';
  return null;
}

function boundPathsOf(primitives) {
  const paths = new Set();
  for (const primitive of primitives ?? []) {
    for (const binding of Object.values(primitive?.props ?? {})) {
      const path = normalizeBinding(binding);
      if (path) paths.add(path);
    }
  }
  return paths;
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

function checkRuntimeEvidence(checks, missing, label, semantic, paths) {
  for (const path of paths ?? []) {
    const value = resolveEvidencePath(semantic, path);
    const satisfied = presentNonEmpty(value);
    checks.push({ requirement: `runtimeEvidence:${label}:${path}`, satisfied, evidence: [value] });
    if (!satisfied) missing.push(`runtimeEvidence:${label}:${path}`);
  }
}

function checkTraceEvidence(checks, missing, traces, entries) {
  for (const entry of entries ?? []) {
    if (typeof entry === 'string') {
      const present = (traces ?? []).some((trace) => trace.type === entry);
      checks.push({ requirement: `trace:${entry}`, satisfied: present, evidence: [] });
      if (!present) missing.push(`trace:${entry}`);
      continue;
    }
    if (entry && typeof entry === 'object' && entry.trace && entry.where) {
      const requirement = `trace:${entry.trace}${JSON.stringify(entry.where)}`;
      const satisfied = (traces ?? []).some((trace) => (
        trace.type === entry.trace
        && Object.entries(entry.where).every(([field, allowed]) => (
          Array.isArray(allowed) && allowed.includes(trace.payload?.[field])
        ))
      ));
      checks.push({ requirement, satisfied, evidence: [] });
      if (!satisfied) missing.push(requirement);
    }
  }
}

// Deterministic goal fidelity evaluation. `execution` (optional) comes from
// replayScriptForFidelity(); when present, required captures must exist and
// hold non-empty runtime evidence, required final-state evidence is checked
// against the final snapshot, and required trace events (including payload
// predicates) must have been produced.
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

  // Static: required visual evidence is actually bound by the Script's
  // concrete primitive.props (PR E.2.1 - no compatibleBindings guessing).
  const boundPaths = boundPathsOf(primitives);
  for (const path of requirements.visualEvidence ?? []) {
    const satisfied = boundPaths.has(path);
    checks.push({ requirement: `visual:${path}`, satisfied, evidence: [...boundPaths] });
    if (!satisfied) missing.push(`visual:${path}`);
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
        checkRuntimeEvidence(checks, missing, captureId, capture.semantic ?? {}, requirements.runtimeEvidence);
      }
    }
    if (requirements.finalState) {
      const final = execution.finalSnapshot ?? {};
      checkRuntimeEvidence(checks, missing, 'final', {
        ...(final.scene ?? {}),
        metrics: final.metrics ?? {},
        observation: final.observation ?? null,
        formula: final.formula ?? null,
      }, requirements.runtimeEvidence);
    }
    checkTraceEvidence(checks, missing, execution.traces, requirements.traceEvidence);
  }

  return { valid: missing.length === 0, checks, missing };
}
