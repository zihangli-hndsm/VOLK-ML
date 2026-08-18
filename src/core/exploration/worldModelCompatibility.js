// Stable classification for adapter/World compatibility failures. Runtime
// validation errors, stale proposals, and resource failures must not be
// presented as model incompatibility.

const WORLD_MODEL_COMPATIBILITY_CODES = new Set([
  'world-adapter-unsupported',
  'world-task-incompatible',
]);

export function isWorldModelCompatibilityError(error) {
  return error?.code === 'INVALID_PLAYGROUND_ACTION'
    && WORLD_MODEL_COMPATIBILITY_CODES.has(error.details?.reasonCode);
}
