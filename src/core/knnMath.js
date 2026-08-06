// Shared KNN mathematics used by the browser runtime and every KNN playground.
// The distance metric is intentionally squared Euclidean: it preserves the
// existing runtime ranking semantics (monotonic with Euclidean distance, no
// square root). Do not change it without updating both consumers and tests.

export function fitFeatureNormalization(samples, featureCount) {
  const means = Array.from({ length: featureCount }, (_, feature) => (
    samples.reduce((sum, sample) => sum + sample.x[feature], 0) / samples.length
  ));
  const stds = Array.from({ length: featureCount }, (_, feature) => (
    Math.sqrt(samples.reduce(
      (sum, sample) => sum + (sample.x[feature] - means[feature]) ** 2,
      0,
    ) / samples.length) || 1
  ));
  return { means, stds };
}

export function normalizeFeatures(values, normalization) {
  return values.map((value, feature) => (
    (value - normalization.means[feature]) / normalization.stds[feature]
  ));
}

// Squared Euclidean distance between two feature vectors.
export function distance(left, right) {
  return left.reduce((sum, value, feature) => sum + (value - right[feature]) ** 2, 0);
}

// Ranks training samples by distance from the (already normalized) query.
// Stable sort preserves training order for equal distances, matching the
// runtime behavior exactly.
export function rankNeighbors(training, query, k) {
  return training
    .map((sample, index) => ({
      pointId: sample.id ?? sample.index ?? index,
      label: sample.y,
      distance: distance(sample.x, query),
    }))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, k);
}

// Votes over the ranked neighbors using the stable tie-break order:
// 1. more votes; 2. smaller total distance; 3. stable label order.
export function voteNeighbors(neighbors) {
  const votes = new Map();
  neighbors.forEach(({ label, distance: sampleDistance }) => {
    const current = votes.get(label) ?? { count: 0, distance: 0 };
    votes.set(label, { count: current.count + 1, distance: current.distance + sampleDistance });
  });
  const sorted = [...votes.entries()].sort((left, right) => (
    right[1].count - left[1].count
    || left[1].distance - right[1].distance
    || left[0].localeCompare(right[0])
  ));
  const counts = Object.fromEntries([...votes].map(([label, value]) => [label, value.count]));
  const distanceSums = Object.fromEntries([...votes].map(([label, value]) => [label, value.distance]));
  return {
    counts,
    distanceSums,
    predictedLabel: sorted[0]?.[0] ?? null,
    tie: sorted.length >= 2 && sorted[0][1].count === sorted[1][1].count,
    tieBreakReason: sorted.length >= 2 && sorted[0][1].count === sorted[1][1].count
      ? (sorted[0][1].distance === sorted[1][1].distance ? 'label' : 'distance')
      : null,
  };
}

// Predicts the label for raw (unnormalized) features using a fitted model.
export function predictKnn(model, rawFeatures) {
  const normalized = normalizeFeatures(rawFeatures, model.normalization);
  const neighbors = rankNeighbors(model.train, normalized, model.k);
  return voteNeighbors(neighbors).predictedLabel;
}
