import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveLumiContextBubblePlacement } from '../src/core/ui/lumiContextBubblePlacement.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const cases = [
  { name: 'desktop', viewport: { width: 1280, height: 720 }, anchor: { left: 1200, top: 632, width: 64, height: 60 }, bubble: { width: 260, height: 72 } },
  { name: 'narrow phone', viewport: { width: 390, height: 844 }, anchor: { left: 316, top: 770, width: 64, height: 60 }, bubble: { width: 288, height: 80 } },
  { name: 'short window', viewport: { width: 1280, height: 300 }, anchor: { left: 1200, top: 212, width: 64, height: 60 }, bubble: { width: 260, height: 180 } },
  { name: 'small visual viewport after zoom', viewport: { left: 0, top: 0, width: 640, height: 360 }, anchor: { left: 564, top: 292, width: 64, height: 60 }, bubble: { width: 500, height: 100 } },
  { name: 'offset visual viewport', viewport: { left: 30, top: 24, width: 390, height: 280 }, anchor: { left: 338, top: 210, width: 64, height: 60 }, bubble: { width: 270, height: 90 } },
  { name: 'top edge uses side placement', viewport: { width: 1280, height: 300 }, anchor: { left: 900, top: 20, width: 64, height: 60 }, bubble: { width: 220, height: 80 }, expected: 'left' },
  { name: 'top edge uses below placement when sides are bounded', viewport: { width: 390, height: 280 }, anchor: { left: 318, top: 12, width: 64, height: 60 }, bubble: { width: 270, height: 120 }, expected: 'below-right' },
];

for (const entry of cases) {
  const layout = resolveLumiContextBubblePlacement(entry);
  assert.equal(layout.visible, true, `${entry.name} should have a visible safe placement`);
  if (entry.expected) assert.equal(layout.id, entry.expected, `${entry.name} should choose a safe alternate anchor`);
  const box = { left: layout.left, top: layout.top, right: layout.left + layout.width, bottom: layout.top + layout.height };
  const anchor = { left: entry.anchor.left, top: entry.anchor.top, right: entry.anchor.left + entry.anchor.width, bottom: entry.anchor.top + entry.anchor.height };
  const bounds = { left: (entry.viewport.left ?? 0) + 8, top: (entry.viewport.top ?? 0) + 8, right: (entry.viewport.left ?? 0) + entry.viewport.width - 8, bottom: (entry.viewport.top ?? 0) + entry.viewport.height - 8 };
  assert.equal(intersects(box, anchor), false, `${entry.name} prompt must not overlap the LUMI image`);
  assert.ok(box.left >= bounds.left && box.top >= bounds.top && box.right <= bounds.right && box.bottom <= bounds.bottom, `${entry.name} prompt must stay inside the visual viewport`);
}

const impossible = resolveLumiContextBubblePlacement({
  viewport: { width: 100, height: 60 },
  anchor: { left: 20, top: 0, width: 80, height: 60 },
  bubble: { width: 90, height: 50 },
});
assert.equal(impossible.visible, false, 'an impossible viewport must hide rather than occlude the character');

const component = read('src/components/playground/LumiCompanion.jsx');
const styles = read('src/index.css');
const harness = read('r148-lifecycle-harness.html');
assert.ok(component.includes('visualViewport?.addEventListener'), 'placement responds to browser visual viewport changes');
assert.ok(component.includes('new ResizeObserver(place)'), 'placement responds to actual avatar and bubble geometry changes');
assert.ok(component.includes('data-lumi-context-placement'), 'mounted placement is observable to browser acceptance');
assert.ok(styles.includes('.lumi-context-bubble { position: fixed;'), 'context bubble uses viewport coordinates');
assert.ok(styles.includes('pointer-events: auto;'), 'context bubble dismiss remains directly usable');
assert.ok(harness.includes('href="/src/index.css"'), 'mounted lifecycle harness loads the production stylesheet');

console.log('LUMI context bubble geometry checks passed');
