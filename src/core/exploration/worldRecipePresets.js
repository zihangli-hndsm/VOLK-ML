// Presets are shorthand for the canonical WorldRecipe grammar. They do not
// have a separate generator or materialization path.

import { normalizeWorldRecipe } from './worldRecipe.js';

const baseNoise = () => ({
  train: { position: { amount: 0.04 }, label: { probability: 0, policy: 'flip' }, outliers: { fraction: 0, placement: 'radial', distance: 2 }, local: [] },
  test: { position: { amount: 0.04 }, label: { probability: 0, policy: 'flip' }, outliers: { fraction: 0, placement: 'radial', distance: 2 }, local: [] },
});

const group = (id, label, shape, translate, count = 100) => ({
  id,
  label,
  shape,
  transform: { translate, rotate: 0, scale: [1, 1] },
  splitTransforms: { train: null, test: null },
  sampling: {
    train: { count, density: { type: 'uniform' } },
    test: { count: Math.round(count * 0.4), density: { type: 'uniform' } },
  },
});

const recipes = {
  rings: () => ({
    version: 1, task: 'classification', coordinateSpace: 'cartesian-2d',
    groups: [
      group('outer-ring', '0', { type: 'ring', params: { radius: 1.5, thickness: 0.24 } }, [0, 0]),
      group('inner-blob', '1', { type: 'blob', params: { radius: 0.65, aspect: [1, 1] } }, [0, 0]),
    ],
    noise: baseNoise(),
  }),
  moons: () => ({
    version: 1, task: 'classification', coordinateSpace: 'cartesian-2d',
    groups: [
      group('upper-moon', '0', { type: 'moon', params: { outerRadius: 1.1, innerRadius: 0.7, innerOffset: [0.35, 0], thickness: 0.05 } }, [-0.55, 0.25]),
      group('lower-moon', '1', { type: 'moon', params: { outerRadius: 1.1, innerRadius: 0.7, innerOffset: [0.35, 0], thickness: 0.05 } }, [0.55, -0.25]),
    ],
    noise: baseNoise(),
  }),
  xor: () => ({
    version: 1, task: 'classification', coordinateSpace: 'cartesian-2d',
    groups: [
      group('bottom-left', '0', { type: 'blob', params: { radius: 0.5, aspect: [1, 1] } }, [-0.8, -0.8], 70),
      group('top-right', '0', { type: 'blob', params: { radius: 0.5, aspect: [1, 1] } }, [0.8, 0.8], 70),
      group('top-left', '1', { type: 'blob', params: { radius: 0.5, aspect: [1, 1] } }, [-0.8, 0.8], 70),
      group('bottom-right', '1', { type: 'blob', params: { radius: 0.5, aspect: [1, 1] } }, [0.8, -0.8], 70),
    ],
    noise: baseNoise(),
  }),
  checkerboard: () => ({
    version: 1, task: 'classification', coordinateSpace: 'cartesian-2d',
    groups: [
      group('square-a1', '0', { type: 'rectangle', params: { width: 0.85, height: 0.85, fill: true, thickness: 0.1 } }, [-0.55, -0.55], 60),
      group('square-a2', '0', { type: 'rectangle', params: { width: 0.85, height: 0.85, fill: true, thickness: 0.1 } }, [0.55, 0.55], 60),
      group('square-b1', '1', { type: 'rectangle', params: { width: 0.85, height: 0.85, fill: true, thickness: 0.1 } }, [-0.55, 0.55], 60),
      group('square-b2', '1', { type: 'rectangle', params: { width: 0.85, height: 0.85, fill: true, thickness: 0.1 } }, [0.55, -0.55], 60),
    ],
    noise: baseNoise(),
  }),
};

export const WORLD_RECIPE_PRESET_IDS = Object.freeze(Object.keys(recipes));

export function getWorldRecipePreset(id) {
  const factory = recipes[String(id)];
  if (!factory) return null;
  return normalizeWorldRecipe(factory());
}

export function listWorldRecipePresets() {
  return WORLD_RECIPE_PRESET_IDS.map((id) => ({ id, recipe: getWorldRecipePreset(id) }));
}

