import { getPlayground, listPlaygrounds } from './playgrounds/registry.js';
import {
  createPlaygroundSession,
  derivePlaygroundSnapshot,
  dispatchPlaygroundAction,
  playgroundError,
} from './playgrounds/session.js';
import { fallbackRegressionPoints, regressionPointsFromDataset } from './linearRegressionPlayground.js';
import { teachingDatasetById } from './teachingDatasets.js';
import { generateXorDataset } from './playground/model/mlpMath.js';
import { getPreset, listPresets } from './playground/visualization/presetRegistry.js';
import { validateScript as validateScriptDeclaration } from './playground/visualization/scriptValidator.js';
import { dryRunScript as runDryRun } from './playground/agent/dryRun.js';
import { generateVisualizationScript } from './playground/agent/scriptGenerator.js';
import { planTeachingGoal } from './playground/agent/teachingPlanner.js';
import { composeScriptFromPlan } from './playground/agent/teachingComposer.js';
import {
  evaluateGoalFidelity,
  replayScriptForFidelity,
} from './playground/agent/teachingFidelity.js';
import { teachingError } from './playground/agent/teachingPlan.js';
import { TEACHING_OBJECTIVES, getSupportedTeachingObjectives } from './playground/agent/teachingTaxonomy.js';
import { reviseScriptDeclaration } from './playground/agent/scriptRevision.js';
import { listModelAdapters, getModelAdapter } from './playground/model/modelRegistry.js';
import { PRIMITIVE_TYPES } from './playground/visualization/primitives.js';
import { listPrimitiveSchemas } from './playground/visualization/schemas.js';
import { RESOURCE_LIMITS } from './playground/visualization/scriptValidator.js';
import { MAX_GESTURE_PATH_POINTS, MAX_POINTS_PER_GESTURE } from './exploration/gestures.js';
import { MAX_WORLD_HISTORY_ACTIONS, MAX_WORLD_TRANSACTION_OPERATIONS } from './exploration/operations.js';
import { listWorldOperations } from './exploration/operationRegistry.js';
import { MAX_WORLD_OBSERVATIONS } from './exploration/world.js';
import { TRACE_EVENTS, TRACE_PAYLOAD_SCHEMAS } from './playground/trace/traceTypes.js';

const fingerprintOf = (value) => JSON.stringify(value);

// Playback routing: with an active Visualization Script the host controls the
// Script Runtime (SCRIPT_* actions); without one it falls back to the model
// runtime actions. UI and Agent share this single routing layer.
function hasActiveScript(session) {
  return Boolean(
    session?.script
    && session?.scriptState
    && session.scriptState.totalSteps > 0
  );
}

function resolveSource(playground, dataset) {
  if (playground.id === 'data-lab') {
    if (dataset?.task === 'classification') {
      const numericFeatures = (dataset.featureColumns ?? []).filter((feature) => (
        (dataset.columns ?? []).some((column) => column.name === feature && column.type === 'number')
      ));
      const target = dataset.targetColumn;
      const rows = (dataset.rows ?? []).filter((row) => (
        numericFeatures.every((feature) => Number.isFinite(Number(row?.[feature])))
        && row?.[target] !== undefined
        && row?.[target] !== null
        && String(row[target]) !== ''
      ));
      const labels = [...new Set(rows.map((row) => String(row[target])))];
      return {
        kind: 'workspace-dataset',
        name: dataset.name,
        fingerprint: fingerprintOf([dataset.name, dataset.task, numericFeatures, target, rows.length]),
        task: 'classification',
        points: rows.map((row, index) => ({
          id: `d${index}`,
          features: Object.fromEntries(numericFeatures.map((feature) => [feature, Number(row[feature])])),
          label: String(row[target]),
          membership: row.membership ?? row.split,
          provenance: 'imported',
        })),
        featureColumns: numericFeatures,
        target: target ?? 'label',
        targetColumn: target ?? 'label',
        trainRatio: dataset.trainRatio ?? 0.8,
        total: rows.length,
        usingDataset: true,
        labelCount: labels.length,
      };
    }
    if (dataset?.task === 'regression') {
      const featureColumns = [...(dataset.featureColumns ?? [])];
      const target = dataset.targetColumn;
      const rows = (dataset.rows ?? []).filter((row) => (
        featureColumns.every((feature) => Number.isFinite(Number(row?.[feature])))
        && Number.isFinite(Number(row?.[target]))
      ));
      return {
        kind: 'workspace-dataset',
        name: dataset.name,
        fingerprint: fingerprintOf([dataset.name, dataset.task, featureColumns, target, rows.length]),
        task: 'regression',
        points: rows.map((row, index) => ({
          id: `d${index}`,
          x: Number(row[featureColumns[0]]),
          y: Number(row[target]),
          target: Number(row[target]),
          features: Object.fromEntries([
            ...featureColumns.map((feature) => [feature, Number(row[feature])]),
            [target, Number(row[target])],
          ]),
          membership: row.membership ?? row.split,
          provenance: 'imported',
        })),
        feature: featureColumns[0],
        target,
        featureColumns,
        targetColumn: target,
        trainRatio: dataset.trainRatio ?? 0.8,
        total: rows.length,
        usingDataset: true,
      };
    }
    const teaching = teachingDatasetById('linear-trend')?.dataset;
    const points = (teaching?.rows ?? fallbackRegressionPoints).map((point, index) => ({
      id: `e${index}`,
      x: point.x ?? point[0],
      y: point.y ?? point[1],
      target: point.y ?? point[1],
      features: { x: point.x ?? point[0], y: point.y ?? point[1] },
      provenance: 'generated',
    }));
    return {
      kind: 'example',
      name: teaching?.name ?? 'Data Lab sample',
      fingerprint: teaching ? 'teaching-linear-trend-v1' : 'data-lab-sample-v1',
      task: 'regression',
      points,
      feature: 'x',
      target: 'y',
      featureColumns: ['x'],
      targetColumn: 'y',
      total: points.length,
      usingDataset: false,
    };
  }
  if (playground.id === 'linear-regression') {
    if (dataset?.task === 'regression') {
      const sample = regressionPointsFromDataset(dataset);
      if (sample.usingDataset) {
        return {
          kind: 'workspace-dataset',
          name: dataset.name,
            fingerprint: fingerprintOf([
              dataset.name,
              dataset.task,
              dataset.featureColumns,
              dataset.targetColumn,
              sample.total,
              sample.points.map((point) => [point.x, point.y, point.features]),
            ]),
            points: sample.points.map((point, index) => ({ ...point, id: `d${index}` })),
            feature: sample.feature,
            target: sample.target,
            featureColumns: [...(dataset.featureColumns ?? [])],
            task: 'regression',
            total: sample.total,
            usingDataset: true,
        };
      }
    }
    const teaching = teachingDatasetById('linear-trend')?.dataset;
    const points = (teaching?.rows ?? fallbackRegressionPoints).map((point, index) => ({
      id: `e${index}`,
      x: point.x ?? point[0],
      y: point.y ?? point[1],
    }));
    return {
      kind: 'example',
      name: teaching?.name ?? 'Example data',
      fingerprint: teaching ? 'teaching-linear-trend-v1' : 'example-linear-trend-fallback-v1',
      points,
      feature: 'x',
      target: 'y',
      task: 'regression',
      total: points.length,
      usingDataset: false,
    };
  }
  if (playground.id === 'knn-classification') {
    if (dataset?.task === 'classification') {
      const numeric = (dataset.columns ?? [])
        .filter((column) => column.type === 'number')
        .map((column) => column.name);
      const features = numeric.length >= 2
        ? numeric
        : (dataset.featureColumns ?? []).filter((name) => numeric.includes(name));
      if (features.length >= 2) {
        const rows = dataset.rows.filter((row) => (
          features.every((name) => Number.isFinite(Number(row?.[name])))
          && typeof row?.[dataset.targetColumn] === 'string'
          && row[dataset.targetColumn]
        ));
        if (rows.length >= 2) {
          return {
            kind: 'workspace-dataset',
            name: dataset.name,
            fingerprint: fingerprintOf([dataset.name, dataset.task, features, dataset.targetColumn, rows.length]),
            points: rows.map((row, index) => ({
              id: `d${index}`,
              features: Object.fromEntries(features.map((name) => [name, Number(row[name])])),
              label: row[dataset.targetColumn],
            })),
            featureColumns: features,
            trainRatio: dataset.trainRatio ?? 0.8,
            total: rows.length,
            usingDataset: true,
          };
        }
      }
    }
    const teaching = teachingDatasetById('knn-neighborhood')?.dataset;
    const columns = teaching?.featureColumns ?? ['x1', 'x2'];
    const target = teaching?.targetColumn ?? 'label';
    const points = (teaching?.rows ?? []).map((row, index) => ({
      id: `e${index}`,
      features: Object.fromEntries(columns.map((column) => [column, Number(row[column])])),
      label: String(row[target]),
    }));
    return {
      kind: 'example',
      name: 'Example data',
      fingerprint: 'example-knn-neighborhood-v1',
      points,
      featureColumns: columns,
      trainRatio: teaching?.trainRatio ?? 0.8,
      total: points.length,
      usingDataset: false,
    };
  }
  if (playground.id === 'mlp-classification') {
    // PR F.3 / F.3.1: compatible workspace datasets (binary classification,
    // at least two declared numeric features) are wired through the shared
    // dataset contract. The declared `featureColumns` are authoritative: only
    // numeric declared features enter the model (never unrelated numeric
    // columns like id/timestamp). Classification targets are normalized to
    // stable semantic strings (0 -> "0", true -> "true") before the binary
    // label mapping. The adapter is feature-name agnostic.
    if (dataset?.task === 'classification') {
      const numericColumns = new Set(
        (dataset.columns ?? [])
          .filter((column) => column.type === 'number')
          .map((column) => column.name),
      );
      const features = (dataset.featureColumns ?? [])
        .filter((name) => name !== dataset.targetColumn && numericColumns.has(name));
      if (features.length >= 2) {
        const rows = dataset.rows.filter((row) => (
          features.every((name) => Number.isFinite(Number(row?.[name])))
          && row?.[dataset.targetColumn] !== undefined
          && row?.[dataset.targetColumn] !== null
          && String(row[dataset.targetColumn]) !== ''
        ));
        const labels = [...new Set(rows.map((row) => String(row[dataset.targetColumn])))];
        if (rows.length >= 2 && labels.length === 2) {
          return {
            kind: 'workspace-dataset',
            name: dataset.name,
            fingerprint: fingerprintOf([dataset.name, dataset.task, features, dataset.targetColumn, rows.length, labels.sort().join('|')]),
            points: rows.map((row, index) => ({
              id: `d${index}`,
              features: Object.fromEntries(features.map((name) => [name, Number(row[name])])),
              label: String(row[dataset.targetColumn]),
            })),
            featureColumns: features,
            trainRatio: dataset.trainRatio ?? 0.8,
            total: rows.length,
            usingDataset: true,
          };
        }
        if (rows.length >= 2 && labels.length > 2) {
          throw playgroundError('INVALID_PLAYGROUND_SOURCE', {
            reason: 'MLP requires binary classification',
            labels: labels.length,
          });
        }
      }
    }
    const points = generateXorDataset({ seed: 2026 });
    return {
      kind: 'example',
      name: 'XOR example',
      fingerprint: 'example-mlp-xor-v1',
      points,
      featureColumns: ['x1', 'x2'],
      total: points.length,
      usingDataset: false,
    };
  }
  throw playgroundError('INVALID_PLAYGROUND_SOURCE', { playgroundId: playground.id });
}

export function createPlaygroundHost({ getDataset, scriptGenerator } = {}) {
  let session = null;
  // Where the active script came from: 'preset' | 'generated' | 'composed' |
  // 'revised' | 'imported'. The UI surfaces this so users can always tell
  // whether they are looking at a preset, an Agent composition or an import.
  let scriptProvenance = 'preset';
  const subscribers = new Set();

  const present = (snapshot) => (snapshot ? { ...snapshot, provenance: scriptProvenance } : null);

  const notify = () => {
    const snapshot = present(session ? derivePlaygroundSnapshot(session) : null);
    subscribers.forEach((listener) => {
      try { listener(snapshot); } catch { /* one subscriber must not break the host */ }
    });
  };

  const commit = (next) => {
    session = next;
    notify();
  };

  return {
    list: () => listPlaygrounds(),

    async open(request = {}) {
      if (session) throw playgroundError('PLAYGROUND_ALREADY_OPEN', { playgroundId: session.playgroundId });
      const playground = getPlayground(request.playgroundId);
      if (!playground) throw playgroundError('PLAYGROUND_NOT_FOUND', { playgroundId: request.playgroundId });
      const source = resolveSource(playground, getDataset());
      commit(createPlaygroundSession(playground, {
        source,
        controls: request.controls ?? {},
        seed: request.seed,
        dataset: getDataset(),
      }));
      scriptProvenance = 'preset';
      return present(derivePlaygroundSnapshot(session));
    },

    async ensureOpen(playgroundId) {
      if (session && session.playgroundId !== playgroundId) session = null;
      if (!session) await this.open({ playgroundId });
    },

    getState() {
      if (!session) throw playgroundError('PLAYGROUND_NOT_OPEN');
      return present(derivePlaygroundSnapshot(session));
    },

    async dispatch(action) {
      if (!session) throw playgroundError('PLAYGROUND_NOT_OPEN');
      commit(dispatchPlaygroundAction(session, action));
      return present(derivePlaygroundSnapshot(session));
    },

    async play() {
      return this.dispatch(hasActiveScript(session) ? { type: 'SCRIPT_PLAY' } : { type: 'PLAY' });
    },
    async pause() {
      return this.dispatch(hasActiveScript(session) ? { type: 'SCRIPT_PAUSE' } : { type: 'PAUSE' });
    },
    async step() {
      return this.dispatch(hasActiveScript(session) ? { type: 'SCRIPT_STEP' } : { type: 'STEP' });
    },
    async seek(step) {
      return this.dispatch(hasActiveScript(session) ? { type: 'SCRIPT_SEEK', step } : { type: 'SEEK', step });
    },
    async reset() {
      return this.dispatch(hasActiveScript(session) ? { type: 'SCRIPT_RESET' } : { type: 'RESET' });
    },

    async runScenario(scenarioId) {
      if (!session) throw playgroundError('PLAYGROUND_NOT_OPEN');
      commit(dispatchPlaygroundAction(session, { type: 'RUN_SCENARIO', scenarioId }));
      scriptProvenance = 'preset';
      return present(derivePlaygroundSnapshot(session));
    },

    // ---- PR C: Agent visualization script operations ----
    getCapabilities() {
      return {
        apiVersion: 1,
        models: listModelAdapters().map((adapter) => ({
          id: adapter.id,
          capabilities: { ...adapter.capabilities },
          operations: Object.keys(getModelAdapter(adapter.id)?.scriptOperations ?? {}),
          operationSchemas: getModelAdapter(adapter.id)?.scriptOperations ?? {},
        })),
        presets: listPresets().map((preset) => preset.id),
        primitives: [...PRIMITIVE_TYPES],
      };
    },

    inspectContext() {
      if (!session) throw playgroundError('PLAYGROUND_NOT_OPEN');
      const adapter = getModelAdapter(session.adapterId);
      const playground = getPlayground(session.playgroundId);
      const snapshot = derivePlaygroundSnapshot(session);
      const data = snapshot.dataState ?? {};
      const statistics = {};
      for (const feature of data.featureColumns ?? []) {
        const values = (data.rows ?? [])
          .map((row) => Number(row?.[feature]))
          .filter((value) => Number.isFinite(value));
        if (values.length) {
          statistics[feature] = {
            count: values.length,
            mean: values.reduce((sum, value) => sum + value, 0) / values.length,
            min: Math.min(...values),
            max: Math.max(...values),
          };
        }
      }
      const semanticFields = Object.keys(adapter?.semanticSchema ?? {});
      const worldOperations = listWorldOperations();
      const transactionActions = ['APPLY_WORLD_TRANSACTION', 'UNDO_WORLD_ACTION', 'REDO_WORLD_ACTION'];
      const viewActions = ['SET_WORKSPACE_VIEW'];
      const experimentOperations = ['DUPLICATE_EXPERIMENT', 'RESTORE_EXPERIMENT', 'COMPARE_EXPERIMENTS'];
      const context = {
        version: 1,
        playground: { id: session.playgroundId, modelAdapter: session.adapterId, task: data.task ?? null },
        model: adapter ? {
          capabilities: { ...adapter.capabilities },
          operations: adapter.scriptOperations ?? {},
          semanticFields,
          semanticSchema: adapter.semanticSchema ?? {},
        } : null,
        data: {
          task: data.task ?? null,
          featureColumns: data.featureColumns ?? [],
          targetColumn: data.targetColumn ?? null,
          rowCount: (data.rows ?? []).length,
          statistics,
          projection: snapshot.scene?.projection ?? null,
        },
        controls: snapshot.controls,
        world: snapshot.world ?? null,
        experiment: snapshot.experiment ?? null,
        exploration: {
          version: 1,
          worldOperations,
          transactionActions,
          viewActions,
          experimentOperations,
          operations: [
            ...worldOperations.map((operation) => operation.type),
            ...transactionActions,
            ...viewActions,
            ...experimentOperations,
          ],
        },
        controlSchemas: (playground?.controls ?? []).map((control) => ({
          key: control.key,
          type: control.type,
          ...(control.domain ? { domain: control.domain } : {}),
          ...(control.min !== undefined ? { min: control.min } : {}),
          ...(control.max !== undefined ? { max: control.max } : {}),
          ...(control.step !== undefined ? { step: control.step } : {}),
          ...(control.options ? { options: [...control.options] } : {}),
          ...(control.runObjective ? { runObjective: control.runObjective } : {}),
        })),
        traces: TRACE_EVENTS[session.adapterId] ?? [],
        traceSchemas: Object.fromEntries((TRACE_EVENTS[session.adapterId] ?? []).map((type) => [type, TRACE_PAYLOAD_SCHEMAS[type] ?? {}])),
        primitives: listPrimitiveSchemas(),
        bindings: [
          { prefix: '$model', fields: adapter ? semanticFields : [] },
          { prefix: '$data', fields: ['schema', 'rows', 'task', 'featureColumns', 'targetColumn', 'trainRatio'] },
          { prefix: '$controls', fields: Object.keys(snapshot.controls ?? {}) },
          { prefix: '$metrics', fields: Object.keys(snapshot.metrics ?? {}) },
          { prefix: '$trace', fields: null },
        ],
        resourceLimits: {
          ...RESOURCE_LIMITS,
          maxWorldObservations: MAX_WORLD_OBSERVATIONS,
          maxGesturePathPoints: MAX_GESTURE_PATH_POINTS,
          maxPointsPerGesture: MAX_POINTS_PER_GESTURE,
          maxWorldTransactionOperations: MAX_WORLD_TRANSACTION_OPERATIONS,
          maxWorldHistoryActions: MAX_WORLD_HISTORY_ACTIONS,
        },
        currentState: {
          status: snapshot.status,
          scriptId: snapshot.script?.id ?? null,
          scriptStep: snapshot.scriptState?.step ?? 0,
          scriptTotalSteps: snapshot.scriptState?.totalSteps ?? 0,
          modelStep: snapshot.timeline?.step ?? 0,
          revealed: snapshot.metrics?.revealed ?? null,
          predictedLabel: snapshot.metrics?.predictedLabel ?? null,
        },
        teachingCapabilities: adapter?.teachingCapabilities ?? {},
      };
      context.teaching = {
        objectives: [...TEACHING_OBJECTIVES],
        supportedObjectives: getSupportedTeachingObjectives(context),
        capabilities: context.teachingCapabilities,
      };
      return context;
    },

    listPresets() {
      return listPresets();
    },

    getScript() {
      return session ? structuredClone(session.script) : null;
    },

    exportScript() {
      return session ? structuredClone(session.script) : null;
    },

    validateScript(script) {
      try {
        validateScriptDeclaration(script);
        return { valid: true };
      } catch (error) {
        return { valid: false, code: error.code ?? 'INVALID_SCRIPT', details: error.details ?? {} };
      }
    },

    async loadScript(script, options = {}) {
      if (!session) throw playgroundError('PLAYGROUND_NOT_OPEN');
      commit(dispatchPlaygroundAction(session, { type: 'SCRIPT_LOAD', script }));
      scriptProvenance = options.provenance ?? 'imported';
      return present(derivePlaygroundSnapshot(session));
    },

    async loadPreset({ presetId, parameters = {} }) {
      if (!session) throw playgroundError('PLAYGROUND_NOT_OPEN');
      const preset = getPreset(presetId);
      if (!preset) throw playgroundError('PLAYGROUND_PRESET_NOT_FOUND', { presetId });
      commit(dispatchPlaygroundAction(session, { type: 'SCRIPT_LOAD', script: preset }));
      for (const [key, value] of Object.entries(parameters)) {
        commit(dispatchPlaygroundAction(session, { type: 'SET_CONTROL', key, value }));
      }
      scriptProvenance = 'preset';
      return present(derivePlaygroundSnapshot(session));
    },

    dryRunScript(script) {
      return runDryRun({ script, session });
    },

    async generateScript({ goal, constraints = {} } = {}) {
      if (!session) throw playgroundError('PLAYGROUND_NOT_OPEN');
      const presets = listPresets();
      const externalGenerator = scriptGenerator;
      let result;
      let dryRun;
      try {
        result = generateVisualizationScript({
          goal,
          constraints,
          adapterId: session.adapterId,
          presets,
          externalGenerator: scriptGenerator,
        });
        dryRun = runDryRun({ script: result.script, session });
        if (!dryRun.valid) {
          throw Object.assign(new Error(dryRun.code), { code: dryRun.code, details: dryRun.details });
        }
      } catch {
        // Preset-first fallback (C7): pick the closest matching preset.
        const fallbackPreset = presets.find((preset) => getPreset(preset.id)?.model.adapter === session.adapterId)
          ?? presets.find((preset) => getPreset(preset.id));
        const fallbackScript = fallbackPreset ? getPreset(fallbackPreset.id) : null;
        if (!fallbackScript) throw playgroundError('PLAYGROUND_PRESET_NOT_FOUND', { presetId: goal });
        dryRun = runDryRun({ script: fallbackScript, session });
        commit(dispatchPlaygroundAction(session, { type: 'SCRIPT_LOAD', script: fallbackScript }));
        scriptProvenance = 'preset';
        return {
          mode: 'preset',
          script: fallbackScript,
          rationale: `Script generation failed; fell back to preset ${fallbackScript.id}.`,
          dryRun,
          fallback: true,
          snapshot: present(derivePlaygroundSnapshot(session)),
        };
      }
      commit(dispatchPlaygroundAction(session, { type: 'SCRIPT_LOAD', script: result.script }));
      scriptProvenance = result.mode === 'preset' ? 'preset' : 'generated';
      return { ...result, dryRun, snapshot: present(derivePlaygroundSnapshot(session)) };
    },

    // PR E.1: TeachingPlanner -> TeachingPlan. The planner consumes the same
    // inspectContext() the Agent reads, so a plan is always schema-grounded.
    async plan({ goal }) {
      if (!session) throw playgroundError('PLAYGROUND_NOT_OPEN');
      return planTeachingGoal({ goal, context: this.inspectContext() });
    },

    // PR E.1: Composer -> Visualization Script. The composed script is
    // validated and strict-dry-run against the live session before it is
    // returned; the caller decides when to loadScript() it. The live session
    // is never mutated here.
    async composeScript({ plan }) {
      if (!session) throw playgroundError('PLAYGROUND_NOT_OPEN');
      const context = this.inspectContext();
      const script = composeScriptFromPlan({ plan, context });
      const dryRun = runDryRun({ script, session });
      if (!dryRun.valid) {
        throw Object.assign(new Error(dryRun.code), { code: dryRun.code, details: dryRun.details });
      }
      const execution = replayScriptForFidelity({ script, session });
      const fidelity = evaluateGoalFidelity({ plan, script, context, execution });
      if (!fidelity.valid) {
        throw teachingError('TEACHING_GOAL_FIDELITY_FAILED', { missing: fidelity.missing });
      }
      return { mode: 'composed', plan, script, fidelity, dryRun };
    },

    // PR F.2: bounded revision of an existing TeachingPlan + Script. The
    // revised declaration always passes validateScript -> strict dry run ->
    // goal fidelity before it is returned; the caller previews it and then
    // loads it explicitly (provenance 'revised').
    async reviseScript({ plan, script, request }) {
      if (!session) throw playgroundError('PLAYGROUND_NOT_OPEN');
      const result = reviseScriptDeclaration({
        plan,
        script,
        request,
        context: this.inspectContext(),
        session,
      });
      return { mode: 'revised', ...result };
    },

    async refreshSource() {
      if (!session) throw playgroundError('PLAYGROUND_NOT_OPEN');
      const playground = getPlayground(session.playgroundId);
      const source = resolveSource(playground, getDataset());
      commit(createPlaygroundSession(playground, {
        source,
        controls: session.controls,
        sessionId: session.sessionId,
        seed: session.seed,
        dataset: getDataset(),
      }));
      scriptProvenance = 'preset';
      return present(derivePlaygroundSnapshot(session));
    },

    // UI-only convenience: opens the requested playground, closing a different
    // one first. Not exposed through the Agent API.
    currentSourceFingerprint() {
      if (!session) return null;
      const playground = getPlayground(session.playgroundId);
      try {
        const source = resolveSource(playground, getDataset());
        return { kind: source.kind, fingerprint: source.fingerprint };
      } catch {
        return { kind: session.source.kind, fingerprint: session.source.fingerprint };
      }
    },

    markSourceStale() {
      if (!session || session.source.stale) return;
      commit({ ...session, source: { ...session.source, stale: true } });
    },

    async close() {
      session = null;
      notify();
    },

    subscribe(listener) {
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
  };
}
