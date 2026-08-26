import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import {
  appendTestDesign,
  clearTestDesigns,
  compileTestDesignActionPlan,
  createTestDesign,
  deriveTestComparison,
  scopeTestDesignEvidence,
  normalizeTestDesignState,
  testDesignSemanticEdges,
  validateTestDesign,
} from '../src/core/exploration/testDesign.js';
import { createEvidenceInstance } from '../src/core/exploration/evidenceProvenance.js';

const capabilities = {
  options: [
    { id: 'control.learningRate', factorKind: 'learning', semanticPath: 'learning.controls.learningRate', operationType: 'SET_CONTROL', controlKey: 'learningRate', type: 'number', currentValue: 0.1, min: 0.001, max: 1, defaultToValue: 0.2 },
    { id: 'noise.amount', factorKind: 'observationProcess', semanticPath: 'observationProcess.noise', operationType: 'SET_GENERATOR_PARAMETER', path: 'noise.amount', type: 'number', currentValue: 0.2, min: 0, max: 2, defaultToValue: 0.8, requiresRegenerate: true },
    { id: 'observation.sample', factorKind: 'observationProcess', semanticPath: 'observationProcess.sample', operationType: 'RESAMPLE_WORLD', defaultToValue: null },
  ],
  outcomes: [{ id: 'test.accuracy', labelKey: 'x' }],
  heldOptions: ['learning.controls.learningRate', 'observationProcess.noise', 'model', 'world'],
};
const snapshot = { experimentWorkspace: { activeExperimentId: 'experiment-1' } };
const base = createTestDesign({ id: 'design-1', hypothesisId: 'h-1', baselineExperimentId: 'experiment-1', intervention: { factorKind: 'learning', semanticPath: 'learning.controls.learningRate', operationType: 'SET_CONTROL', controlKey: 'learningRate', fromValue: 0.1, toValue: 0.2 }, heldConstantFactors: ['model'], outcomeObservableIds: ['test.accuracy'], prediction: { choice: 'decrease' } });

assert.ok(base); // 1: learner-created design is bounded and valid
assert.equal(base.createdFrom, 'learner'); // 2: designs are learner-owned
assert.equal(base.status, 'draft'); // 3: saving does not imply execution
assert.deepEqual(normalizeTestDesignState({ designs: [base, base] }).designs.map((item) => item.id), ['design-1', 'design-1']); // 4: state normalization is session-local
assert.equal(validateTestDesign(base, { capabilities }).valid, true); // 5: supported factor validates
assert.equal(validateTestDesign({ ...base, outcomeObservableIds: [] }, { capabilities }).valid, false); // 6: outcome required
assert.equal(validateTestDesign({ ...base, baselineExperimentId: null }, { capabilities }).valid, false); // 7: baseline required
assert.equal(validateTestDesign({ ...base, intervention: { ...base.intervention, controlKey: 'unknown' } }, { capabilities }).valid, false); // 8: unsupported intervention rejected
assert.equal(validateTestDesign({ ...base, intervention: { ...base.intervention, toValue: 9 } }, { capabilities }).valid, false); // 9: target range checked
const plan = compileTestDesignActionPlan(base, { snapshot, capabilities });
assert.equal(plan.valid, true); // 10: valid design produces executable plan
assert.deepEqual(plan.actions.map((action) => action.type), ['DUPLICATE_EXPERIMENT', 'SET_CONTROL', 'RUN', 'SET_COMPARE']); // 11: explicit duplicate/intervene/run/compare sequence
assert.equal(plan.actions[0].actor, 'human'); // 12: learner action authority preserved
assert.equal(compileTestDesignActionPlan(base, { snapshot: { experimentWorkspace: { activeExperimentId: 'other' } }, capabilities }).valid, false); // 13: stale baseline is rejected
const generatorDesign = createTestDesign({ ...base, id: 'design-generator', intervention: { factorKind: 'observationProcess', semanticPath: 'observationProcess.noise', operationType: 'SET_GENERATOR_PARAMETER', path: 'noise.amount', fromValue: 0.2, toValue: 0.8, requiresRegenerate: true } });
assert.deepEqual(compileTestDesignActionPlan(generatorDesign, { snapshot, capabilities }).actions.map((action) => action.type), ['DUPLICATE_EXPERIMENT', 'APPLY_WORLD_TRANSACTION', 'RUN', 'SET_COMPARE']); // 14: generator intervention remains one test step
const single = deriveTestComparison({ testDesign: base, comparison: { diff: { changedFactors: ['learning'], semanticChangedPaths: ['learning.controls.learningRate'], semanticFactorPaths: ['learning.controls.learningRate'], semanticFactorCount: 1 } }, outcomeEvidenceIds: ['evidence-instance-1'] });
assert.equal(single.comparisonClass, 'single-factor'); // 15: single-factor classification
assert.deepEqual(single.outcomeEvidenceIds, ['evidence-instance-1']); // 16: stable Evidence instance IDs only
const confounded = deriveTestComparison({ testDesign: base, comparison: { diff: { changedFactors: ['learning', 'model'], semanticChangedPaths: ['learning.controls.learningRate', 'model.controls.hiddenUnits'], semanticFactorPaths: ['learning.controls.learningRate', 'model.controls.hiddenUnits'], semanticFactorCount: 2 } } });
assert.equal(confounded.comparisonClass, 'confounded'); // 17: multiple changed paths are confounded
const heldViolation = deriveTestComparison({ testDesign: base, comparison: { diff: { changedFactors: ['model'], semanticChangedPaths: ['model.controls.hiddenUnits'], semanticFactorPaths: ['model.controls.hiddenUnits'], semanticFactorCount: 1 } } });
assert.equal(heldViolation.heldConstantSatisfied, false); // 18: held-constant violation is factual
const canonicalMultiLeaf = deriveTestComparison({ testDesign: createTestDesign({ ...base, id: 'design-relation', intervention: { factorKind: 'world', semanticPath: 'world.relation', operationType: 'SET_GENERATOR_PARAMETER', path: 'relation.translate', fromValue: [0, 0], toValue: [1, 1] } }), comparison: { diff: { changedFactors: ['world'], semanticChangedPaths: ['world.relation.translate.0', 'world.relation.translate.1'], semanticFactorPaths: ['world.relation'], semanticFactorCount: 1 } } });
assert.equal(canonicalMultiLeaf.comparisonClass, 'single-factor'); // 19: multiple raw leaves still form one canonical factor
const observational = deriveTestComparison({ testDesign: createTestDesign({ ...base, id: 'design-sample', intervention: { factorKind: 'observationProcess', semanticPath: 'observationProcess.sample', operationType: 'RESAMPLE_WORLD' } }), comparison: { diff: { changedFactors: ['observationProcess'], semanticChangedPaths: ['observationProcess.sample'], semanticFactorPaths: ['observationProcess.sample'], semanticFactorCount: 1 } } });
assert.equal(observational.comparisonClass, 'observational'); // 20: resampling is observational
assert.equal(deriveTestComparison({ testDesign: base, comparison: { diff: { changedFactors: [], semanticChangedPaths: [], semanticFactorPaths: [], semanticFactorCount: 0 } } }).comparisonClass, 'insufficient'); // 21: zero canonical factors are insufficient
assert.ok(testDesignSemanticEdges({ design: base, comparison: single }).every((edge) => edge.relation !== 'caused_by')); // 22: no causal edge is inferred
assert.deepEqual(appendTestDesign(clearTestDesigns(), base).designs[0].id, 'design-1'); // 23: append is detached and bounded

const unrelatedEvidence = createEvidenceInstance({ event: { type: 'observation.detected', sequence: 50, reasonCode: 'COVERAGE_MISMATCH', evidenceRefs: ['coverageMismatch'], experimentIds: ['experiment-test'] }, draft: { conditionFingerprint: 'condition-test', evidence: { value: 1 } } });
const directOutcomeEvidence = createEvidenceInstance({ event: { type: 'observation.detected', sequence: 51, reasonCode: 'TEST_ERROR_CHANGED', evidenceRefs: ['outcome.testMse'], experimentIds: ['experiment-test'] }, draft: { conditionFingerprint: 'condition-test', evidence: { value: 2 } } });
const duplicateOccurrence = createEvidenceInstance({ event: { type: 'observation.detected', sequence: 49, reasonCode: 'COVERAGE_MISMATCH', evidenceRefs: ['outcome.testMse'], experimentIds: ['experiment-test'] }, draft: { conditionFingerprint: 'condition-test', evidence: { value: 3 } } });
const scopedEvidence = scopeTestDesignEvidence({ evidenceInstances: [duplicateOccurrence, unrelatedEvidence, directOutcomeEvidence], beforeSequence: 49, outcomeObservableIds: ['outcome.testMse'] });
assert.deepEqual(scopedEvidence.executionEvidenceIds, ['evidence-instance-50', 'evidence-instance-51']); // 24: execution evidence is temporal provenance only
assert.deepEqual(scopedEvidence.outcomeEvidenceIds, ['evidence-instance-51']); // 25: only direct outcome provenance is linked
assert.ok(!scopedEvidence.outcomeEvidenceIds.includes('evidence-instance-50')); // 26: unrelated detector is not an outcome

const host = createPlaygroundHost({ getDataset: () => null });
await host.open({ playgroundId: 'linear-regression', seed: 7 });
const beforeRuntime = host.getState();
const runtimeCapabilities = host.deriveTestDesignCapabilities();
const noise = runtimeCapabilities.options.find((option) => option.id === 'noise.amount');
const runtimeDesign = createTestDesign({
  id: 'runtime-design',
  hypothesisId: 'h-runtime',
  baselineExperimentId: beforeRuntime.experimentWorkspace.activeExperimentId,
  intervention: { factorKind: noise.factorKind, semanticPath: noise.semanticPath, operationType: noise.operationType, path: noise.path, requiresRegenerate: true, fromValue: noise.currentValue, toValue: noise.defaultToValue },
  heldConstantFactors: ['model'],
  outcomeObservableIds: [runtimeCapabilities.outcomes[0]?.id ?? 'outcome.trainMse'],
  prediction: { choice: 'increase' },
});
const assessment = host.preflightTestDesign({ design: runtimeDesign });
assert.equal(assessment.valid, true); // detached preflight is valid
const afterSave = host.getState();
assert.deepEqual(afterSave.world, beforeRuntime.world); // saving/preflighting does not mutate World
assert.deepEqual(afterSave.experiment, beforeRuntime.experiment); // saving/preflighting does not mutate Experiment
assert.deepEqual(afterSave.datasetProvenance, beforeRuntime.datasetProvenance); // saving/preflighting does not mutate Dataset provenance
assert.deepEqual(afterSave.semanticEvents.events, beforeRuntime.semanticEvents.events); // saving/preflighting does not create Evidence/events
const baselineFingerprint = host.inspectContext().conditionFingerprint;
const staleDesign = createTestDesign({ ...runtimeDesign, id: 'stale-runtime-design', baselineConditionFingerprint: baselineFingerprint });
await host.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.12 });
const staleBefore = host.getState();
assert.equal(staleBefore.experimentWorkspace.activeExperimentId, beforeRuntime.experimentWorkspace.activeExperimentId); // 27: real control change stays on E1
assert.notEqual(host.inspectContext().conditionFingerprint, baselineFingerprint); // 28: condition identity changes without an ID change
const staleAssessment = host.preflightTestDesign({ design: staleDesign });
assert.equal(staleAssessment.valid, false); // 29: stale baseline is rejected before execution
assert.equal(staleAssessment.code, 'TEST_DESIGN_STALE_BASELINE'); // 30: stable stale-baseline diagnostic
const staleAfterPreflight = host.getState();
assert.deepEqual(staleAfterPreflight.world, staleBefore.world); // 31: stale preflight does not mutate World
const staleExecution = await host.executeTestDesign({ design: staleDesign });
assert.equal(staleExecution.valid, false); // 32: stale execution is also rejected
assert.equal(staleExecution.code, 'TEST_DESIGN_STALE_BASELINE'); // 33: stale execution does not fall through
const staleAfterExecution = host.getState();
assert.deepEqual(staleAfterExecution.semanticEvents.events, staleBefore.semanticEvents.events); // 34: stale execution creates no Evidence
const execution = await host.executeTestDesign({ design: runtimeDesign });
assert.equal(execution.valid, true); // explicit Run executes through the host
assert.equal(execution.comparison.comparisonClass, 'single-factor'); // runtime comparison is grounded
assert.notEqual(execution.interventionExperimentId, execution.baselineExperimentId); // duplicate is the intervention Experiment
assert.equal(execution.snapshot.experimentWorkspace.experiments.find((item) => item.id === execution.interventionExperimentId).parentExperimentId, execution.baselineExperimentId); // baseline lineage is preserved
assert.ok(execution.outcomes.length > 0); // prediction/outcome projection is available
await host.close();

const hostSource = fs.readFileSync('src/core/playgroundHost.js', 'utf8');
const uiSource = fs.readFileSync('src/components/playground/TestDesigner.jsx', 'utf8');
const dataSource = fs.readFileSync('src/components/playground/DataWorkspace.jsx', 'utf8');
assert.match(hostSource, /async executeTestDesign/);
assert.match(uiSource, /data-test-designer/);
assert.match(dataSource, /disabled=\{!canCompareSamples\}/);
console.log('Hypothesis Test Design checks passed: canonical factor grouping, scoped Evidence provenance, stale baselines, and detached execution.');
