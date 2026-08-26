import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveLumiExplorationPlan, LUMI_SUGGESTION_KINDS, MAX_LUMI_SUGGESTIONS } from '../src/core/ui/lumiExplorationPlanner.js';

const empty = deriveLumiExplorationPlan({ snapshot: {}, journey: {}, conceptGraph: { frontierConceptIds: ['generalization'] } });
assert.ok(empty.suggestions.length <= MAX_LUMI_SUGGESTIONS);
assert.ok(empty.suggestions.some((item) => item.kind === 'predict'));
assert.ok(empty.suggestions.some((item) => item.kind === 'explore-concept'));
assert.ok(empty.suggestions.every((item) => item.authority === 'suggestion-only'));
const rich = deriveLumiExplorationPlan({
  snapshot: { observations: [{ id: 'TEST_ERROR_CHANGED_MORE' }], experimentWorkspace: { comparison: { enabled: true } } },
  journey: { observedEvidenceIds: ['evidence-instance-1'], frontierConceptIds: ['generalization'] },
  evidenceInstances: [{ id: 'evidence-instance-1', available: true }],
  hypotheses: [{ id: 'hypothesis-1' }, { id: 'hypothesis-2' }],
  testDesigns: [{ id: 'design-1' }],
  hypothesisGroups: [],
  interpretations: [],
  revisions: [],
  counterfactualQuestions: [],
  conceptGraph: { frontierConceptIds: ['generalization'] },
});
assert.ok(rich.suggestions.some((item) => item.kind === 'inspect-evidence'));
assert.ok(rich.suggestions.some((item) => item.kind === 'interpret'));
assert.ok(rich.suggestions.some((item) => item.kind === 'compare-hypotheses'));
const counterfactualPlan = deriveLumiExplorationPlan({ snapshot: { observations: [{ id: 'observed' }] }, journey: { observedEvidenceIds: ['evidence-instance-1'] }, hypotheses: [{ id: 'hypothesis-1' }], testDesigns: [{ id: 'design-1' }], interpretations: [{ id: 'interpretation-1' }], revisions: [{ id: 'revision-1' }], counterfactualQuestions: [], conceptGraph: {} });
assert.ok(counterfactualPlan.suggestions.some((item) => item.kind === 'counterfactual'));
const again = deriveLumiExplorationPlan({
  snapshot: { observations: [{ id: 'TEST_ERROR_CHANGED_MORE' }], experimentWorkspace: { comparison: { enabled: true } } },
  journey: { observedEvidenceIds: ['evidence-instance-1'], frontierConceptIds: ['generalization'] },
  evidenceInstances: [{ id: 'evidence-instance-1', available: true }], hypotheses: [{ id: 'hypothesis-1' }, { id: 'hypothesis-2' }], testDesigns: [{ id: 'design-1' }], conceptGraph: { frontierConceptIds: ['generalization'] },
});
assert.deepEqual(rich.suggestions, again.suggestions, 'planner is deterministic for the same semantic projection');
assert.ok(LUMI_SUGGESTION_KINDS.includes('hold-constant'));
const moduleSource = readFileSync(new URL('../src/core/ui/lumiExplorationPlanner.js', import.meta.url), 'utf8');
assert.doesNotMatch(moduleSource, /dispatchRuntimeAction|executeTestDesign|setControl|createHypothesis/);
assert.match(moduleSource, /suggestion-only/);
const ui = readFileSync(new URL('../src/components/playground/LumiExplorationPlannerPanel.jsx', import.meta.url), 'utf8');
assert.match(ui, /data-lumi-exploration-planner/);
assert.match(ui, /sm:grid-cols-2/);
assert.match(ui, /onAccept/);
console.log('LUMI exploration planner checks passed: deterministic bounded suggestions, all planned suggestion kinds, projection-only authority, existing-surface handoff, and responsive UI hooks.');
