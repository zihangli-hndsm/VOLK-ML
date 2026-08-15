import { PLAYGROUND_ERROR_CODES } from './playgrounds/session.js';
import { SCRIPT_ERROR_CODES } from './playground/visualization/scriptErrors.js';
export { getAgentExamples, listAgentExamplePlaygroundIds } from './playground/agent/agentExamples.js';
export { buildTeachingInterpretationContext, createLlmGoalInterpreter, LLM_PROVIDERS } from './playground/agent/llmGoalInterpreter.js';
export { createExplorationAiInterpreter, explorationIntentIds } from './exploration/explorationAiInterpreter.js';

const copy = (value) => structuredClone(value);

function normalizePlaygroundError(error) {
  const knownCodes = new Set([...PLAYGROUND_ERROR_CODES, ...SCRIPT_ERROR_CODES]);
  if (error && typeof error === 'object' && knownCodes.has(error.code)) {
    const normalized = new Error(error.code);
    normalized.code = error.code;
    normalized.details = error.details ?? {};
    return normalized;
  }
  const wrapped = new Error('OPERATION_FAILED');
  wrapped.code = 'OPERATION_FAILED';
  wrapped.details = {
    message: error?.message ?? String(error),
    causeCode: error?.code ?? 'Error',
  };
  return wrapped;
}

const invoke = (operation, callback) => {
  try { return callback(); } catch (error) { throw normalizePlaygroundError(error); }
};

const invokeAsync = async (operation, callback) => {
  try { return await callback(); } catch (error) { throw normalizePlaygroundError(error); }
};

export function createPlaygroundAgentApi(host) {
  const agentAction = (action) => {
    const next = copy(action);
    if (next.type === 'APPLY_WORLD_TRANSACTION') {
      next.transaction = { ...(next.transaction ?? {}), actor: next.transaction?.actor ?? 'agent' };
    } else {
      next.actor = next.actor ?? 'agent';
    }
    return next;
  };
  return Object.freeze({
    apiVersion: 1,
    list: () => invoke('list', () => copy(host.list())),
    listBigIdeaEntrances: () => invoke('listBigIdeaEntrances', () => copy(host.listBigIdeaEntrances())),
    open: (request) => invokeAsync('open', async () => copy(await host.open(copy(request ?? {})))),
    openBigIdeaEntrance: (request) => invokeAsync('openBigIdeaEntrance', async () => copy(await host.openBigIdeaEntrance(copy(request ?? {})))),
    restartBigIdeaEntrance: (request) => invokeAsync('restartBigIdeaEntrance', async () => copy(await host.restartBigIdeaEntrance(copy(request ?? {})))),
    getState: () => invoke('getState', () => copy(host.getState())),
    dispatch: (action) => invokeAsync('dispatch', async () => copy(await host.dispatch(agentAction(action)))),
    play: () => invokeAsync('play', async () => copy(await host.play())),
    pause: () => invokeAsync('pause', async () => copy(await host.pause())),
    step: () => invokeAsync('step', async () => copy(await host.step())),
    seek: (step) => invokeAsync('seek', async () => copy(await host.seek(Number(step)))),
    reset: () => invokeAsync('reset', async () => copy(await host.reset())),
    runScenario: (scenarioId) => invokeAsync('runScenario', async () => copy(await host.runScenario(String(scenarioId)))),
    getCapabilities: () => invoke('getCapabilities', () => copy(host.getCapabilities())),
    inspectContext: (options = {}) => invoke('inspectContext', () => {
      const context = copy(host.inspectContext());
      const presentation = options?.presentation;
      if (presentation && typeof presentation === 'object' && !Array.isArray(presentation)) {
        context.presentation = {
          currentDepth: presentation.currentDepth ?? null,
          comparisonActive: Boolean(presentation.comparisonActive),
          availableDepths: Array.isArray(presentation.availableDepths) ? [...presentation.availableDepths] : [],
        };
      }
      return context;
    }),
    proposeExploration: (request) => invoke('proposeExploration', () => copy(host.proposeExploration(typeof request === 'string' ? { request } : copy(request ?? {})))),
    proposeCleanerComparison: () => invoke('proposeCleanerComparison', () => copy(host.proposeCleanerComparison())),
    preflightExplorationScenario: (scenario) => invoke('preflightExplorationScenario', () => copy(host.preflightExplorationScenario({ scenario: copy(scenario) }))),
    executeExploration: (scenario) => invokeAsync('executeExploration', async () => copy(await host.executeExploration({ scenario: copy(scenario) }))),
    createExplorationThread: (request) => invoke('createExplorationThread', () => copy(host.createExplorationThread(copy(request ?? {})))),
    setActiveExplorationThread: (threadId) => invoke('setActiveExplorationThread', () => copy(host.setActiveExplorationThread(threadId))),
    addExplorationThreadQuestion: (request) => invoke('addExplorationThreadQuestion', () => copy(host.addExplorationThreadQuestion(copy(request ?? {})))),
    addExplorationThreadPrediction: (request) => invoke('addExplorationThreadPrediction', () => copy(host.addExplorationThreadPrediction(copy(request ?? {})))),
    recordExplorationThreadExperiment: (request) => invoke('recordExplorationThreadExperiment', () => copy(host.recordExplorationThreadExperiment(copy(request ?? {})))),
    recordExplorationThreadObservation: (request) => invoke('recordExplorationThreadObservation', () => copy(host.recordExplorationThreadObservation(copy(request ?? {})))),
    removeExplorationThreadEntry: (entryId) => invoke('removeExplorationThreadEntry', () => copy(host.removeExplorationThreadEntry(entryId))),
    resumeExplorationThreadExperiment: (entryId) => invoke('resumeExplorationThreadExperiment', () => copy(host.resumeExplorationThreadExperiment(entryId))),
    listPresets: () => invoke('listPresets', () => copy(host.listPresets())),
    loadPreset: (request) => invokeAsync('loadPreset', async () => copy(await host.loadPreset(copy(request ?? {})))),
    validateScript: (script) => invoke('validateScript', () => copy(host.validateScript(copy(script)))),
    loadScript: (script) => invokeAsync('loadScript', async () => copy(await host.loadScript(copy(script)))),
    getScript: () => invoke('getScript', () => copy(host.getScript())),
    exportScript: () => invoke('exportScript', () => copy(host.exportScript())),
    dryRunScript: (script) => invoke('dryRunScript', () => copy(host.dryRunScript(copy(script)))),
    generateScript: (request) => invokeAsync('generateScript', async () => copy(await host.generateScript(copy(request ?? {})))),
    plan: (goal) => invokeAsync('plan', async () => copy(await host.plan({ goal }))),
    composeScript: (plan) => invokeAsync('composeScript', async () => copy(await host.composeScript({ plan: copy(plan) }))),
    reviseScript: (request) => invokeAsync('reviseScript', async () => copy(await host.reviseScript(copy(request ?? {})))),
    refreshSource: () => invokeAsync('refreshSource', async () => copy(await host.refreshSource())),
    close: () => invokeAsync('close', async () => { await host.close(); return null; }),
    subscribe(listener) {
      return invoke('subscribe', () => host.subscribe((snapshot) => listener(copy(snapshot))));
    },
  });
}
