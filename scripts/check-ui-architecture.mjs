import assert from 'node:assert/strict';
import {
  CONCEPTUAL_DEPTHS,
  PRESENTATION_BANDS,
  UI_RESPONSIBILITY_MAP,
  UI_MIGRATION_SEAMS,
  UI_SURFACES,
  classifyPresentationCapabilities,
  createUiPresentationState,
  deriveUiPresentation,
  getConceptualDepthDescriptor,
  getSurfaceDescriptor,
} from '../src/core/ui/uiArchitecture.js';
import {
  EXPLORATION_EVENT_TYPES,
  createExplorationEvent,
  createMemoryExplorationTelemetry,
  createExplorationOpenTracker,
  safeTrackExplorationEvent,
  trackExplorationEvent,
} from '../src/core/telemetry/explorationTelemetry.js';

assert.deepEqual(Object.values(UI_SURFACES), ['explore', 'build']);
assert.equal(getSurfaceDescriptor('explore').stateAuthority, 'shared-runtime');
assert.equal(getSurfaceDescriptor('build').stateAuthority, 'shared-runtime');
assert.equal(getConceptualDepthDescriptor(CONCEPTUAL_DEPTHS.MECHANISM).order, 2);
assert.throws(() => getConceptualDepthDescriptor('beginner'), /Unknown conceptual depth/);

assert.equal(classifyPresentationCapabilities({ containerWidth: 390 }).band, PRESENTATION_BANDS.COMPACT);
assert.equal(classifyPresentationCapabilities({ containerWidth: 800, pointer: 'coarse' }).band, PRESENTATION_BANDS.MEDIUM);
assert.equal(classifyPresentationCapabilities({ containerWidth: 1440, pointer: 'fine', hover: 'available' }).band, PRESENTATION_BANDS.WIDE);
assert.deepEqual(classifyPresentationCapabilities({ containerWidth: 390, pointer: 'coarse', hover: 'none', orientation: 'portrait' }), {
  band: 'compact',
  containerWidth: 390,
  pointer: 'coarse',
  hover: 'none',
  orientation: 'portrait',
  inspectorPresentation: 'bottom-sheet',
  comparePresentation: 'overlay-or-swipe',
});
assert.equal(classifyPresentationCapabilities({ containerWidth: 844, orientation: 'landscape' }).band, PRESENTATION_BANDS.MEDIUM);
assert.equal(classifyPresentationCapabilities({ containerWidth: 1024, orientation: 'landscape' }).band, PRESENTATION_BANDS.WIDE);
assert.equal(classifyPresentationCapabilities({ containerWidth: 390 }).inspectorPresentation, 'bottom-sheet');
assert.equal(classifyPresentationCapabilities({ containerWidth: 1440 }).comparePresentation, 'side-by-side');
assert.equal(classifyPresentationCapabilities().band, PRESENTATION_BANDS.UNKNOWN);
assert.equal(classifyPresentationCapabilities().inspectorPresentation, 'unresolved');
assert.equal(classifyPresentationCapabilities().comparePresentation, 'unresolved');

const runtime = { experiment: { id: 'one' }, world: { observations: [{ id: 'p1' }] } };
const presentation = deriveUiPresentation({ snapshot: runtime, surface: 'explore', depth: 'evidence' });
assert.equal(presentation.runtime, runtime, 'presentation adapter reuses the shared semantic state');
assert.equal(presentation.surface, 'explore');
assert.equal(presentation.depth, 'evidence');
assert.equal(createUiPresentationState({ surface: 'build', depth: 'builder' }).responsive.band, 'unknown');
assert.equal(createUiPresentationState({ rawCapabilities: { containerWidth: 390 } }).responsive.band, 'compact');
assert.equal(createUiPresentationState({ rawCapabilities: { containerWidth: 1440, pointer: 'fine' } }).responsive.band, 'wide');
assert.throws(() => createUiPresentationState({ capabilities: { containerWidth: 390 } }), /capabilities is ambiguous/);
assert.throws(() => createUiPresentationState({ rawCapabilities: { containerWidth: 390 }, resolvedPresentation: { band: 'compact' } }), /not both/);
assert.equal(createUiPresentationState({ resolvedPresentation: classifyPresentationCapabilities({ containerWidth: 390 }) }).responsive.band, 'compact');
assert.equal(UI_RESPONSIBILITY_MAP.experiment.owner, 'explore');
assert.equal(UI_RESPONSIBILITY_MAP.build.owner, 'build');
for (const seam of ['contextBar', 'worldSurface', 'experimentBar', 'depthDisclosure', 'agentEntry', 'buildEntry']) {
  assert.equal(UI_MIGRATION_SEAMS[seam].owner.length > 0, true);
  assert.equal(UI_MIGRATION_SEAMS[seam].current.length > 0, true);
}

const telemetry = createMemoryExplorationTelemetry();
for (const type of EXPLORATION_EVENT_TYPES) {
  const payload = type === 'repeat_requested' ? { trials: 3 }
    : type === 'world_point_moved' ? { scope: 'train' }
      : type === 'first_meaningful_manipulation' ? { domain: 'world' }
        : type === 'exploration_opened' ? { surface: 'explore', playgroundId: 'linear-regression' }
          : type === 'experiment_compared' ? { changedFactors: ['world'] }
            : type === 'guided_prompt_accepted' ? { promptId: 'coverage' }
              : {};
  trackExplorationEvent(createExplorationEvent(type, payload), telemetry);
}
assert.equal(telemetry.getEvents().length, EXPLORATION_EVENT_TYPES.length);
assert.throws(() => createExplorationEvent('mousemove', {}), /Invalid exploration telemetry event/);
assert.throws(() => createExplorationEvent('world_point_moved', { scope: 'train', x: 1 }), /Invalid exploration telemetry field/);
assert.throws(() => createExplorationEvent('repeat_requested', { trials: 0 }), /Invalid exploration telemetry field/);
assert.throws(() => createExplorationEvent('exploration_opened', { surface: 'explore', playgroundId: 'learner entered a very long free-form phrase' }), /Invalid exploration telemetry field/);
assert.throws(() => createExplorationEvent('exploration_opened', { surface: 'explore', playgroundId: 'not/a-valid-id with spaces' }), /Invalid exploration telemetry field/);
assert.throws(() => createExplorationEvent('experiment_compared', { changedFactors: Array.from({ length: 17 }, () => 'world') }), /Invalid exploration telemetry field/);
assert.doesNotThrow(() => createExplorationEvent('exploration_opened', { surface: 'explore', playgroundId: 'linear-regression', bigIdeaId: 'distribution-shift:v1' }));
assert.doesNotThrow(() => JSON.stringify(telemetry.getEvents()));

const failingTelemetry = { track() { throw new Error('telemetry unavailable'); } };
assert.equal(safeTrackExplorationEvent(createExplorationEvent('depth_evidence_opened'), failingTelemetry), false);
assert.doesNotThrow(() => safeTrackExplorationEvent(createExplorationEvent('depth_evidence_opened'), failingTelemetry));

const openTracker = createExplorationOpenTracker();
assert.equal(openTracker.claim('session-1'), true);
assert.equal(openTracker.claim('session-1'), false);
assert.equal(openTracker.claim('session-2'), true);
assert.throws(() => openTracker.claim(''), /session key/);

console.log('UI architecture checks passed');
