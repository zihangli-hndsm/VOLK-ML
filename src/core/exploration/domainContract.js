// Cross-domain exploration contract. This is declarative: domains describe
// the semantic surfaces an adapter may expose while the existing runtime
// remains authoritative for execution and evidence.

export const EXPLORATION_DOMAIN_IDS = Object.freeze([
  'tabular',
  'image',
  'sequence',
  'retrieval',
  'rag',
]);

export const EXPLORATION_DOMAIN_CONTRACTS = Object.freeze({
  tabular: Object.freeze({
    id: 'tabular',
    worldKind: 'finite-observations',
    taskKinds: ['regression', 'classification'],
    coordinateSpaces: ['plot2d'],
    semanticDepths: ['phenomenon', 'evidence', 'mechanism', 'representation'],
    evidenceFamilies: ['distribution', 'outcome', 'comparison', 'training'],
    interventions: ['world-observations', 'generator-parameters', 'model-controls'],
    representation: ['plot2d'],
    probeId: 'tabular-regression',
  }),
  image: Object.freeze({
    id: 'image',
    worldKind: 'finite-labeled-images',
    taskKinds: ['classification'],
    coordinateSpaces: ['image', 'feature-map', 'embedding-2d'],
    semanticDepths: ['phenomenon', 'evidence', 'mechanism', 'representation'],
    evidenceFamilies: ['image-prediction', 'class-balance', 'comparison', 'training'],
    interventions: ['model-controls', 'representation-visibility'],
    representation: ['image', 'feature-map', 'embedding-2d'],
    probeId: 'image-classification',
  }),
  sequence: Object.freeze({
    id: 'sequence',
    worldKind: 'finite-token-sequences',
    taskKinds: ['classification', 'sequence-prediction'],
    coordinateSpaces: ['token-sequence', 'attention-matrix', 'embedding-2d'],
    semanticDepths: ['phenomenon', 'evidence', 'mechanism', 'representation'],
    evidenceFamilies: ['sequence-prediction', 'attention', 'comparison', 'training'],
    interventions: ['model-controls', 'attention-temperature', 'representation-visibility'],
    representation: ['token-sequence', 'attention-matrix', 'embedding-2d'],
    probeId: 'sequence-attention',
  }),
  retrieval: Object.freeze({
    id: 'retrieval',
    worldKind: 'finite-query-document-collection',
    taskKinds: ['retrieval'],
    coordinateSpaces: ['ranked-list', 'embedding-2d'],
    semanticDepths: ['phenomenon', 'evidence', 'mechanism', 'representation'],
    evidenceFamilies: ['ranking', 'coverage', 'comparison'],
    interventions: ['top-k', 'embedding-dimensions'],
    representation: ['ranked-list', 'embedding-2d'],
    probeId: 'retrieval-ranking',
  }),
  rag: Object.freeze({
    id: 'rag',
    worldKind: 'finite-grounded-context',
    taskKinds: ['grounded-generation'],
    coordinateSpaces: ['ranked-list', 'source-evidence'],
    semanticDepths: ['phenomenon', 'evidence', 'mechanism', 'representation'],
    evidenceFamilies: ['retrieval', 'citation', 'generation', 'comparison'],
    interventions: ['top-k', 'embedding-dimensions'],
    representation: ['ranked-list', 'source-evidence'],
    probeId: 'rag-grounding',
  }),
});

function domainError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  error.details = details;
  return error;
}

export function normalizeExplorationDomain(value, fallback = 'tabular') {
  const domain = value ?? fallback;
  if (!EXPLORATION_DOMAIN_IDS.includes(domain)) {
    throw domainError('EXPLORATION_DOMAIN_UNSUPPORTED', { domain });
  }
  return domain;
}

export function getExplorationDomainContract(value) {
  return EXPLORATION_DOMAIN_CONTRACTS[normalizeExplorationDomain(value)] ?? null;
}

export function domainSupportsTask(domain, task) {
  return Boolean(task && getExplorationDomainContract(domain)?.taskKinds.includes(task));
}

export function summarizeExplorationDomain(domain) {
  const contract = getExplorationDomainContract(domain);
  return contract ? structuredClone(contract) : null;
}

export function getExplorationDomainCapabilities(domain) {
  const contract = getExplorationDomainContract(domain);
  if (!contract) return null;
  return {
    version: 1,
    domain: contract.id,
    interventions: [...(contract.interventions ?? [])],
    representation: [...(contract.representation ?? [])],
    evidenceFamilies: [...contract.evidenceFamilies],
    semanticDepths: [...contract.semanticDepths],
  };
}

// Agent-safe projection. Domain payloads remain available to deterministic
// adapters, but this projection intentionally contains only bounded semantic
// counts and capability metadata. It never serializes pixels, tokens, rows,
// document text, embeddings, or query content.
export function projectDomainContext({ domain, world, data, model } = {}) {
  const normalized = normalizeExplorationDomain(domain);
  const observations = Array.isArray(world?.observations) ? world.observations : [];
  const memberships = {
    train: observations.filter((item) => item.membership !== 'test').length,
    test: observations.filter((item) => item.membership === 'test').length,
  };
  const labels = [...new Set(observations.map((item) => item.label).filter(Boolean))].slice(0, 16);
  return {
    version: 1,
    domain: normalized,
    task: world?.task ?? data?.task ?? null,
    coordinateSpace: world?.coordinateSpace ?? getExplorationDomainContract(normalized)?.coordinateSpaces?.[0] ?? null,
    observationCount: observations.length,
    memberships,
    labelCount: labels.length,
    labels,
    capabilities: getExplorationDomainCapabilities(normalized),
    modelCapabilities: model && typeof model === 'object'
      ? Object.fromEntries(Object.entries(model).filter(([key, value]) => typeof value === 'boolean' && value).map(([key]) => [key, true]))
      : {},
  };
}

function finite(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw domainError('EXPLORATION_DOMAIN_PAYLOAD_INVALID', { field });
  return number;
}

function boundedString(value, field, max = 128) {
  if (typeof value !== 'string' || !value || value.length > max) {
    throw domainError('EXPLORATION_DOMAIN_PAYLOAD_INVALID', { field });
  }
  return value;
}

export function normalizeDomainObservationPayload(domain, payload, field = 'payload') {
  const normalizedDomain = normalizeExplorationDomain(domain);
  if (payload === undefined || payload === null) return undefined;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw domainError('EXPLORATION_DOMAIN_PAYLOAD_INVALID', { field });
  }
  if (normalizedDomain === 'image') {
    const width = finite(payload.width, `${field}.width`);
    const height = finite(payload.height, `${field}.height`);
    if (!Number.isInteger(width) || width < 1 || width > 64 || !Number.isInteger(height) || height < 1 || height > 64) {
      throw domainError('EXPLORATION_DOMAIN_PAYLOAD_INVALID', { field: `${field}.dimensions` });
    }
    const pixels = payload.pixels;
    if (!Array.isArray(pixels) || pixels.length !== width * height || pixels.length > 4096) {
      throw domainError('EXPLORATION_DOMAIN_PAYLOAD_INVALID', { field: `${field}.pixels` });
    }
    return {
      kind: 'image',
      width,
      height,
      pixels: pixels.map((value, index) => {
        const number = finite(value, `${field}.pixels[${index}]`);
        if (number < 0 || number > 1) throw domainError('EXPLORATION_DOMAIN_PAYLOAD_INVALID', { field: `${field}.pixels[${index}]` });
        return number;
      }),
    };
  }
  if (normalizedDomain === 'sequence') {
    if (!Array.isArray(payload.tokens) || payload.tokens.length < 1 || payload.tokens.length > 256) {
      throw domainError('EXPLORATION_DOMAIN_PAYLOAD_INVALID', { field: `${field}.tokens` });
    }
    return {
      kind: 'sequence',
      tokens: payload.tokens.map((token, index) => boundedString(token, `${field}.tokens[${index}]`, 64)),
    };
  }
  if (normalizedDomain === 'retrieval') {
    return {
      kind: 'retrieval',
      query: boundedString(payload.query, `${field}.query`, 512),
      documentIds: Array.isArray(payload.documentIds)
        ? payload.documentIds.slice(0, 128).map((id, index) => boundedString(id, `${field}.documentIds[${index}]`, 128))
        : [],
    };
  }
  if (normalizedDomain === 'rag') {
    return {
      kind: 'rag',
      query: boundedString(payload.query, `${field}.query`, 512),
      sourceIds: Array.isArray(payload.sourceIds)
        ? payload.sourceIds.slice(0, 32).map((id, index) => boundedString(id, `${field}.sourceIds[${index}]`, 128))
        : [],
    };
  }
  return structuredClone(payload);
}
