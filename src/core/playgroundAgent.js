import { PLAYGROUND_ERROR_CODES } from './playgrounds/session.js';

const copy = (value) => structuredClone(value);

function normalizePlaygroundError(error) {
  if (error && typeof error === 'object' && PLAYGROUND_ERROR_CODES.includes(error.code)) {
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
  return Object.freeze({
    apiVersion: 1,
    list: () => invoke('list', () => copy(host.list())),
    open: (request) => invokeAsync('open', async () => copy(await host.open(copy(request ?? {})))),
    getState: () => invoke('getState', () => copy(host.getState())),
    dispatch: (action) => invokeAsync('dispatch', async () => copy(await host.dispatch(copy(action)))),
    play: () => invokeAsync('play', async () => copy(await host.play())),
    pause: () => invokeAsync('pause', async () => copy(await host.pause())),
    step: () => invokeAsync('step', async () => copy(await host.step())),
    seek: (step) => invokeAsync('seek', async () => copy(await host.seek(Number(step)))),
    reset: () => invokeAsync('reset', async () => copy(await host.reset())),
    runScenario: (scenarioId) => invokeAsync('runScenario', async () => copy(await host.runScenario(String(scenarioId)))),
    refreshSource: () => invokeAsync('refreshSource', async () => copy(await host.refreshSource())),
    close: () => invokeAsync('close', async () => { await host.close(); return null; }),
    subscribe(listener) {
      return invoke('subscribe', () => host.subscribe((snapshot) => listener(copy(snapshot))));
    },
  });
}
