import { useEffect, useMemo, useRef, useState } from 'react';
import { AiProviderContext } from '../components/ai/AiProviderContext.jsx';
import ExploreAgentSurface from '../components/playground/ExploreAgentSurface.jsx';
import { createProviderGateway } from '../core/ai/providerRegistry.js';
import { AGENT_TASK_MODES } from '../core/ai/agentRequestContract.js';
import { createPlaygroundAgentApi } from '../core/playgroundAgent.js';
import { createPlaygroundHost } from '../core/playgroundHost.js';

// This is a development-only fixture world. It is deliberately materialized
// through the same data-lab -> model attachment -> World Recipe boundaries as
// the application; the browser harness does not manufacture a proposal or a
// post-execution snapshot. A single wrapper injects one component-level
// pending-task failure so the retry/rerender guard remains observable.
const t = (key) => key;

const regressionRecipe = {
  version: 1,
  task: 'regression',
  coordinateSpace: 'cartesian-2d',
  groups: [{
    id: 'signal-line',
    label: 'signal',
    shape: { type: 'line', params: { start: [-2, -2.5], end: [2, 3.5], thickness: 0.1 } },
    transform: { translate: [0, 0], rotate: 0, scale: [1, 1] },
    splitTransforms: { train: null, test: null },
    sampling: {
      train: { count: 24, density: { type: 'uniform' } },
      test: { count: 12, density: { type: 'uniform' } },
    },
  }],
  noise: {
    train: { position: { amount: 0.2 }, label: { probability: 0, policy: 'flip' }, outliers: { fraction: 0, placement: 'radial', distance: 2 }, local: [] },
    test: { position: { amount: 0.2 }, label: { probability: 0, policy: 'flip' }, outliers: { fraction: 0, placement: 'radial', distance: 2 }, local: [] },
  },
};

function runtimeSummary(snapshot) {
  const comparison = snapshot?.experimentWorkspace?.comparison;
  return {
    experimentId: snapshot?.experiment?.id ?? null,
    activeExperimentId: snapshot?.experimentWorkspace?.activeExperimentId ?? null,
    worldId: snapshot?.world?.id ?? null,
    worldGenerator: snapshot?.world?.generator?.kind ?? null,
    worldSeed: snapshot?.world?.randomness?.seed ?? null,
    observationCount: snapshot?.world?.observations?.length ?? 0,
    modelAttached: Boolean(snapshot?.model?.adapterId),
    modelFit: snapshot?.experiment?.result?.model
      ? { weight: snapshot.experiment.result.model.weight, bias: snapshot.experiment.result.model.bias }
      : null,
    comparison: comparison
      ? { enabled: Boolean(comparison.enabled), againstExperimentId: comparison.againstExperimentId ?? null, changed: comparison.diff?.changed ?? [], unchanged: comparison.diff?.unchanged ?? [] }
      : null,
  };
}

function createObservedAgent(realAgent, host, { onProposal, onExecution, onFault } = {}) {
  let pendingFaultInjected = false;
  const proposeExploration = async (request = {}) => {
    // Every successful call delegates to the real agent -> planner ->
    // scenario validator chain. Only the first queued Lumi design task
    // is rejected to exercise the component pending-task guard.
    if (!pendingFaultInjected
      && request.taskMode === AGENT_TASK_MODES.EXPERIMENT_DESIGN
      && request.task?.kind === 'experiment-design-request') {
      pendingFaultInjected = true;
      onProposal?.({ request, delegated: false, resultKind: null });
      onFault?.({ kind: 'pending-task', injected: true, delegated: false });
      throw Object.assign(new Error('fixture planner failure'), { code: 'EXPLORATION_FIXTURE_FAILURE' });
    }
    const proposal = await realAgent.proposeExploration(request);
    onProposal?.({ request, delegated: true, resultKind: proposal?.kind ?? null });
    return proposal;
  };
  const executeExploration = async (scenario) => {
    const before = runtimeSummary(host.getState());
    const result = await realAgent.executeExploration(scenario);
    const after = runtimeSummary(host.getState());
    onExecution?.({ before, after, result: { kind: 'scenario', changed: result?.mutationDiff?.changed ?? [] } });
    return result;
  };
  return Object.freeze({ ...realAgent, proposeExploration, executeExploration });
}

export default function AgentRequestContractHarness() {
  const [snapshot, setSnapshot] = useState(null);
  const [proposalCalls, setProposalCalls] = useState(0);
  const [executeCalls, setExecuteCalls] = useState(0);
  const [executionTransitions, setExecutionTransitions] = useState([]);
  const [faults, setFaults] = useState([]);
  const [tick, setTick] = useState(0);
  const hostRef = useRef(null);
  const agentRef = useRef(null);
  const gateway = useMemo(() => createProviderGateway(), []);

  useEffect(() => {
    let disposed = false;
    let unsubscribe = null;
    const host = createPlaygroundHost({ getDataset: () => null });
    const realAgent = createPlaygroundAgentApi(host);
    const agent = createObservedAgent(realAgent, host, {
      onProposal: ({ delegated, resultKind }) => {
        if (delegated || resultKind === null) setProposalCalls((value) => value + 1);
      },
      onExecution: (transition) => {
        setExecuteCalls((value) => value + 1);
        setExecutionTransitions((items) => [...items, transition].slice(-8));
      },
      onFault: (fault) => setFaults((items) => [...items, fault].slice(-8)),
    });
    hostRef.current = host;
    agentRef.current = agent;
    const initialize = async () => {
      await host.open({ playgroundId: 'data-lab', seed: 7101 });
      await realAgent.dispatch({ type: 'ATTACH_MODEL', modelPlaygroundId: 'linear-regression' });
      await realAgent.dispatch({
        type: 'APPLY_WORLD_TRANSACTION',
        transaction: {
          operations: [
            { type: 'SET_WORLD_RECIPE', recipe: regressionRecipe, seed: 7101 },
            { type: 'REGENERATE_WORLD', seed: 7101 },
          ],
        },
      });
      if (disposed) {
        await host.close();
        return;
      }
      setSnapshot(host.getState());
      unsubscribe = host.subscribe((next) => setSnapshot(next));
    };
    initialize().catch((error) => setFaults((items) => [...items, { kind: 'initialization', code: error?.code ?? 'UNKNOWN' }]));
    return () => {
      disposed = true;
      unsubscribe?.();
      host.close().catch(() => {});
      hostRef.current = null;
      agentRef.current = null;
    };
  }, []);

  const aiValue = useMemo(() => ({
    config: { protocol: 'openai-compatible', endpoint: 'http://127.0.0.1:4179/v1/chat/completions', model: 'fixture', apiKey: 'fixture-key' },
    gateway,
    isConfigured: true,
    fundingMode: 'byok',
  }), [gateway]);
  const capabilities = useMemo(() => ({ evidence: true, mechanism: true, representation: true, worldComposer: true }), []);
  const state = snapshot ? runtimeSummary(snapshot) : null;
  const agent = agentRef.current;
  return <AiProviderContext.Provider value={aiValue}>
    <main>
      <h1>Agent request contract harness</h1>
      <p data-harness-renders>parent renders {tick}</p>
      <p data-harness-proposal-calls>proposal calls {proposalCalls}</p>
      <p data-harness-execute-calls>execute calls {executeCalls}</p>
      <pre data-harness-runtime-state>{JSON.stringify(state)}</pre>
      <pre data-harness-execution-transitions>{JSON.stringify(executionTransitions)}</pre>
      <pre data-harness-faults>{JSON.stringify(faults)}</pre>
      <button type="button" data-action="parent-rerender" onClick={() => setTick((value) => value + 1)}>Parent rerender</button>
      {snapshot && agent && <ExploreAgentSurface
        snapshot={snapshot}
        agent={agent}
        capabilities={capabilities}
        compact={false}
        onClose={() => {}}
        onDepthChange={() => {}}
        onOpenAiSettings={() => {}}
        host={hostRef.current}
        closeRef={{ current: null }}
        onAskAboutSelection={() => {}}
        onIlluminateConcept={() => {}}
        onBusyChange={() => {}}
        onRequestLifecycle={() => {}}
        t={t}
      />}
    </main>
  </AiProviderContext.Provider>;
}
