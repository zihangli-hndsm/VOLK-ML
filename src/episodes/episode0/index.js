import { EPISODE_ZERO_ORCHESTRATION, EPISODE_ZERO_ORCHESTRATION_ID } from './orchestration.js';
import { EPISODE_ZERO_PRESENTATION } from './presentation.js';

export const EPISODE_ZERO = Object.freeze({
  id: EPISODE_ZERO_ORCHESTRATION_ID,
  version: 1,
  title: 'episode.zero.title',
  titleKey: 'episode.zero.title',
  type: 'introductory-inquiry',
  explorationContractId: 'episode-1-sampling-variability',
  orchestrationVersion: EPISODE_ZERO_ORCHESTRATION.version,
  presentationVersion: EPISODE_ZERO_PRESENTATION.version,
  conceptIds: ['SAMPLING_VARIABILITY'],
  prerequisiteConceptIds: [],
  orchestration: EPISODE_ZERO_ORCHESTRATION,
  orchestrationContract: EPISODE_ZERO_ORCHESTRATION,
  presentation: EPISODE_ZERO_PRESENTATION,
});

export { EPISODE_ZERO_ORCHESTRATION, EPISODE_ZERO_PRESENTATION };
