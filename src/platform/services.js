export const PLATFORM_API_VERSION = 1;

const unavailable = (capability) => {
  const error = new Error(`Platform capability is unavailable: ${capability}`);
  error.code = 'PLATFORM_CAPABILITY_UNAVAILABLE';
  error.capability = capability;
  return error;
};

export function createLocalPlatformServices() {
  return Object.freeze({
    apiVersion: PLATFORM_API_VERSION,
    id: 'local',
    account: Object.freeze({
      async getCurrentUser() { return null; },
      async getEntitlements() {
        return {
          plan: 'local',
          cloudProjects: false,
          collaboration: false,
          remoteCompute: false,
        };
      },
    }),
    projects: Object.freeze({
      mode: 'local-file',
      async list() { return []; },
      async load() { throw unavailable('projects.load'); },
      async save() { throw unavailable('projects.save'); },
      async remove() { throw unavailable('projects.remove'); },
    }),
    collaboration: Object.freeze({
      available: false,
      async connect() { throw unavailable('collaboration.connect'); },
    }),
    compute: Object.freeze({
      targets: Object.freeze(['browser-cpu']),
      canExecuteInBrowser(plan) {
        return plan.recommendedTier === 'L0' && plan.browserBackendComplete;
      },
      async submit() { throw unavailable('compute.submit'); },
      async getJob() { throw unavailable('compute.getJob'); },
      async cancelJob() { throw unavailable('compute.cancelJob'); },
    }),
  });
}

export function validatePlatformServices(services) {
  if (!services || services.apiVersion !== PLATFORM_API_VERSION) {
    throw new Error(`VOLK-ML platform services must implement API v${PLATFORM_API_VERSION}.`);
  }
  const requiredMethods = [
    ['account', 'getCurrentUser'],
    ['account', 'getEntitlements'],
    ['projects', 'list'],
    ['projects', 'load'],
    ['projects', 'save'],
    ['projects', 'remove'],
    ['collaboration', 'connect'],
    ['compute', 'canExecuteInBrowser'],
    ['compute', 'submit'],
    ['compute', 'getJob'],
    ['compute', 'cancelJob'],
  ];
  requiredMethods.forEach(([service, method]) => {
    if (typeof services[service]?.[method] !== 'function') {
      throw new Error(`VOLK-ML platform services are missing ${service}.${method}().`);
    }
  });
  if (!Array.isArray(services.compute.targets)) {
    throw new Error('VOLK-ML platform services must declare compute.targets.');
  }
  return services;
}

export function resolvePlatformServices(candidate = globalThis.__VOLK_ML_PLATFORM_SERVICES__) {
  return candidate
    ? validatePlatformServices(candidate)
    : createLocalPlatformServices();
}
