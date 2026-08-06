import { getPlayground, listPlaygrounds } from './playgrounds/registry.js';
import {
  createPlaygroundSession,
  derivePlaygroundSnapshot,
  dispatchPlaygroundAction,
  playgroundError,
} from './playgrounds/session.js';
import { fallbackRegressionPoints, regressionPointsFromDataset } from './linearRegressionPlayground.js';
import { teachingDatasetById } from './teachingDatasets.js';
import { profileBrowserDataset } from './browserExecutionContract.js';

const fingerprintOf = (value) => JSON.stringify(value);

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
        ? numeric.slice(0, 2)
        : (dataset.featureColumns ?? []).filter((name) => numeric.includes(name));
      if (features.length >= 2) {
        const profile = profileBrowserDataset(dataset);
        const samples = profile.samples.filter((sample) => sample.y);
        if (samples.length >= 3 && new Set(samples.map((sample) => sample.y)).size >= 2) {
          return {
            kind: 'workspace-dataset',
            name: dataset.name,
            fingerprint: fingerprintOf([dataset.name, dataset.task, features, dataset.targetColumn, samples.length]),
            samples,
            featureColumns: dataset.featureColumns,
            trainRatio: dataset.trainRatio ?? 0.8,
            total: samples.length,
            usingDataset: true,
          };
        }
      }
    }
    const teaching = teachingDatasetById('knn-neighborhood')?.dataset;
    const samples = (teaching?.rows ?? []).map((row, index) => ({
      index,
      x: teaching.featureColumns.map((column) => Number(row[column])),
      y: String(row[teaching.targetColumn]),
    }));
    return {
      kind: 'example',
      name: 'Example data',
      fingerprint: 'example-knn-neighborhood-v1',
      samples,
      featureColumns: teaching?.featureColumns ?? ['x1', 'x2'],
      trainRatio: teaching?.trainRatio ?? 0.8,
      total: samples.length,
      usingDataset: false,
    };
  }
  throw playgroundError('INVALID_PLAYGROUND_SOURCE', { playgroundId: playground.id });
}

export function createPlaygroundHost({ getDataset }) {
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
        seed: request.seed ?? 1,
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

    async play() { return this.dispatch({ type: 'PLAY' }); },
    async pause() { return this.dispatch({ type: 'PAUSE' }); },
    async step() { return this.dispatch({ type: 'STEP' }); },
    async seek(step) { return this.dispatch({ type: 'SEEK', step }); },
    async reset() { return this.dispatch({ type: 'RESET' }); },

    async runScenario(scenarioId) {
      if (!session) throw playgroundError('PLAYGROUND_NOT_OPEN');
      commit(dispatchPlaygroundAction(session, { type: 'RUN_SCENARIO', scenarioId }));
      let guard = 0;
      while (session.scenario && guard < 100) {
        commit(dispatchPlaygroundAction(session, { type: 'SCENARIO_NEXT' }));
        guard += 1;
        await Promise.resolve();
      }
      return derivePlaygroundSnapshot(session);
    },

    async refreshSource() {
      if (!session) throw playgroundError('PLAYGROUND_NOT_OPEN');
      const playground = getPlayground(session.playgroundId);
      const source = resolveSource(playground, getDataset());
      commit(createPlaygroundSession(playground, {
        source,
        controls: session.controls,
        sessionId: session.sessionId,
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
