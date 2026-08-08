import { getPlayground, listPlaygrounds } from './playgrounds/registry.js';
import {
  createPlaygroundSession,
  derivePlaygroundSnapshot,
  dispatchPlaygroundAction,
  playgroundError,
} from './playgrounds/session.js';
import { fallbackRegressionPoints, regressionPointsFromDataset } from './linearRegressionPlayground.js';
import { teachingDatasetById } from './teachingDatasets.js';
import { getPreset, listPresets } from './playground/visualization/presetRegistry.js';
import { validateScript as validateScriptDeclaration } from './playground/visualization/scriptValidator.js';
import { dryRunScript as runDryRun } from './playground/agent/dryRun.js';
import { generateVisualizationScript } from './playground/agent/scriptGenerator.js';
import { listModelAdapters, getModelAdapter } from './playground/model/modelRegistry.js';
import { PRIMITIVE_TYPES } from './playground/visualization/primitives.js';
import { listPrimitiveSchemas } from './playground/visualization/schemas.js';
import { RESOURCE_LIMITS } from './playground/visualization/scriptValidator.js';
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
            sample.points.map((point) => [point.x, point.y]),
          ]),
          points: sample.points.map((point, index) => ({ id: `d${index}`, x: point.x, y: point.y })),
          feature: sample.feature,
          target: sample.target,
          total: sample.total,
          usingDataset: true,
        };
      }
    }
    return {
      kind: 'example',
      name: 'Example data',
      fingerprint: 'example-linear-trend-v1',
      points: (teachingDatasetById('linear-trend')?.dataset.rows ?? fallbackRegressionPoints).map((point, index) => ({
        id: `e${index}`,
        x: point.x ?? point[0],
        y: point.y ?? point[1],
      })),
      feature: 'x',
      target: 'y',
      total: (teachingDatasetById('linear-trend')?.dataset.rows ?? fallbackRegressionPoints).length,
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
  throw playgroundError('INVALID_PLAYGROUND_SOURCE', { playgroundId: playground.id });
}

export function createPlaygroundHost({ getDataset, scriptGenerator } = {}) {
  let session = null;
  const subscribers = new Set();

  const notify = () => {
    const snapshot = session ? derivePlaygroundSnapshot(session) : null;
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
      return derivePlaygroundSnapshot(session);
    },

    async ensureOpen(playgroundId) {
      if (session && session.playgroundId !== playgroundId) session = null;
      if (!session) await this.open({ playgroundId });
    },

    getState() {
      if (!session) throw playgroundError('PLAYGROUND_NOT_OPEN');
      return derivePlaygroundSnapshot(session);
    },

    async dispatch(action) {
      if (!session) throw playgroundError('PLAYGROUND_NOT_OPEN');
      commit(dispatchPlaygroundAction(session, action));
      return derivePlaygroundSnapshot(session);
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
      return derivePlaygroundSnapshot(session);
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
      const semanticFields = Object.keys(adapter.semanticSchema ?? {});
      return {
        version: 1,
        playground: { id: session.playgroundId, modelAdapter: session.adapterId, task: data.task ?? null },
        model: {
          capabilities: { ...adapter.capabilities },
          operations: adapter.scriptOperations ?? {},
          semanticFields,
          semanticSchema: adapter.semanticSchema ?? {},
        },
        data: {
          task: data.task ?? null,
          featureColumns: data.featureColumns ?? [],
          targetColumn: data.targetColumn ?? null,
          rowCount: (data.rows ?? []).length,
          statistics,
          projection: snapshot.scene?.projection ?? null,
        },
        controls: snapshot.controls,
        traces: TRACE_EVENTS[session.adapterId] ?? [],
        traceSchemas: Object.fromEntries((TRACE_EVENTS[session.adapterId] ?? []).map((type) => [type, TRACE_PAYLOAD_SCHEMAS[type] ?? {}])),
        primitives: listPrimitiveSchemas(),
        bindings: [
          { prefix: '$model', fields: semanticFields },
          { prefix: '$data', fields: ['schema', 'rows', 'task', 'featureColumns', 'targetColumn', 'trainRatio'] },
          { prefix: '$controls', fields: Object.keys(snapshot.controls ?? {}) },
          { prefix: '$metrics', fields: Object.keys(snapshot.metrics ?? {}) },
          { prefix: '$trace', fields: null },
        ],
        resourceLimits: { ...RESOURCE_LIMITS },
        currentState: {
          status: snapshot.status,
          scriptId: snapshot.script?.id ?? null,
          scriptStep: snapshot.scriptState?.step ?? 0,
          scriptTotalSteps: snapshot.scriptState?.totalSteps ?? 0,
          modelStep: snapshot.timeline?.step ?? 0,
          revealed: snapshot.metrics?.revealed ?? null,
          predictedLabel: snapshot.metrics?.predictedLabel ?? null,
        },
      };
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

    async loadScript(script) {
      if (!session) throw playgroundError('PLAYGROUND_NOT_OPEN');
      commit(dispatchPlaygroundAction(session, { type: 'SCRIPT_LOAD', script }));
      return derivePlaygroundSnapshot(session);
    },

    async loadPreset({ presetId, parameters = {} }) {
      if (!session) throw playgroundError('PLAYGROUND_NOT_OPEN');
      const preset = getPreset(presetId);
      if (!preset) throw playgroundError('PLAYGROUND_PRESET_NOT_FOUND', { presetId });
      commit(dispatchPlaygroundAction(session, { type: 'SCRIPT_LOAD', script: preset }));
      for (const [key, value] of Object.entries(parameters)) {
        commit(dispatchPlaygroundAction(session, { type: 'SET_CONTROL', key, value }));
      }
      return derivePlaygroundSnapshot(session);
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
        return {
          mode: 'preset',
          script: fallbackScript,
          rationale: `Script generation failed; fell back to preset ${fallbackScript.id}.`,
          dryRun,
          fallback: true,
          snapshot: derivePlaygroundSnapshot(session),
        };
      }
      commit(dispatchPlaygroundAction(session, { type: 'SCRIPT_LOAD', script: result.script }));
      return { ...result, dryRun, snapshot: derivePlaygroundSnapshot(session) };
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
      return derivePlaygroundSnapshot(session);
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
