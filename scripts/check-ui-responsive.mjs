import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PRESENTATION_BANDS,
  classifyPresentationCapabilities,
  deriveUiPresentation,
} from '../src/core/ui/uiArchitecture.js';

const unknown = classifyPresentationCapabilities();
assert.equal(unknown.band, PRESENTATION_BANDS.UNKNOWN, 'presentation stays unknown before measurement');
assert.equal(unknown.inspectorPresentation, 'unresolved');

const compact = classifyPresentationCapabilities({ containerWidth: 390, containerHeight: 844, pointer: 'coarse', hover: 'none' });
assert.equal(compact.band, PRESENTATION_BANDS.COMPACT);
assert.equal(compact.orientation, 'portrait');
assert.equal(compact.inspectorPresentation, 'bottom-sheet');
assert.equal(compact.pointer, 'coarse');
assert.equal(compact.hover, 'none');

const landscape = classifyPresentationCapabilities({ containerWidth: 844, containerHeight: 390, pointer: 'coarse', hover: 'none' });
assert.equal(landscape.band, PRESENTATION_BANDS.MEDIUM);
assert.equal(landscape.orientation, 'landscape');

const medium = classifyPresentationCapabilities({ containerWidth: 768, containerHeight: 1024, pointer: 'fine', hover: 'available' });
assert.equal(medium.band, PRESENTATION_BANDS.MEDIUM);
assert.equal(medium.inspectorPresentation, 'drawer-or-sidebar');
assert.equal(medium.pointer, 'fine');

const wide = classifyPresentationCapabilities({ containerWidth: 1440, containerHeight: 900, pointer: 'fine', hover: 'available' });
assert.equal(wide.band, PRESENTATION_BANDS.WIDE);
assert.equal(wide.orientation, 'landscape');
assert.equal(wide.inspectorPresentation, 'drawer-or-sidebar');

const runtime = { id: 'shared-runtime-snapshot' };
assert.equal(deriveUiPresentation({ snapshot: runtime, rawCapabilities: { containerWidth: 390 } }).runtime, runtime, 'responsive presentation reuses runtime identity');
assert.equal(deriveUiPresentation({ snapshot: runtime, rawCapabilities: { containerWidth: 1440 } }).runtime, runtime, 'resizing does not create semantic state');

const hookSource = readFileSync(new URL('../src/components/playground/usePresentationCapabilities.jsx', import.meta.url), 'utf8');
const boundarySource = readFileSync(new URL('../src/components/playground/PlaygroundPresentationBoundary.jsx', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/components/playground/ExploreWorldRegion.jsx', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../src/components/playground/DataWorkspace.jsx', import.meta.url), 'utf8');
const dialogSource = readFileSync(new URL('../src/components/playground/UnifiedPlaygroundDialog.jsx', import.meta.url), 'utf8');
assert.ok(hookSource.includes('ResizeObserver'), 'capabilities use container measurement');
assert.ok(hookSource.includes('matchMedia'), 'capabilities use input media queries');
assert.ok(!hookSource.includes('userAgent') && !hookSource.includes('navigator.userAgent'), 'capabilities do not use UA detection');
assert.ok(boundarySource.includes('data-ui-pointer={presentation.responsive.pointer}'), 'boundary publishes input capability');
assert.ok(worldSource.includes('bottom-0') && worldSource.includes('w-[min(300px,calc(100%-1rem))]'), 'Inspector has compact sheet and larger drawer presentations');
assert.ok(workspaceSource.includes('touch-none') && workspaceSource.includes('setPointerCapture'), 'World canvas preserves explicit touch gesture semantics');
assert.ok(dialogSource.includes('overflow-hidden bg-slate-950/55 p-0 sm:p-5'), 'dialog removes compact outer padding');

console.log('UI-2 responsive and touch foundation checks passed');
