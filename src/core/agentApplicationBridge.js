import { AGENT_APPLICATION_API_VERSION, AGENT_APPLICATION_GLOBAL } from './agentApplicationApi.js';

/** Install the restricted request bridge for a mounted local application. */
export function installAgentApplicationBridge(api, target = globalThis) {
  if (!api || api.apiVersion !== AGENT_APPLICATION_API_VERSION || typeof api.request !== 'function') {
    throw new TypeError('Agent Application API bridge requires a version 1 request API.');
  }
  const previous = target[AGENT_APPLICATION_GLOBAL];
  const bridge = Object.freeze({
    apiVersion: AGENT_APPLICATION_API_VERSION,
    request: (envelope) => api.request(envelope),
  });
  target[AGENT_APPLICATION_GLOBAL] = bridge;
  let installed = true;
  return () => {
    if (!installed) return;
    installed = false;
    if (target[AGENT_APPLICATION_GLOBAL] !== bridge) return;
    if (previous === undefined) delete target[AGENT_APPLICATION_GLOBAL];
    else target[AGENT_APPLICATION_GLOBAL] = previous;
  };
}
