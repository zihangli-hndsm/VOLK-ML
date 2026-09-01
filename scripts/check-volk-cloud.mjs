import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { CLOUD_AVAILABILITY, checkVolkCloudHealth, createVolkCloudClient, createVolkCloudClientForConfig, normalizeVolkApiUrl, resolveVolkCloudConfig } from '../src/services/volkCloud/index.js';

assert.equal(normalizeVolkApiUrl('http://localhost:8000///'), 'http://localhost:8000', 'Cloud URL normalization removes only trailing slashes');
assert.equal(normalizeVolkApiUrl(''), 'http://127.0.0.1:8000', 'Cloud URL falls back to the local development backend');
const productionWithoutConfig = resolveVolkCloudConfig({ mode: 'production', apiUrl: '' });
assert.equal(productionWithoutConfig.status, CLOUD_AVAILABILITY.NOT_CONFIGURED, 'production without an API URL is not-configured');
assert.equal(productionWithoutConfig.apiUrl, null, 'production without an API URL has no endpoint');
let productionFetchCalls = 0;
assert.equal(createVolkCloudClientForConfig(productionWithoutConfig, {
  fetchImpl: async () => { productionFetchCalls += 1; },
}), null, 'production without an API URL creates no Cloud client');
assert.equal(productionFetchCalls, 0, 'production without an API URL makes no fetch call');

const developmentWithoutConfig = resolveVolkCloudConfig({ mode: 'development', apiUrl: '' });
assert.equal(developmentWithoutConfig.apiUrl, 'http://127.0.0.1:8000', 'development without an API URL uses the local backend default');
const productionWithConfig = resolveVolkCloudConfig({ mode: 'production', apiUrl: 'https://api.example.com///' });
assert.equal(productionWithConfig.apiUrl, 'https://api.example.com', 'configured production endpoints are normalized and preserved');

let requestedUrl = null;
const healthyClient = createVolkCloudClient({
  baseUrl: 'http://127.0.0.1:8000/',
  fetchImpl: async (url) => {
    requestedUrl = url;
    return { ok: true, status: 200, async json() { return { status: 'ok', service: 'volk-dev-backend', apiVersion: '0' }; } };
  },
});
const healthy = await checkVolkCloudHealth(healthyClient);
assert.equal(requestedUrl, 'http://127.0.0.1:8000/health', 'health requests use the configured Cloud client endpoint');
assert.equal(healthy.status, CLOUD_AVAILABILITY.AVAILABLE, 'a healthy backend is exposed as available');
assert.equal(healthy.apiVersion, '0');

const unavailable = await checkVolkCloudHealth(createVolkCloudClient({
  baseUrl: 'http://127.0.0.1:65534',
  fetchImpl: async () => { throw new Error('connection refused'); },
}));
assert.equal(unavailable.status, CLOUD_AVAILABILITY.UNAVAILABLE, 'a failed health request is a non-blocking unavailable capability');

const host = createPlaygroundHost({ getDataset: () => null });
await host.open({ playgroundId: 'linear-regression', seed: 41 });
const before = host.getState();
await checkVolkCloudHealth(createVolkCloudClient({ fetchImpl: async () => { throw new Error('offline'); } }));
const after = host.getState();
assert.deepEqual(after.world, before.world, 'backend failure does not mutate the active World');
assert.deepEqual(after.experiment, before.experiment, 'backend failure does not mutate the active Experiment');
assert.deepEqual(after.observations, before.observations, 'backend failure does not mutate local Evidence');
await host.close();

const backendSource = readFileSync(new URL('../dev/backend/server.py', import.meta.url), 'utf8');
assert.match(backendSource, /"\/health"/);
assert.match(backendSource, /http:\/\/localhost:5173/);
assert.match(backendSource, /http:\/\/127\.0\.0\.1:5173/);
assert.match(backendSource, /"apiVersion": "0"/);

const launcherSource = readFileSync(new URL('./start-backend.mjs', import.meta.url), 'utf8');
assert.match(launcherSource, /\['py', \['-3'/, 'Windows tries the py launcher first');
assert.match(launcherSource, /\['python', backendArgs\]/, 'Windows falls back to python');
assert.match(launcherSource, /error\.code === 'ENOENT'/, 'launcher only falls back when the executable is missing');

const packageSource = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
assert.match(packageSource, /"dev:all"/);
assert.match(packageSource, /"test:local"/);
assert.match(packageSource, /"check:local-backend"/);
console.log('VOLK Cloud checks passed: URL abstraction, healthy/unavailable states, local runtime independence, health contract, and developer commands.');
