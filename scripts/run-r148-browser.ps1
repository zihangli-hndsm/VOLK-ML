$ErrorActionPreference = 'Stop'
$env:VITE_VOLK_TEACHING_DIALOGUE_PILOT = '1'
node scripts/r148-cdp-browser.mjs
exit $LASTEXITCODE
