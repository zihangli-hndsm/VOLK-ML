import assert from 'node:assert/strict';
import {
  canonicalizeLearnerAnnotation,
  createLearnerAnnotationStore,
  projectLearnerAnnotations,
} from '../src/core/exploration/learnerAnnotations.js';

const anchor = { surface: 'agent-answer', contentId: 'ask-volk-answer', messageId: 'ask-volk-answer', localizationKey: 'ai.askAnswer' };
const store = createLearnerAnnotationStore();
const annotation = store.add({ kind: 'unclear', anchor, quote: 'A bounded selected passage', now: 10 });
assert.equal(annotation.actor, 'human', 'annotations have trusted human provenance');
assert.deepEqual(projectLearnerAnnotations(store.snapshot()), [{ id: annotation.id, kind: 'unclear', anchor, quote: 'A bounded selected passage', resolvedAt: null }]);
assert.equal(canonicalizeLearnerAnnotation({ ...annotation, actor: 'agent' }), null, 'callers cannot author a non-human annotation');
assert.equal(canonicalizeLearnerAnnotation({ ...annotation, quote: 'x'.repeat(281) }), null, 'quotes are bounded');
assert.equal(canonicalizeLearnerAnnotation({ ...annotation, anchor: { surface: 'dom-node', contentId: 'anything' } }), null, 'arbitrary DOM anchors are rejected');
assert.equal(canonicalizeLearnerAnnotation({ ...annotation, extra: { nested: 'unbounded' } }).extra, undefined, 'unknown nested fields are not persisted');
assert.equal(store.resolve(annotation.id, 20).resolvedAt, 20, 'annotations can be resolved');
assert.equal(projectLearnerAnnotations(store.snapshot()).length, 0, 'resolved annotations are absent from active projection');
assert.equal(store.remove(annotation.id), true, 'annotations can be removed from session-local state');
for (let index = 0; index < 40; index += 1) store.add({ kind: 'understood', anchor, now: index + 30 });
assert.equal(store.snapshot().length, 32, 'annotation storage remains bounded');

console.log('Learner annotation checks passed: trusted provenance, stable anchors, bounded quotes/state, resolution, and strict projection.');
