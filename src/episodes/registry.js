import { EPISODE_ZERO, EPISODE_ZERO_ORCHESTRATION } from './episode0/index.js';
import { validateOrchestrationContractV1 } from '../core/orchestration/schema.js';

export const EPISODE_REGISTRY_VERSION = 1;
export const EPISODE_ZERO_ID = 'episode-0-world-data-model';
export const EPISODE_REGISTRY = Object.freeze({ [EPISODE_ZERO.id]: EPISODE_ZERO });

export function getEpisode(id) { return EPISODE_REGISTRY[id] ?? null; }
export function listEpisodes() { return Object.values(EPISODE_REGISTRY); }
export function validateEpisode(episode) {
  const errors = [];
  if (!episode?.id || !episode?.version || !episode?.explorationContractId) errors.push('identity');
  if (!episode?.orchestration || episode.orchestration.id !== episode.id) errors.push('orchestration');
  const contract = validateOrchestrationContractV1(episode?.orchestration);
  if (!contract.valid) errors.push(...contract.errors);
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}
export function validateEpisodeRegistry() {
  const results = Object.values(EPISODE_REGISTRY).map((episode) => ({ id: episode.id, ...validateEpisode(episode) }));
  return { valid: results.every((result) => result.valid), episodes: results };
}

export { EPISODE_ZERO, EPISODE_ZERO_ORCHESTRATION };
