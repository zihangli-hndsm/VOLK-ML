import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const workspace = read('src/components/playground/DataWorkspace.jsx');
const companion = read('src/components/playground/LumiCompanion.jsx');
const details = read('src/components/playground/ExploreDetailsRegion.jsx');
const microscope = read('src/components/playground/TrainingMicroscopePanel.jsx');
const main = read('src/main.jsx');
const locales = read('src/locales/ui.js');

assert.match(workspace, /useState\(phenomenonMode \? 'select' : 'brush'\)/, 'Explore defaults to brush');
assert.match(workspace, /useState\(2\)/, 'brush density starts low');
assert.match(microscope, /grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4/, 'microscope parameters stack in narrow panels');
assert.match(companion, /data-lumi-companion/, 'persistent LUMI companion is present');
assert.match(companion, /data-lumi-body-state/, 'companion exposes semantic body state');
const runtimeSource = read('src/components/playground/UnifiedPlaygroundDialog.jsx');
assert.match(runtimeSource, /function illuminateConcept\(conceptId\)/, 'auto-illumination uses a hoisted callable boundary');
assert.equal(runtimeSource.includes('const illuminateConcept ='), false, 'auto-illumination is not backed by an uninitialized const');
assert.match(details, /<LumiCompanion/, 'Explore mounts the companion');
assert.match(details, /data-secondary-inquiry-surfaces/, 'Ideas map remains reachable through the companion');
assert.match(main, /restoreCandidate && surface === UI_SURFACES\.BUILD/, 'Build owns saved-project resume prompt');
assert.match(locales, /playground\.lumi\.companion\.ask.*Ask LUMI/, 'Ask LUMI copy is localized');
assert.match(locales, /playground\.lifecycle\.run.*Fit current data/, 'current-data action copy is localized');
console.log('Phase A.7 companion and Explore cleanup checks passed');
