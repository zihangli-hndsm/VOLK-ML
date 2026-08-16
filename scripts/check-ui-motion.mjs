import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MOTION_TOKENS, MOTION_EASINGS, REDUCED_MOTION_QUERY } from '../src/components/playground/motion.js';
import { PRESENTATION_FOCUS_OWNERS, resolvePresentationFocusOwner } from '../src/core/ui/presentationFocus.js';
import { deriveNewExperimentIds } from '../src/core/ui/presentationMotion.js';

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const motionSource = readFileSync(new URL('../src/components/playground/motion.js', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('../src/components/playground/DataWorkspace.jsx', import.meta.url), 'utf8');
const experimentSource = readFileSync(new URL('../src/components/playground/ExperimentBar.jsx', import.meta.url), 'utf8');
const detailsSource = readFileSync(new URL('../src/components/playground/ExploreDetailsRegion.jsx', import.meta.url), 'utf8');
const agentSource = readFileSync(new URL('../src/components/playground/ExploreAgentSurface.jsx', import.meta.url), 'utf8');
const dialogSource = readFileSync(new URL('../src/components/playground/UnifiedPlaygroundDialog.jsx', import.meta.url), 'utf8');

assert.deepEqual(Object.keys(MOTION_TOKENS), ['fast', 'normal', 'emphasis'], 'motion has the three shared semantic tokens');
assert.ok(MOTION_TOKENS.fast <= 150, 'fast motion remains short');
assert.ok(MOTION_TOKENS.normal <= 250, 'normal motion remains short');
assert.ok(MOTION_TOKENS.emphasis <= 350, 'emphasis motion remains bounded');
assert.equal(MOTION_EASINGS.standard, 'ease-out-cubic', 'primitive motion keeps the established semantic easing');
assert.equal(REDUCED_MOTION_QUERY, '(prefers-reduced-motion: reduce)', 'reduced-motion query is centralized');
for (const token of ['--motion-fast', '--motion-normal', '--motion-emphasis', '--motion-ease-standard']) {
  assert.ok(css.includes(token), `CSS exposes ${token}`);
}
assert.ok(css.includes('@media (prefers-reduced-motion: reduce)'), 'CSS has a reduced-motion contract');
assert.ok(css.includes('.ui-motion-interactive'), 'interactive motion uses a shared class');
assert.ok(css.includes('.ui-motion-overlay-enter'), 'overlay motion uses a shared class');
assert.ok(!css.includes('transition: all'), 'motion CSS does not use transition-all');

assert.ok(workspaceSource.includes('usePrimitiveMotion'), 'Phenomenon reuses primitive motion');
assert.ok(workspaceSource.includes('primitive.type === \'scatter\' ? primitive'), 'directly manipulated points remain on the current frame');
assert.ok(workspaceSource.includes("resolveMotionConfig(snapshot, reducedMotion, { token: 'normal' })"), 'Phenomenon uses the normal motion token');
assert.ok(!/Linear Regression|slope|regressionMath/i.test(workspaceSource), 'Phenomenon does not duplicate model math');

assert.ok(experimentSource.includes('previousExperimentIdsRef'), 'branch transition tracks committed experiment IDs');
assert.ok(experimentSource.includes('deriveNewExperimentIds(previousIds, experimentIds)'), 'new branch identity comes from the runtime experiment ID set difference');
assert.ok(experimentSource.includes('experiment.id === enteringExperimentId'), 'entry motion is bound to the newly-created experiment ID');
assert.ok(css.includes('animation: ui-motion-branch-enter var(--motion-emphasis)'), 'branch entry timing uses the shared emphasis CSS token');
assert.ok(!experimentSource.includes('420'), 'branch entry has no stale hard-coded duration');
assert.ok(experimentSource.includes('ui-motion-branch-enter'), 'A to B transition is presentation-only');
assert.ok(experimentSource.includes('comparison.enabled && diff'), 'comparison reveal waits for runtime comparison state');
assert.ok(experimentSource.includes('data-ui-motion="comparison"'), 'comparison reveal has a semantic presentation marker');

assert.ok(detailsSource.includes('ui-motion-overlay-enter'), 'depth panels have a bounded overlay transition');
assert.ok(detailsSource.includes('panelCloseRef.current?.focus()'), 'opening a depth retains sensible keyboard focus');
assert.ok(detailsSource.includes('triggerRefs.current[previousDepthRef.current]?.focus()'), 'closing a depth returns focus to its trigger');
assert.ok(detailsSource.includes('agentCloseRef.current?.focus()'), 'opening Agent retains sensible keyboard focus');
assert.ok(detailsSource.includes('agentTriggerRef.current?.focus()'), 'closing Agent returns focus to its trigger');
assert.ok(detailsSource.includes('resolvePresentationFocusOwner'), 'Agent/depth focus uses one presentation owner decision');
assert.ok(agentSource.includes('ui-motion-overlay-enter'), 'Agent overlay uses the same overlay motion contract');
assert.ok(dialogSource.includes('REDUCED_MOTION_QUERY'), 'playback uses the centralized reduced-motion query');

assert.equal(
  resolvePresentationFocusOwner({ previousAgentOpen: true, activeDepth: null, agentOpen: false }),
  PRESENTATION_FOCUS_OWNERS.AGENT_TRIGGER,
  'normal Agent close returns focus to the Agent trigger',
);
assert.equal(
  resolvePresentationFocusOwner({ previousAgentOpen: true, activeDepth: 'evidence', agentOpen: false }),
  PRESENTATION_FOCUS_OWNERS.DEPTH,
  'Agent-to-depth handoff keeps focus in the destination depth',
);
assert.equal(
  resolvePresentationFocusOwner({ previousDepth: 'evidence', activeDepth: null, agentOpen: true }),
  PRESENTATION_FOCUS_OWNERS.AGENT,
  'opening Agent while a depth is open gives focus to Agent',
);
assert.equal(
  resolvePresentationFocusOwner({ previousDepth: 'evidence', activeDepth: null, agentOpen: false }),
  PRESENTATION_FOCUS_OWNERS.DEPTH_TRIGGER,
  'closing a depth returns focus to its depth trigger',
);
assert.deepEqual(deriveNewExperimentIds(['a'], ['a', 'b']), ['b'], 'duplicate identifies the new B runtime ID');
assert.deepEqual(deriveNewExperimentIds(['a', 'b'], ['a', 'b', 'c']), ['c'], 'a later duplicate identifies only the new C runtime ID');
assert.deepEqual(deriveNewExperimentIds(['a', 'b'], ['a', 'b']), [], 'switching active experiment does not create an entry ID');

for (const source of [workspaceSource, experimentSource, detailsSource, agentSource, dialogSource]) {
  assert.ok(!/animationend|transitionend/i.test(source), 'semantic actions do not depend on animation completion events');
  assert.ok(!source.includes('transition-all'), 'Explore motion does not animate all properties');
}

console.log('UI-7 motion checks passed: shared tokens, reduced motion, runtime-ordered presentation, primitive model response motion, focus behavior, bounded overlays, and animation-independent semantics.');
