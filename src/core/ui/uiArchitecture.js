// UI-0 contracts. These descriptors describe presentation intent only; they
// never own or copy World, Experiment, model, or evidence state.

export const UI_SURFACES = Object.freeze({
  EXPLORE: 'explore',
  BUILD: 'build',
});

export const CONCEPTUAL_DEPTHS = Object.freeze({
  PHENOMENON: 'phenomenon',
  EVIDENCE: 'evidence',
  MECHANISM: 'mechanism',
  REPRESENTATION: 'representation',
  BUILDER: 'builder',
});

export const PRESENTATION_BANDS = Object.freeze({
  COMPACT: 'compact',
  MEDIUM: 'medium',
  WIDE: 'wide',
});

const SURFACE_DESCRIPTORS = Object.freeze({
  explore: Object.freeze({
    id: 'explore',
    titleKey: 'ui.surface.explore',
    purpose: 'learner-facing experimentation over shared runtime state',
    owns: Object.freeze(['world-manipulation', 'experiment', 'evidence', 'mechanism']),
    stateAuthority: 'shared-runtime',
  }),
  build: Object.freeze({
    id: 'build',
    titleKey: 'ui.surface.build',
    purpose: 'architecture, construction, and engineering detail over shared runtime state',
    owns: Object.freeze(['architecture', 'component-graph', 'engineering-controls', 'export']),
    stateAuthority: 'shared-runtime',
  }),
});

const DEPTH_DESCRIPTORS = Object.freeze({
  phenomenon: Object.freeze({ id: 'phenomenon', titleKey: 'ui.depth.phenomenon', order: 0 }),
  evidence: Object.freeze({ id: 'evidence', titleKey: 'ui.depth.evidence', order: 1 }),
  mechanism: Object.freeze({ id: 'mechanism', titleKey: 'ui.depth.mechanism', order: 2 }),
  representation: Object.freeze({ id: 'representation', titleKey: 'ui.depth.representation', order: 3 }),
  builder: Object.freeze({ id: 'builder', titleKey: 'ui.depth.builder', order: 4 }),
});

export const UI_RESPONSIBILITY_MAP = Object.freeze({
  context: Object.freeze({ owner: 'explore-shell', examples: Object.freeze(['navigation', 'exploration-title', 'project-actions']) }),
  worldManipulation: Object.freeze({ owner: 'explore', examples: Object.freeze(['draw', 'move', 'erase', 'world-operations']) }),
  experiment: Object.freeze({ owner: 'explore', examples: Object.freeze(['duplicate', 'compare', 'repeat', 'restore']) }),
  evidence: Object.freeze({ owner: 'explore', examples: Object.freeze(['residuals', 'metrics', 'train-test', 'observations']) }),
  mechanism: Object.freeze({ owner: 'explore-depth', examples: Object.freeze(['loss', 'learning-rate', 'training-steps', 'gradient', 'normalization']) }),
  build: Object.freeze({ owner: 'build', examples: Object.freeze(['architecture', 'component-graph', 'engineering-controls', 'export']) }),
});

// These are explicit migration seams, not a second component/state tree. Each
// future surface may move behind the named seam while continuing to consume
// the same Playground host snapshot and semantic actions.
export const UI_MIGRATION_SEAMS = Object.freeze({
  contextBar: Object.freeze({ owner: 'explore-shell', current: 'PlaygroundToolbar' }),
  worldSurface: Object.freeze({ owner: 'explore', current: 'PlaygroundStage + DataWorkspace + WorldBuilder' }),
  experimentBar: Object.freeze({ owner: 'explore', current: 'ExperimentBar' }),
  depthDisclosure: Object.freeze({ owner: 'explore-depth', current: 'ExplorationEvidence + PlaygroundTimeline + TrainingMicroscopePanel + PlaygroundInspector' }),
  agentEntry: Object.freeze({ owner: 'explore', current: 'ExplorationAgentPanel + PlaygroundAgentPanel' }),
  buildEntry: Object.freeze({ owner: 'build', current: 'Workspace toolbar + component library + graph + parameters + export' }),
});

function assertKnown(map, value, label) {
  if (!Object.prototype.hasOwnProperty.call(map, value)) {
    throw new TypeError(`Unknown ${label}: ${String(value)}`);
  }
  return value;
}

export function getSurfaceDescriptor(surface = UI_SURFACES.EXPLORE) {
  return structuredClone(SURFACE_DESCRIPTORS[assertKnown(SURFACE_DESCRIPTORS, surface, 'UI surface')]);
}

export function getConceptualDepthDescriptor(depth = CONCEPTUAL_DEPTHS.PHENOMENON) {
  return structuredClone(DEPTH_DESCRIPTORS[assertKnown(DEPTH_DESCRIPTORS, depth, 'conceptual depth')]);
}

export function listUiSurfaces() {
  return Object.values(SURFACE_DESCRIPTORS).map((descriptor) => structuredClone(descriptor));
}

export function listConceptualDepths() {
  return Object.values(DEPTH_DESCRIPTORS).sort((left, right) => left.order - right.order).map((descriptor) => structuredClone(descriptor));
}

function normalizeWidth(value) {
  if (!Number.isFinite(Number(value)) || Number(value) < 0) return null;
  return Math.round(Number(value));
}

function normalizeEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

export function classifyPresentationCapabilities({
  containerWidth,
  availableWidth,
  pointer = 'unknown',
  hover = 'unknown',
  orientation = 'unknown',
} = {}) {
  const width = normalizeWidth(containerWidth ?? availableWidth);
  const band = width === null
    ? PRESENTATION_BANDS.MEDIUM
    : width < 640
      ? PRESENTATION_BANDS.COMPACT
      : width < 1024
        ? PRESENTATION_BANDS.MEDIUM
        : PRESENTATION_BANDS.WIDE;
  const normalizedPointer = normalizeEnum(pointer, ['coarse', 'fine', 'unknown'], 'unknown');
  const normalizedHover = normalizeEnum(hover, ['available', 'none', 'unknown'], 'unknown');
  const normalizedOrientation = normalizeEnum(orientation, ['portrait', 'landscape', 'unknown'], 'unknown');
  return Object.freeze({
    band,
    containerWidth: width,
    pointer: normalizedPointer,
    hover: normalizedHover,
    orientation: normalizedOrientation,
    inspectorPresentation: band === PRESENTATION_BANDS.COMPACT ? 'bottom-sheet' : 'drawer-or-sidebar',
    comparePresentation: band === PRESENTATION_BANDS.WIDE ? 'side-by-side' : 'overlay-or-swipe',
  });
}

export function createUiPresentationState({
  surface = UI_SURFACES.EXPLORE,
  depth = CONCEPTUAL_DEPTHS.PHENOMENON,
  capabilities,
} = {}) {
  assertKnown(SURFACE_DESCRIPTORS, surface, 'UI surface');
  assertKnown(DEPTH_DESCRIPTORS, depth, 'conceptual depth');
  const responsive = capabilities ?? classifyPresentationCapabilities();
  return Object.freeze({
    surface,
    depth,
    responsive: structuredClone(responsive),
  });
}

// This adapter deliberately keeps the runtime snapshot as the one semantic
// state tree. Future Explore/Build layouts can consume this object without
// creating a second project or experiment store.
export function deriveUiPresentation({ snapshot, ...view } = {}) {
  return {
    ...createUiPresentationState(view),
    runtime: snapshot ?? null,
  };
}
