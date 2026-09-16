$ErrorActionPreference = 'Stop'
node scripts/agent-request-cdp-browser.mjs
exit $LASTEXITCODE
