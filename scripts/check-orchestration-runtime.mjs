import assert from 'node:assert/strict';
import { EPISODE_ZERO_ORCHESTRATION, getEpisode, listEpisodes, validateEpisodeRegistry } from '../src/episodes/registry.js';
import { deriveOrchestrationFacts } from '../src/core/orchestration/facts.js';
import { deriveOrchestrationState } from '../src/core/orchestration/runtime.js';
import { validateOrchestrationContractV1 } from '../src/core/orchestration/schema.js';
import { ORCHESTRATION_FALLBACK_LEVELS, ORCHESTRATION_MOMENTUM, deriveFallbackLevel } from '../src/core/orchestration/fallback.js';
import { SEMANTIC_AFFORDANCE_TARGETS } from '../src/core/orchestration/targets.js';
import { createPlaygroundHost } from '../src/core/playgroundHost.js';

assert.equal(listEpisodes().length, 1);
assert.equal(getEpisode('episode-0-world-data-model').id, 'episode-0-world-data-model');
assert.equal(validateEpisodeRegistry().valid, true);
const host = createPlaygroundHost({ getDataset: () => null });
const direct = await host.openBigIdeaEntrance({ id: 'episode-0-world-data-model', seed: 7101 });
assert.equal(direct.bigIdea.episodeId, 'episode-0-world-data-model');
assert.equal(direct.orchestrationRuntime.episodeId, 'episode-0-world-data-model');
host.close();

const initial = deriveOrchestrationState({ contract: EPISODE_ZERO_ORCHESTRATION, semanticEvents: { events: [] }, snapshot: {} });
assert.equal(initial.stageId, 'FOUNDATION');
assert.equal(initial.fallbackLevel, ORCHESTRATION_FALLBACK_LEVELS.VISUAL_CUE);
assert.equal(initial.lumi.semanticTarget, SEMANTIC_AFFORDANCE_TARGETS.WORLD_CANVAS);

const events = (types) => ({ events: types.map((type, index) => ({ id: `event-${index + 1}`, sequence: index + 1, type, actor: 'human', experimentIds: [] })) });
const oriented = deriveOrchestrationState({ contract: EPISODE_ZERO_ORCHESTRATION, semanticEvents: events(['world.intervened']), snapshot: {} });
assert.equal(oriented.stageId, 'BASELINE');
assert.ok(oriented.completedMilestones.includes('ORIENTATION'));

const outOfOrder = deriveOrchestrationState({ contract: EPISODE_ZERO_ORCHESTRATION, semanticEvents: events(['observation.sampled', 'model.fit-completed', 'model.fit-completed', 'comparison.completed']), snapshot: { inquiryRuntime: { evidence: { status: 'insufficient' }, baseline: { fit: { experimentId: 'a' } }, activeFit: { experimentId: 'b' }, comparison: { enabled: true, againstExperimentId: 'a' } } } });
assert.ok(outOfOrder.completedMilestones.includes('BASELINE'));
assert.ok(outOfOrder.completedMilestones.includes('RESAMPLE'));
assert.ok(outOfOrder.completedMilestones.includes('SECOND_FIT'));
assert.equal(outOfOrder.stageId, 'EVIDENCE');

const predicted = deriveOrchestrationState({ contract: EPISODE_ZERO_ORCHESTRATION, semanticEvents: events(['world.intervened']), memory: { prediction: { expectation: 'same' } } });
assert.ok(predicted.completedMilestones.includes('PREDICTION'));

const synthetic = {
  version: 1, id: 'synthetic-episode', explorationContractId: 'episode-1-sampling-variability', entryStage: 'start',
  stages: [
    { id: 'start', goalKey: 'episode.zero.goal.entry', completion: 'automatic', next: ['finish'] },
    { id: 'finish', goalKey: 'episode.zero.goal.foundation', completeWhen: { fact: 'meaningfulLearnerAction' }, targets: [SEMANTIC_AFFORDANCE_TARGETS.WORLD_CANVAS], next: [] },
  ],
  fallbackSpine: ['start', 'finish'],
  agentPolicy: { actionTypes: ['STAY_SILENT'] },
  continuations: [],
};
assert.equal(validateOrchestrationContractV1(synthetic).valid, true);
assert.equal(validateOrchestrationContractV1({ ...synthetic, stages: [{ ...synthetic.stages[0] }, { ...synthetic.stages[0] }], fallbackSpine: ['start'] }).valid, false);
assert.equal(deriveOrchestrationState({ contract: synthetic, semanticEvents: events(['world.intervened']), snapshot: {} }).stageId, 'finish');

assert.equal(deriveFallbackLevel({ momentum: ORCHESTRATION_MOMENTUM.ACTIVE }), ORCHESTRATION_FALLBACK_LEVELS.SILENCE);
assert.equal(deriveFallbackLevel({ momentum: ORCHESTRATION_MOMENTUM.IDLE, stageId: 'x', recentGuidance: [] }), ORCHESTRATION_FALLBACK_LEVELS.VISUAL_CUE);
assert.equal(deriveFallbackLevel({ momentum: ORCHESTRATION_MOMENTUM.STUCK, stageId: 'x', recentGuidance: [{ stageId: 'x' }] }), ORCHESTRATION_FALLBACK_LEVELS.SUGGEST_EXPERIMENT);

assert.deepEqual(deriveOrchestrationFacts({ snapshot: {}, semanticEvents: { events: [{ type: 'prediction.recorded', actor: 'human' }] } }).meaningfulLearnerAction, false);
console.log('Orchestration Runtime v1 checks passed');
