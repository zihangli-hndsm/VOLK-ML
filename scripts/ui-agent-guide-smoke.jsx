import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import assert from 'node:assert/strict';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';
import { createPlaygroundAgentApi } from '../src/core/playgroundAgent.js';
import { getPlayground } from '../src/core/playgrounds/registry.js';
import { CONCEPTUAL_DEPTHS } from '../src/core/ui/uiArchitecture.js';
import { classifyAgentGuideRequest, deriveAgentComparisonExplanation, AGENT_GUIDANCE_OUTCOMES } from '../src/core/ui/agentGuide.js';
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
