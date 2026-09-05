import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LUMI_COMPANION_STATES,
  LUMI_SEMANTIC_TARGETS,
  normalizeLumiSemanticTarget,
  resolveLumiCompanionState,
} from '../src/core/ui/lumiCompanion.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

assert.equal(resolveLumiCompanionState(), LUMI_COMPANION_STATES.AMBIENT);
assert.equal(resolveLumiCompanionState({ askBusy: true }), LUMI_COMPANION_STATES.THINK);
assert.equal(resolveLumiCompanionState({ semanticTarget: 'world.sample' }), LUMI_COMPANION_STATES.GUIDE);
assert.equal(resolveLumiCompanionState({ semanticAction: 'OBSERVE' }), LUMI_COMPANION_STATES.OBSERVE);
assert.equal(resolveLumiCompanionState({ meaningfulResult: true }), LUMI_COMPANION_STATES.NOTICE);
assert.equal(resolveLumiCompanionState({ recentConceptEvent: { type: 'concept.evidenced', conceptId: 'SAMPLING_VARIABILITY' } }), LUMI_COMPANION_STATES.ILLUMINATE);
assert.equal(normalizeLumiSemanticTarget('document.querySelector'), null);
assert.deepEqual([...LUMI_SEMANTIC_TARGETS].sort(), ['continuation.next', 'evidence.current', 'experiment.compare', 'ideas.map', 'model.fit', 'world.canvas', 'world.sample'].sort());

const component = read('src/components/playground/LumiCompanion.jsx');
assert.ok(component.includes('data-lumi-companion-panel'), 'companion panel is explicit and bounded');
assert.ok(component.includes('role="dialog"'), 'companion panel has an accessible dialog boundary');
assert.ok(component.includes('Escape'), 'companion closes with Escape');
assert.ok(component.includes('onSelectContinuation'), 'continuations remain proposal-only');
assert.ok(component.includes('data-lumi-notification'), 'meaningful events have a notification indicator');

const lumi = read('src/components/playground/Lumi.jsx');
for (const asset of ['lumi-ambient.png', 'lumi-observe.png', 'lumi-think.png', 'lumi-guide.png', 'lumi-illuminate.png']) {
  assert.ok(lumi.includes(asset), `asset mapping includes ${asset}`);
  const file = path.join(root, 'src/assets/lumi', asset);
  assert.ok(fs.existsSync(file), `asset exists: ${asset}`);
  const signature = fs.readFileSync(file).subarray(0, 8);
  assert.deepEqual([...signature], [137, 80, 78, 71, 13, 10, 26, 10], `${asset} is a PNG`);
}

const state = { evidence: { status: 'evidenced' }, world: { id: 'W' }, experiment: { id: 'E' } };
const before = JSON.stringify(state);
resolveLumiCompanionState({ recentConceptEvent: { conceptId: 'SAMPLING_VARIABILITY' }, semanticTarget: 'ideas.map' });
assert.equal(JSON.stringify(state), before, 'resolver is presentation-only and cannot mutate inquiry truth');

console.log('LUMI embodied companion checks passed');
