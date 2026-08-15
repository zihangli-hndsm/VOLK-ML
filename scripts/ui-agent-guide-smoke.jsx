import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createPlaygroundAgentApi } from '../src/core/playgroundAgent.js';
import { getPlayground } from '../src/core/playgrounds/registry.js';
import { CONCEPTUAL_DEPTHS } from '../src/core/ui/uiArchitecture.js';
import { classifyAgentGuideRequest, deriveAgentComparisonExplanation, deriveAgentSemanticExplanation, routeAgentAiInterpretation, AGENT_GUIDANCE_OUTCOMES } from '../src/core/ui/agentGuide.js';
import { createExplorationAiInterpreter } from '../src/core/exploration/explorationAiInterpreter.js';
import ExploreDetailsRegion from '../src/components/playground/ExploreDetailsRegion.jsx';
import { AiProvider } from '../src/components/ai/AiProviderContext.jsx';
import { resolveMessage } from '../src/i18n.js';

const t = (key, params) => resolveMessage(key, 'en', params);
const noop = () => {};

function renderDetails(snapshot, agent, agentOpen = false, activeDepth = null) {
  return renderToStaticMarkup(
    <AiProvider>
      <ExploreDetailsRegion
        snapshot={snapshot}
        modelPlayground={snapshot.modelPlaygroundId ? getPlayground(snapshot.modelPlaygroundId) : null}
        bigIdea={null}
        agent={agent}
        host={null}
        activeDepth={activeDepth}
        onDepthChange={noop}
        agentOpen={agentOpen}
        onAgentOpen={noop}
        onAgentClose={noop}
        onDispatch={noop}
        onGuidanceChange={noop}
        formulaPrimitive={snapshot.primitives.find((primitive) => primitive.type === 'formula')}
        t={t}
      />
    </AiProvider>
  );
}

function identity(snapshot) {
  return {
    world: snapshot.world,
    experiment: snapshot.experimentWorkspace,
    model: snapshot.model,
  };
}

export async function runUiAgentGuideSmoke() {
  const host = createPlaygroundHost({ getDataset: () => null });
  try {
    await host.open({ playgroundId: 'linear-regression', seed: 601 });
    const agent = createPlaygroundAgentApi(host);
    const snapshot = host.getState();
    const agentPresentationContext = agent.inspectContext({ presentation: {
      currentDepth: null,
      comparisonActive: false,
      availableDepths: [CONCEPTUAL_DEPTHS.EVIDENCE, CONCEPTUAL_DEPTHS.MECHANISM, CONCEPTUAL_DEPTHS.REPRESENTATION],
    } });
    assert.deepEqual(agentPresentationContext.presentation, {
      currentDepth: null,
      comparisonActive: false,
      availableDepths: [CONCEPTUAL_DEPTHS.EVIDENCE, CONCEPTUAL_DEPTHS.MECHANISM, CONCEPTUAL_DEPTHS.REPRESENTATION],
    }, 'Agent receives bounded presentation context without DOM details');

    const disabledMarkup = renderDetails(snapshot, null);
    assert.equal(disabledMarkup.includes('Ask about what you see'), false, 'Agent-disabled path has no Agent entry');
    assert.ok(disabledMarkup.includes('What changed?'), 'manual depth path remains available without Agent');

    const availableMarkup = renderDetails(snapshot, agent);
    assert.ok(availableMarkup.includes('Ask about what you see'), 'available Agent has a quiet secondary entry');
    assert.equal(availableMarkup.includes('role="dialog"'), false, 'Agent surface is closed initially');

    const evidenceOutcome = classifyAgentGuideRequest({ request: 'What changed?', capabilities: { evidence: true, mechanism: true, representation: true }, snapshot });
    assert.deepEqual(evidenceOutcome, { kind: AGENT_GUIDANCE_OUTCOMES.OPEN_DEPTH, depth: CONCEPTUAL_DEPTHS.EVIDENCE });
    const mechanismOutcome = classifyAgentGuideRequest({ request: 'How does it learn?', capabilities: { evidence: true, mechanism: true, representation: true }, snapshot });
    assert.deepEqual(mechanismOutcome, { kind: AGENT_GUIDANCE_OUTCOMES.OPEN_DEPTH, depth: CONCEPTUAL_DEPTHS.MECHANISM });
    const representationOutcome = classifyAgentGuideRequest({ request: 'Where can I change the learning rate?', capabilities: { evidence: true, mechanism: true, representation: true }, snapshot });
    assert.deepEqual(representationOutcome, { kind: AGENT_GUIDANCE_OUTCOMES.OPEN_DEPTH, depth: CONCEPTUAL_DEPTHS.REPRESENTATION });
    const learningProposal = classifyAgentGuideRequest({ request: 'What happens if I increase the learning rate?', capabilities: { evidence: true, mechanism: true, representation: true }, snapshot });
    assert.equal(learningProposal.kind, AGENT_GUIDANCE_OUTCOMES.EXPERIMENT_PROPOSAL, 'learning-rate intervention is not mistaken for navigation');
    assert.equal(learningProposal.intent, 'learning-rate-increase');
    const noiseNavigation = classifyAgentGuideRequest({ request: 'Where can I change noise?', capabilities: { evidence: true, mechanism: true, representation: true }, snapshot });
    const noiseProposal = classifyAgentGuideRequest({ request: 'What happens if I increase noise?', capabilities: { evidence: true, mechanism: true, representation: true }, snapshot });
    assert.notEqual(noiseNavigation.kind, noiseProposal.kind, 'noise navigation and noise intervention use different speech-act routes');
    assert.equal(noiseNavigation.reason, 'world-control');
    assert.equal(noiseProposal.intent, 'harder-noise');
    assert.deepEqual(classifyAgentGuideRequest({ request: 'What does slope mean here?', capabilities: { evidence: true, mechanism: true, representation: true }, snapshot }), { kind: AGENT_GUIDANCE_OUTCOMES.EXPLANATION, topic: 'slope' });
    assert.equal(deriveAgentSemanticExplanation('slope', snapshot).available, true, 'registered semantic explanations stay bounded');

    const lrProposal = agent.proposeExploration({ request: 'What happens if I increase the learning rate?', intent: learningProposal.intent });
    assert.equal(lrProposal.kind, 'proposal', 'supported learning-rate intervention reaches the semantic planner');
    assert.equal(lrProposal.scenario.change[0].parameters.key, 'learningRate');
    let aiPrompt = '';
    const aiGateway = { complete: async ({ messages }) => { aiPrompt = messages[0].content; return { protocol: 'mock', text: JSON.stringify({ intent: 'harder-noise', requestedChange: 'more noise', requestedHolds: ['model'], ambiguity: null }) }; } };
    const aiInterpreter = createExplorationAiInterpreter({ gateway: aiGateway });
    const aiOutcome = routeAgentAiInterpretation({
      interpretation: await aiInterpreter.interpret({ request: 'Could we see whether this is noisier?', context: agent.inspectContext({ presentation: { currentDepth: null, comparisonActive: false, availableDepths: [] } }), config: { protocol: 'openai-compatible', apiKey: 'test', model: 'test', endpoint: 'https://example.test' } }),
      request: 'Could we see whether this is noisier?',
      snapshot,
    });
    assert.equal(aiOutcome.kind, AGENT_GUIDANCE_OUTCOMES.EXPERIMENT_PROPOSAL, 'configured AI interpretation maps into a bounded proposal');
    assert.equal(/"x"\s*:|"y"\s*:|e\d+/.test(aiPrompt), false, 'AI intent context does not include raw point coordinates or ids');
    const failingInterpreter = createExplorationAiInterpreter({ gateway: { complete: async () => { throw new Error('offline'); } } });
    await assert.rejects(() => failingInterpreter.interpret({ request: 'unclear question', context: {}, config: { protocol: 'openai-compatible', apiKey: 'test', model: 'test', endpoint: 'https://example.test' } }), /unavailable/i);
    assert.equal(classifyAgentGuideRequest({ request: 'What happens if I increase noise?', capabilities: { evidence: true, mechanism: true, representation: true }, snapshot }).intent, 'harder-noise', 'local classifier remains useful when AI interpretation fails');

    const knnHost = createPlaygroundHost({ getDataset: () => null });
    try {
      await knnHost.open({ playgroundId: 'knn-classification', seed: 602 });
      const knn = knnHost.getState();
      const decisionOutcome = classifyAgentGuideRequest({ request: 'How does it decide?', capabilities: { evidence: true, mechanism: true }, snapshot: knn });
      assert.deepEqual(decisionOutcome, { kind: AGENT_GUIDANCE_OUTCOMES.OPEN_DEPTH, depth: CONCEPTUAL_DEPTHS.MECHANISM }, 'KNN uses the existing decision mechanism depth');
      assert.equal(knn.trainingMicroscope?.available ?? false, false, 'KNN does not acquire fabricated training evidence');
    } finally {
      await knnHost.close();
    }

    const beforeProposal = identity(host.getState());
    const proposal = agent.proposeExploration({ request: 'What happens if I add some outliers?' });
    assert.equal(proposal.kind, 'proposal');
    assert.ok(proposal.scenario.change.some((change) => change.semanticTarget === 'outliers'), 'proposal resolves through the existing semantic planner');
    assert.deepEqual(identity(host.getState()), beforeProposal, 'proposal is preview-only');
    const result = await agent.executeExploration(proposal.scenario);
    assert.ok(result.mutationDiff.changed.includes('world'), 'explicit execution changes the runtime World');
    assert.equal(host.getState().experimentWorkspace.experiments.length, 2, 'Agent execution uses the ordinary Experiment runtime');

    const baselineId = host.getState().experimentWorkspace.experiments[0].id;
    await agent.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.2 });
    await agent.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: baselineId });
    const mixedSnapshot = host.getState();
    const mixedOutcome = classifyAgentGuideRequest({ request: 'Is this a clean comparison?', capabilities: { evidence: true, mechanism: true, representation: true }, snapshot: mixedSnapshot });
    assert.deepEqual(mixedOutcome, { kind: AGENT_GUIDANCE_OUTCOMES.EXPLANATION, topic: 'comparison' });
    assert.deepEqual(mixedSnapshot.experimentWorkspace.comparison.diff.changed, ['world', 'learning']);
    assert.equal(mixedSnapshot.experimentWorkspace.comparison.diff.clarity, 'mixed', 'mixed guidance reads the runtime comparison clarity');
    assert.deepEqual(deriveAgentComparisonExplanation(mixedSnapshot).changed, mixedSnapshot.experimentWorkspace.comparison.diff.changed);

    const cleaner = agent.proposeCleanerComparison();
    assert.equal(cleaner.kind, 'cleaner-proposals', 'mixed comparison exposes only preflighted cleaner proposals');
    assert.ok(cleaner.options.some((option) => option.factor === 'world'));
    assert.ok(cleaner.options.every((option) => option.scenario.execution.compareAgainstExperimentId === baselineId));
    assert.ok(cleaner.options.every((option) => !option.scenario.change.some((change) => change.semanticTarget === 'outliers')), 'cleaner comparison is not hard-coded to outliers');
    const worldCleaner = cleaner.options.find((option) => option.factor === 'world');
    assert.ok(worldCleaner.scenario.hold.includes('learning-configuration'));
    const cleaned = await agent.executeExploration(worldCleaner.scenario);
    assert.deepEqual(cleaned.mutationDiff.changed, ['world'], 'cleaner execution leaves exactly one changed runtime factor');
    assert.equal(cleaned.mutationDiff.clarity, 'high');

    const alternateHost = createPlaygroundHost({ getDataset: () => null });
    try {
      await alternateHost.open({ playgroundId: 'linear-regression', seed: 603 });
      const alternateAgent = createPlaygroundAgentApi(alternateHost);
      const original = alternateAgent.getState();
      const originalId = original.experimentWorkspace.activeExperimentId;
      const point = original.world.observations[0];
      await alternateAgent.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
      const branchB = alternateAgent.getState().experimentWorkspace.activeExperimentId;
      await alternateAgent.dispatch({ type: 'APPLY_WORLD_TRANSACTION', transaction: { operations: [{ type: 'MOVE_POINT', pointId: point.id, x: point.x + 1, y: point.y + 1 }] } });
      await alternateAgent.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.2 });
      await alternateAgent.dispatch({ type: 'DUPLICATE_EXPERIMENT' });
      const branchC = alternateAgent.getState().experimentWorkspace.activeExperimentId;
      await alternateAgent.dispatch({ type: 'APPLY_WORLD_TRANSACTION', transaction: { operations: [{ type: 'MOVE_POINT', pointId: point.id, x: point.x + 2, y: point.y + 2 }] } });
      await alternateAgent.dispatch({ type: 'SET_CONTROL', key: 'learningRate', value: 0.3 });
      await alternateAgent.dispatch({ type: 'SET_COMPARE', enabled: true, againstExperimentId: branchB });
      const alternateComparison = alternateAgent.getState().experimentWorkspace.comparison;
      assert.equal(alternateComparison.againstExperimentId, branchB);
      assert.deepEqual(alternateComparison.diff.changed, ['world', 'learning']);
      const alternateCleaner = alternateAgent.proposeCleanerComparison();
      assert.equal(alternateCleaner.kind, 'cleaner-proposals');
      assert.ok(alternateCleaner.options.every((option) => option.scenario.execution.compareAgainstExperimentId === branchB), 'cleaner proposal uses the explicit C versus B target');
      const alternateResult = await alternateAgent.executeExploration(alternateCleaner.options.find((option) => option.factor === 'learning').scenario);
      assert.deepEqual(alternateResult.mutationDiff.changed, ['learning']);
      assert.equal(alternateAgent.getState().experimentWorkspace.comparison.againstExperimentId, branchB);
      assert.notEqual(branchC, originalId);
    } finally {
      await alternateHost.close();
    }

    const comparisonSnapshot = host.getState();
    const explanation = deriveAgentComparisonExplanation(comparisonSnapshot);
    assert.ok(['comparison', 'mixed-comparison'].includes(explanation.kind), 'comparison explanation reads runtime diff');
    assert.deepEqual(explanation.changed, comparisonSnapshot.experimentWorkspace.comparison.diff.changed, 'Agent guide does not infer changed factors separately');

    const openDepthCalls = [];
    const surfaceMarkup = renderDetails(host.getState(), agent, true, null);
    assert.ok(surfaceMarkup.includes('Agent exploration guide'), 'Agent surface has an accessible bounded presentation');
    assert.ok(surfaceMarkup.includes('Advanced Agent tools'), 'advanced Agent capabilities remain reachable');
    assert.equal(surfaceMarkup.includes('document.querySelector'), false, 'Agent surface contains no DOM navigation');
    assert.equal(openDepthCalls.length, 0);

    return { passed: true, experimentCount: host.getState().experimentWorkspace.experiments.length };
  } finally {
    await host.close();
  }
}
