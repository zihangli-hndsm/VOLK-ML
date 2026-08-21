import assert from 'node:assert/strict';
import {
  CURIOSITY_GAP_IDS,
  canonicalizeCuriosityState,
  deriveCuriosityState,
  projectCuriosityContext,
  resolveCuriosityOpportunities,
} from '../src/core/exploration/curiosity.js';
import { INQUIRY_CONCEPT_IDS } from '../src/core/exploration/learnerInquiry.js';
import { createExplorationAiInterpreter, projectExplorationAiContext } from '../src/core/exploration/explorationAiInterpreter.js';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';

const event = ({ id, sequence, type, actor = 'human', experimentIds = [], semanticFactors = [], semanticFactorPaths = semanticFactors, reasonCode }) => ({
  id,
  sequence,
  type,
  actor,
  experimentIds,
  semanticFactors,
  semanticFactorPaths,
  reasonCode,
});

const comparison = (clarity = 'high', count = 1, paths = ['learning.controls.learningRate']) => ({
  enabled: true,
  activeExperimentId: 'experiment-b',
  againstExperimentId: 'experiment-a',
  clarity,
  semanticFactorCount: count,
  semanticFactorPaths: paths,
  semanticChangedPaths: paths,
});

const inquiry = ({ candidate, candidates, observations = [], activeComparison = comparison() }) => ({
  activeComparison,
  activeObservationIds: observations,
  candidates: candidates ?? (candidate ? [candidate] : []),
});

const singleEvents = [
  event({ id: 'duplicate-1', sequence: 1, type: 'experiment.duplicated', experimentIds: ['experiment-a', 'experiment-b'] }),
  event({ id: 'factor-1', sequence: 2, type: 'experiment.factor-changed', experimentIds: ['experiment-b'], semanticFactors: ['learning'], semanticFactorPaths: ['learning.controls.learningRate'] }),
  event({ id: 'compare-1', sequence: 3, type: 'comparison.completed', experimentIds: ['experiment-a', 'experiment-b'], semanticFactors: ['learning'], semanticFactorPaths: ['learning.controls.learningRate'], reasonCode: 'comparison-ready' }),
];
const singleCandidate = {
  conceptId: INQUIRY_CONCEPT_IDS.CONTROLLED_COMPARISON,
  confidence: 'direct',
  supportingEventIds: ['duplicate-1', 'compare-1'],
  reasonCode: 'duplicated-one-factor-comparison',
};
const singleState = deriveCuriosityState({ semanticEvents: { events: singleEvents }, inquiry: inquiry({ candidate: singleCandidate }) });
assert.equal(singleState.available, true, 'duplicate + one factor + compare creates curiosity');
assert.equal(singleState.reflectionOpportunities[0].id, CURIOSITY_GAP_IDS.SINGLE_FACTOR_MECHANISM, 'single-factor gap is deterministic');
assert.equal(singleState.opportunities.length, 0, 'fact derivation does not invent an opportunity before capability resolution');
assert.equal(singleState.reflectionOpportunities[0].supportingEvidence.length, 2, 'reflection retains bounded event provenance');

const unavailableSingle = resolveCuriosityOpportunities({ curiosity: singleState, capabilities: { availableActions: [] } });
assert.equal(unavailableSingle.reflectionOpportunities.length, 1, 'reflection remains factual when no action capability is available');
assert.equal(unavailableSingle.opportunities.length, 0, 'unavailable capability does not create a fake actionable opportunity');
const mechanismAvailable = resolveCuriosityOpportunities({ curiosity: singleState, capabilities: { availableActions: ['inspect-mechanism'] } });
assert.equal(mechanismAvailable.opportunities.length, 1, 'registered mechanism capability exposes the existing safe direction');

const mixedEvents = [
  event({ id: 'mixed-compare', sequence: 1, type: 'comparison.completed', experimentIds: ['experiment-a', 'experiment-b'], semanticFactors: ['world', 'learning'], semanticFactorPaths: ['world.test.input', 'learning.controls.learningRate'], reasonCode: 'comparison-mixed' }),
];
const mixedCandidate = {
  conceptId: INQUIRY_CONCEPT_IDS.MIXED_FACTOR_COMPARISON,
  confidence: 'direct',
  supportingEventIds: ['mixed-compare'],
  reasonCode: 'mixed-factor-comparison',
};
const mixedState = deriveCuriosityState({
  semanticEvents: { events: mixedEvents },
  inquiry: inquiry({ candidate: mixedCandidate, activeComparison: comparison('mixed', 2, ['world.test.input', 'learning.controls.learningRate']) }),
});
assert.equal(mixedState.reflectionOpportunities[0].id, CURIOSITY_GAP_IDS.MIXED_FACTOR_COMPARISON, 'mixed comparison creates uncertainty curiosity');
assert.equal(JSON.stringify(mixedState).match(/caus|overfit|because/i), null, 'mixed curiosity does not create a causal conclusion');

const distributionEvents = [
  event({ id: 'test-world-1', sequence: 1, type: 'world.intervened', experimentIds: ['experiment-b'], semanticFactors: ['world.test.input'], reasonCode: 'world-transaction' }),
  event({ id: 'coverage-1', sequence: 2, type: 'observation.detected', experimentIds: ['experiment-a', 'experiment-b'], reasonCode: 'COVERAGE_MISMATCH' }),
];
const distributionCandidate = {
  conceptId: INQUIRY_CONCEPT_IDS.DISTRIBUTION_SHIFT,
  confidence: 'direct',
  supportingEventIds: ['test-world-1', 'coverage-1'],
  supportingObservationIds: ['COVERAGE_MISMATCH'],
  reasonCode: 'test-world-change-with-coverage-mismatch',
};
const distributionState = deriveCuriosityState({
  semanticEvents: { events: distributionEvents },
  inquiry: inquiry({ candidate: distributionCandidate, observations: ['COVERAGE_MISMATCH'], activeComparison: comparison('high', 1, ['world.test.input']) }),
});
assert.equal(distributionState.reflectionOpportunities[0].id, CURIOSITY_GAP_IDS.DISTRIBUTION_SHIFT, 'coverage mismatch creates a distribution-shift question');
assert.equal(JSON.stringify(distributionState).match(/overfit|caused|because/i), null, 'distribution shift does not become an overfitting claim');
const clearedCoverage = deriveCuriosityState({
  semanticEvents: { events: distributionEvents },
  inquiry: inquiry({ candidate: distributionCandidate, observations: [], activeComparison: comparison('high', 1, ['world.test.input']) }),
});
assert.equal(clearedCoverage.available, false, 'cleared coverage evidence cannot trigger stale distribution curiosity');

const priorityState = deriveCuriosityState({
  semanticEvents: { events: [...singleEvents, ...distributionEvents] },
  inquiry: inquiry({
    candidates: [singleCandidate, distributionCandidate],
    observations: ['COVERAGE_MISMATCH'],
    activeComparison: comparison('high', 1, ['world.test.input']),
  }),
});
assert.equal(priorityState.reflectionOpportunities[0].id, CURIOSITY_GAP_IDS.DISTRIBUTION_SHIFT, 'intervention-specific distribution evidence outranks generic single-factor curiosity');

const wrongPairState = deriveCuriosityState({
  semanticEvents: { events: singleEvents.map((item) => ({
    ...item,
    experimentIds: item.type === 'experiment.duplicated' || item.type === 'comparison.completed'
      ? ['experiment-x', 'experiment-y']
      : item.experimentIds,
  })) },
  inquiry: inquiry({ candidate: singleCandidate }),
});
assert.equal(wrongPairState.available, false, 'supporting events from the wrong experiment pair cannot create curiosity');

const repeatCandidate = {
  conceptId: INQUIRY_CONCEPT_IDS.STABILITY,
  confidence: 'direct',
  supportingEventIds: ['repeat-1', 'repeat-observation-1'],
  supportingObservationIds: ['REPEAT_VARIATION'],
  reasonCode: 'repeat-variation-observed',
};
const repeatWithoutEvidence = deriveCuriosityState({
  semanticEvents: { events: [event({ id: 'repeat-1', sequence: 1, type: 'repeat.completed', experimentIds: ['experiment-b'] })] },
  inquiry: inquiry({ candidate: repeatCandidate, observations: [] }),
});
assert.equal(repeatWithoutEvidence.available, false, 'repeat without active variation evidence creates no stability claim');
const repeatState = deriveCuriosityState({
  semanticEvents: { events: [
    event({ id: 'repeat-1', sequence: 1, type: 'repeat.completed', experimentIds: ['experiment-b'] }),
    event({ id: 'repeat-observation-1', sequence: 2, type: 'observation.detected', experimentIds: ['experiment-b'], reasonCode: 'REPEAT_VARIATION' }),
  ] },
  inquiry: inquiry({ candidate: repeatCandidate, observations: ['REPEAT_VARIATION'], activeComparison: null }),
});
assert.equal(repeatState.reflectionOpportunities[0].id, CURIOSITY_GAP_IDS.REPEAT_VARIATION, 'repeat variation creates a stability question');

const systemOnly = deriveCuriosityState({
  semanticEvents: { events: singleEvents.map((item) => ({ ...item, actor: 'system' })) },
  inquiry: inquiry({ candidate: singleCandidate }),
});
assert.equal(systemOnly.available, false, 'system events never create learner curiosity');
const agentOnly = deriveCuriosityState({
  semanticEvents: { events: singleEvents.map((item) => ({ ...item, actor: 'agent' })) },
  inquiry: inquiry({ candidate: singleCandidate }),
});
assert.equal(agentOnly.available, false, 'Agent events never create learner curiosity');

assert.deepEqual(singleState, deriveCuriosityState({ semanticEvents: { events: singleEvents }, inquiry: inquiry({ candidate: singleCandidate }) }), 'same factual input produces deterministic curiosity state');
assert.deepEqual(singleState, JSON.parse(JSON.stringify(singleState)), 'curiosity state is JSON-safe');
const serialized = JSON.stringify(singleState);
assert.equal(serialized.includes('coordinates'), false, 'curiosity state contains no raw coordinate field');
assert.equal(serialized.includes('observations'), false, 'curiosity state contains no raw observation payload');
assert.equal(serialized.includes('pointer'), false, 'curiosity state contains no pointer payload');
assert.equal(canonicalizeCuriosityState({ ...singleState, opportunities: [{ ...singleState.opportunities[0], concept: 'forged-concept' }] }), null, 'unknown concept cannot enter canonical curiosity state');
assert.equal(canonicalizeCuriosityState({ ...singleState, reflectionOpportunities: [{ ...singleState.reflectionOpportunities[0], questionKey: 'forged.question' }] }), null, 'caller cannot replace the registry question key');
assert.equal(canonicalizeCuriosityState({ ...singleState, opportunities: [{ ...singleState.opportunities[0], availableAction: 'execute-arbitrary-operation' }] }), null, 'caller cannot replace the registry action');
assert.equal(canonicalizeCuriosityState({ ...singleState, opportunities: [{ ...singleState.opportunities[0], requiredCapability: 'forged-capability' }] }), null, 'caller cannot replace the registry capability');
assert.equal(canonicalizeCuriosityState({ ...singleState, activeQuestions: Array.from({ length: 20 }, () => 'x') }), null, 'oversized curiosity arrays are rejected');

const providerContext = projectExplorationAiContext({
  playground: { modelAdapter: 'knn', task: 'classification' },
  world: { observations: [{ x: 999, y: 999, secret: 'raw' }] },
  curiosity: mechanismAvailable,
});
assert.equal(providerContext.curiosity.reflectionOpportunities[0].id, CURIOSITY_GAP_IDS.SINGLE_FACTOR_MECHANISM, 'provider sees the bounded curiosity gap');
assert.equal(providerContext.curiosity.opportunities[0].availableAction, 'inspect-mechanism', 'provider sees only the resolved existing action kind');
assert.equal(Object.hasOwn(providerContext.curiosity.reflectionOpportunities[0], 'supportingEvidence'), false, 'provider projection omits internal evidence references');
assert.equal(JSON.stringify(providerContext).includes('raw'), false, 'provider curiosity projection does not serialize raw World data');

let capturedPrompt = '';
const interpreter = createExplorationAiInterpreter({ gateway: {
  complete: async ({ messages }) => {
    capturedPrompt = messages[0].content;
    return { protocol: 'mock', text: JSON.stringify({ kind: 'clarification', reason: 'inspect the supplied opportunity' }) };
  },
} });
await interpreter.interpret({
  request: 'What should I explore next?',
  context: { presentation: { availableDepths: ['evidence'] }, curiosity: mechanismAvailable },
  config: { protocol: 'openai-compatible', apiKey: 'test', model: 'mock' },
});
assert.ok(capturedPrompt.includes('deterministic unresolved exploration opportunity'), 'Agent prompt defines curiosity as unresolved opportunity');
assert.ok(capturedPrompt.includes('Do not invent new curiosity types'), 'Agent prompt prevents new curiosity types');
assert.ok(capturedPrompt.includes(CURIOSITY_GAP_IDS.SINGLE_FACTOR_MECHANISM), 'Agent prompt receives the bounded curiosity ID');
assert.equal(capturedPrompt.includes('999'), false, 'Agent prompt excludes raw World observations');
assert.equal(capturedPrompt.includes('duplicate-1'), false, 'Agent prompt excludes internal Semantic Event IDs');
assert.equal(capturedPrompt.includes('experiment-a'), false, 'Agent prompt excludes Experiment IDs');

const host = createPlaygroundHost({ getDataset: () => null });
let hostSnapshot = await host.open({ playgroundId: 'linear-regression', seed: 41 });
const hostBaselineId = hostSnapshot.experimentWorkspace.activeExperimentId;
hostSnapshot = await host.dispatch({ type: 'DUPLICATE_EXPERIMENT', actor: 'human' });
hostSnapshot = await host.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.2, actor: 'human' });
hostSnapshot = await host.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: hostBaselineId, actor: 'human' });
assert.equal(hostSnapshot.curiosity.available, true, 'Host presents the deterministic curiosity projection after a real clean comparison');
assert.equal(hostSnapshot.curiosity.reflectionOpportunities.length, 1, 'Host presents one deterministic reflection');
assert.equal(hostSnapshot.curiosity.opportunities[0].availableAction, 'inspect-mechanism', 'Host exposes only the registered mechanism capability for the reflection');
const hostFactsBeforeInspection = structuredClone({
  world: hostSnapshot.world,
  experimentWorkspace: hostSnapshot.experimentWorkspace,
  semanticEvents: hostSnapshot.semanticEvents,
});
const inspectedHost = host.inspectContext();
assert.deepEqual({
  world: host.getState().world,
  experimentWorkspace: host.getState().experimentWorkspace,
  semanticEvents: host.getState().semanticEvents,
}, hostFactsBeforeInspection, 'deriving and reading curiosity does not mutate runtime facts');
assert.deepEqual(host.inspectContext().exploration.curiosity, hostSnapshot.curiosity, 'Host snapshot and Agent inspection share one curiosity projection');
await host.close();

console.log('Curiosity loop checks passed: bounded registry, human-event provenance, unresolved reflections, safe opportunities, evidence guards, deterministic output, and provider-safe projection.');
