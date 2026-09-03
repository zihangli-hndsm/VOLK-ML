import { DIRECTOR_BEATS, DIRECTOR_HANDOFF } from '../../core/director/directorPrototype.js';

export const EPISODE_ZERO_PRESENTATION = Object.freeze({
  version: 1,
  id: 'episode-0-world-data-model-presentation',
  director: { beats: DIRECTOR_BEATS, handoff: DIRECTOR_HANDOFF },
  lumi: { defaultPresence: 'ambient', modes: ['ambient', 'look', 'guide', 'notice', 'think', 'silent'] },
});
