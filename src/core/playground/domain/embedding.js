// Bounded deterministic text embeddings for the local retrieval/RAG slice.
// This is deliberately not a claim of semantic pretraining: the runtime uses
// a stable hashing projection so vector-search behavior is reproducible,
// inspectable, and usable without a network provider.

export const EMBEDDING_DIMENSION_OPTIONS = Object.freeze([4, 8, 16]);
export const DEFAULT_EMBEDDING_DIMENSION = 8;

const MAX_TEXT_LENGTH = 512;

export function tokenizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .slice(0, MAX_TEXT_LENGTH)
    .split(/[^a-z0-9\u4e00-\u9fff]+/i)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 128);
}

function hashToken(token) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function signedUnit(hash) {
  const value = (hash % 2001) / 1000 - 1;
  return value === 0 ? 0.001 : value;
}

function normalize(vector) {
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm === 0) return vector.map(() => 0);
  return vector.map((value) => value / norm);
}

export function embedText(text, dimensions = DEFAULT_EMBEDDING_DIMENSION) {
  const size = Number(dimensions);
  if (!Number.isInteger(size) || !EMBEDDING_DIMENSION_OPTIONS.includes(size)) {
    throw new Error('EMBEDDING_DIMENSION_UNSUPPORTED');
  }
  const tokens = tokenizeText(text);
  const vector = Array.from({ length: size }, () => 0);
  tokens.forEach((token, tokenIndex) => {
    const hash = hashToken(token);
    for (let dimension = 0; dimension < size; dimension += 1) {
      const mixed = (hash + Math.imul(tokenIndex + 1, 374761393) + Math.imul(dimension + 1, 668265263)) >>> 0;
      vector[dimension] += signedUnit(mixed);
    }
  });
  return normalize(vector);
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return 0;
  const value = left.reduce((sum, item, index) => sum + Number(item) * Number(right[index]), 0);
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

export function projectEmbedding2d(vector) {
  if (!Array.isArray(vector) || !vector.length) return { x: 0, y: 0 };
  return {
    x: Number(vector[0] ?? 0),
    y: Number(vector[1] ?? vector[0] ?? 0),
  };
}

export function embedDocuments(documents, dimensions = DEFAULT_EMBEDDING_DIMENSION) {
  return documents.map((document) => ({
    id: document.id,
    vector: embedText(`${document.title} ${document.text}`, dimensions),
  }));
}
