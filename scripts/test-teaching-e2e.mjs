const report = {
  version: 1,
  status: 'NOT VERIFIED',
  mode: 'browser-e2e',
  reason: 'safe-browser-runner-unavailable',
  hostIntegrationCommand: 'npm run test:teaching:integration',
  browser: 'NOT VERIFIED',
};

console.log(JSON.stringify(report));
process.exitCode = 2;
