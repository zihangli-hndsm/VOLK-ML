import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import {
  appendTestDesign,
  clearTestDesigns,
  compileTestDesignActionPlan,
  createTestDesign,
  deriveTestComparison,
  normalizeTestDesignState,
  testDesignSemanticEdges,
  validateTestDesign,
} from '../src/core/exploration/testDesign.js';

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
const single = deriveTestComparison({ testDesign: base, comparison: { diff: { changedFactors: ['learning'], semanticChangedPaths: ['learning.controls.learningRate'] } }, outcomeEvidenceIds: ['evidence-instance-1'] });
assert.equal(single.comparisonClass, 'single-factor'); // 15: single-factor classification
assert.deepEqual(single.outcomeEvidenceIds, ['evidence-instance-1']); // 16: stable Evidence instance IDs only
const confounded = deriveTestComparison({ testDesign: base, comparison: { diff: { changedFactors: ['learning', 'model'], semanticChangedPaths: ['learning.controls.learningRate', 'model.controls.hiddenUnits'] } } });
assert.equal(confounded.comparisonClass, 'confounded'); // 17: multiple changed paths are confounded
const heldViolation = deriveTestComparison({ testDesign: base, comparison: { diff: { changedFactors: ['model'], semanticChangedPaths: ['model.controls.hiddenUnits'] } } });
assert.equal(heldViolation.heldConstantSatisfied, false); // 18: held-constant violation is factual
const observational = deriveTestComparison({ testDesign: createTestDesign({ ...base, id: 'design-sample', intervention: { factorKind: 'observationProcess', semanticPath: 'observationProcess.sample', operationType: 'RESAMPLE_WORLD' } }), comparison: { diff: { changedFactors: ['observationProcess'], semanticChangedPaths: ['observationProcess.sample'] } } });
assert.equal(observational.comparisonClass, 'observational'); // 19: resampling is observational
assert.equal(deriveTestComparison({ testDesign: base, comparison: { diff: { changedFactors: [], semanticChangedPaths: [] } } }).comparisonClass, 'insufficient'); // 20: insufficient comparison is explicit
assert.ok(testDesignSemanticEdges({ design: base, comparison: single }).every((edge) => edge.relation !== 'caused_by')); // 21: no causal edge is inferred
assert.deepEqual(appendTestDesign(clearTestDesigns(), base).designs[0].id, 'design-1'); // 22: append is detached and bounded

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
console.log('Hypothesis Test Design checks passed: 22 semantic and execution-boundary assertions.');
