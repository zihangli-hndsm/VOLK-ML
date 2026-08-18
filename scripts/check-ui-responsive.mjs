import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PRESENTATION_BANDS,
  classifyPresentationCapabilities,
  deriveUiPresentation,
} from '../src/core/ui/uiArchitecture.js';
import {
  clientToLocalPoint,
  clientToSvgPoint,
  nearestPointInLocal,
} from '../src/components/playground/dataWorkspaceGeometry.js';

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

const anisotropicBounds = { xMin: -100, xMax: 100, yMin: -1, yMax: 1 };
const anisotropicPoints = [{ id: 'near', x: 0, y: 0 }, { id: 'far', x: 20, y: 0.8 }];
const screenPoint = clientToSvgPoint({ clientX: 320, clientY: 180, rect: { left: 0, top: 0, width: 640, height: 360 } });
assert.deepEqual(screenPoint, { x: 320, y: 180 }, 'client coordinates map to SVG coordinates');
const localPoint = clientToLocalPoint({ clientX: 160, clientY: 90, rect: { left: 0, top: 0, width: 320, height: 180 } });
assert.deepEqual(localPoint, { x: 160, y: 90 }, 'client coordinates map to local screen pixels');
const nearestAnisotropic = nearestPointInLocal({ points: anisotropicPoints, position: { x: 165.5, y: 85 }, xFeature: 'x', yFeature: 'y', bounds: anisotropicBounds, rect: { left: 0, top: 0, width: 320, height: 180 } });
assert.equal(nearestAnisotropic.point.id, 'near', 'anisotropic World selection uses screen/SVG distance');
assert.ok(nearestAnisotropic.distancePx < 22, 'coarse touch radius remains a bounded screen-space target');
const farAnisotropic = nearestPointInLocal({ points: anisotropicPoints, position: { x: 194.5, y: 40 }, xFeature: 'x', yFeature: 'y', bounds: anisotropicBounds, rect: { left: 0, top: 0, width: 320, height: 180 } });
assert.ok(farAnisotropic.distancePx > 10, 'fine pointer keeps a tighter target than the coarse affordance');

const hookSource = readFileSync(new URL('../src/components/playground/usePresentationCapabilities.jsx', import.meta.url), 'utf8');
const boundarySource = readFileSync(new URL('../src/components/playground/PlaygroundPresentationBoundary.jsx', import.meta.url), 'utf8');
const worldSource = readFileSync(new URL('../src/components/playground/ExploreWorldRegion.jsx', import.meta.url), 'utf8');
const depthSource = readFileSync(new URL('../src/components/playground/ExploreDetailsRegion.jsx', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../src/components/playground/DataWorkspace.jsx', import.meta.url), 'utf8');
const dialogSource = readFileSync(new URL('../src/components/playground/UnifiedPlaygroundDialog.jsx', import.meta.url), 'utf8');
const geometrySource = readFileSync(new URL('../src/components/playground/dataWorkspaceGeometry.js', import.meta.url), 'utf8');
assert.ok(hookSource.includes('ResizeObserver'), 'capabilities use container measurement');
assert.ok(hookSource.includes('matchMedia'), 'capabilities use input media queries');
assert.ok(!hookSource.includes('userAgent') && !hookSource.includes('navigator.userAgent'), 'capabilities do not use UA detection');
assert.ok(boundarySource.includes('data-ui-pointer={presentation.responsive.pointer}'), 'boundary publishes input capability');
assert.ok(depthSource.includes('bottom-0') && depthSource.includes('w-[min(300px,calc(100vw-2rem))]'), 'Depth/Inspector has compact sheet and stable 300px drawer presentation');
assert.ok(workspaceSource.includes('touch-none') && workspaceSource.includes('setPointerCapture'), 'World canvas preserves explicit touch gesture semantics');
assert.ok(workspaceSource.includes('const finishGesture') && workspaceSource.includes('onPointerUp') && workspaceSource.includes('dispatchTransaction'), 'gesture preview commits through one pointer-up transaction boundary');
assert.ok(dialogSource.includes('overflow-hidden') && dialogSource.includes('bg-slate-950/55') && dialogSource.includes('p-0 sm:p-5'), 'dialog removes compact outer padding');
assert.ok(dialogSource.includes('onPointerDown={(event) => event.stopPropagation()}'), 'full responsive frame stops pointer propagation to backdrop');
assert.ok(dialogSource.includes('onMouseDown={(event) => event.stopPropagation()}'), 'full responsive frame stops mouse propagation to backdrop');
assert.ok(geometrySource.includes('clientToLocalPoint') && geometrySource.includes('distancePx'), 'point hit testing is represented in local screen pixels');

console.log('UI-2 responsive and touch foundation checks passed');
