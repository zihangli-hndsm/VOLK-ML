export const EXPLORATION_INTENTS = Object.freeze({
  OUTLIERS: 'outliers',
  TEST_SHIFT: 'test-shift',
  TWO_DISTRIBUTIONS: 'two-distributions',
  HARDER_NOISE: 'harder-noise',
  LINE_MOVE: 'line-move',
  LEARNING_RATE_INCREASE: 'learning-rate-increase',
  LEARNING_RATE_DECREASE: 'learning-rate-decrease',
});

export const EXPLORATION_INTENT_IDS = Object.freeze(Object.values(EXPLORATION_INTENTS));

export function isExplorationIntent(value) {
  return EXPLORATION_INTENT_IDS.includes(value);
}
