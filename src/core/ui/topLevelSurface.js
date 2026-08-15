import { UI_SURFACES } from './uiArchitecture.js';

export const DEFAULT_TOP_LEVEL_SURFACE = UI_SURFACES.EXPLORE;

export function createTopLevelSurfaceState({ surface = DEFAULT_TOP_LEVEL_SURFACE, runtime } = {}) {
  if (!Object.values(UI_SURFACES).includes(surface)) throw new TypeError(`Unknown top-level surface: ${String(surface)}`);
  return Object.freeze({ surface, runtime });
}

export function switchTopLevelSurface(state, surface) {
  const next = createTopLevelSurfaceState({ surface, runtime: state?.runtime });
  if (state && Object.prototype.hasOwnProperty.call(state, 'runtime') && next.runtime !== state.runtime) {
    throw new TypeError('Top-level surface switching must preserve the shared runtime reference.');
  }
  return next;
}
