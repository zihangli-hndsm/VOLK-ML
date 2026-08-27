import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveInquiryEpisodes, deriveInquiryTrailEntries } from '../src/core/exploration/inquiryEpisodes.js';

const trail = deriveInquiryTrailEntries({
  semanticEvents: [
    { id: 'event-observe', type: 'observation.detected', actor: 'human', sequence: 1, reasonCode: 'TEST_ERROR_CHANGED_MORE' },
    { id: 'event-compare', type: 'comparison.completed', actor: 'human', sequence: 2 },
    { id: 'event-intervene', type: 'experiment.factor-changed', actor: 'human', sequence: 3, reasonCode: 'learningRate' },
  ],
  inquiry: { candidates: [{ conceptId: 'generalization', supportingEventIds: ['event-compare'] }] },
  hypotheses: [{ id: 'hypothesis-1', experimentId: 'experiment-1', evidenceIds: ['evidence-instance-1'] }],
  testDesigns: [{ id: 'design-1', baselineExperimentId: 'experiment-1', outcomeEvidenceIds: ['evidence-instance-1'] }],
  interpretations: [{ id: 'interpretation-1', hypothesisIds: ['hypothesis-1'], evidenceInstanceIds: ['evidence-instance-1'] }],
  revisions: [{ parentHypothesisId: 'hypothesis-1', childHypothesisId: 'hypothesis-2', interpretationIds: ['interpretation-1'] }],
  illuminationEvents: [{ conceptId: 'generalization' }],
});
const episodes = deriveInquiryEpisodes({
  semanticEvents: [
    { id: 'event-observe', type: 'observation.detected', actor: 'human', sequence: 1, reasonCode: 'TEST_ERROR_CHANGED_MORE' },
    { id: 'event-compare', type: 'comparison.completed', actor: 'human', sequence: 2 },
    { id: 'event-intervene', type: 'experiment.factor-changed', actor: 'human', sequence: 3, reasonCode: 'learningRate' },
  ],
  inquiry: { candidates: [{ conceptId: 'generalization', supportingEventIds: ['event-compare'] }] },
  hypotheses: [{ id: 'hypothesis-1', statement: 'A learner idea', experimentId: 'experiment-1', evidenceIds: ['evidence-instance-1'], linkedConceptIds: ['generalization'] }],
  testDesigns: [{ id: 'design-1', baselineExperimentId: 'experiment-1', outcomeEvidenceIds: ['evidence-instance-1'] }],
  interpretations: [{ id: 'interpretation-1', hypothesisIds: ['hypothesis-1'], evidenceInstanceIds: ['evidence-instance-1'] }],
  revisions: [{ parentHypothesisId: 'hypothesis-1', childHypothesisId: 'hypothesis-2', interpretationIds: ['interpretation-1'] }],
  illuminationEvents: [{ conceptId: 'generalization' }],
});
assert.ok(trail.length >= 8, 'trail keeps chronological entries for existing events and learner records');
assert.ok(trail.some((entry) => entry.type === 'observe'));
assert.ok(trail.some((entry) => entry.type === 'compare'));
assert.ok(trail.some((entry) => entry.type === 'interpret'));
assert.ok(trail.some((entry) => entry.type === 'illuminate'));
assert.ok(episodes.length >= 3, 'episodes group explicit learner records into coherent inquiry units');
assert.ok(episodes.every((episode) => Array.isArray(episode.hypothesisIds) && !('type' in episode) && !('evidenceIds' in episode)));
assert.ok(trail.find((entry) => entry.type === 'observe').reasonCodes.includes('TEST_ERROR_CHANGED_MORE'));
assert.ok(!trail.find((entry) => entry.type === 'observe').evidenceInstanceIds.includes('TEST_ERROR_CHANGED_MORE'), 'reason codes never become evidence identities');
const source = readFileSync(new URL('../src/core/exploration/inquiryEpisodes.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /mastery|score|planner|caused_by/);
const ui = readFileSync(new URL('../src/components/playground/InquiryTrail.jsx', import.meta.url), 'utf8');
assert.match(ui, /data-inquiry-trail/);
console.log('Inquiry episode checks passed: bounded projection of existing events, learner records, evidence references, chronology, and no progress or reasoning authority.');
