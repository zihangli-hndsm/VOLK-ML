export const fallbackRegressionPoints = [
  { x: -4, y: -6.8 },
  { x: -3.2, y: -5.1 },
  { x: -2.4, y: -4.2 },
  { x: -1.5, y: -1.7 },
  { x: -0.8, y: -0.9 },
  { x: 0, y: 1.2 },
  { x: 0.7, y: 2.1 },
  { x: 1.5, y: 3.7 },
  { x: 2.3, y: 5.1 },
  { x: 3.1, y: 7.6 },
  { x: 4, y: 8.7 },
];

const finiteNumber = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function uniformlySamplePoints(points, limit = 80) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= limit) return sorted;
  return Array.from({ length: limit }, (_, index) => (
    sorted[Math.round(index * (sorted.length - 1) / (limit - 1))]
  ));
}

export function regressionPointsFromDataset(dataset, limit = 80) {
  const feature = dataset?.task === 'regression' ? dataset.featureColumns?.[0] : null;
  const target = dataset?.task === 'regression' ? dataset.targetColumn : null;
  if (!feature || !target || !Array.isArray(dataset.rows)) {
    return {
      points: fallbackRegressionPoints,
      total: fallbackRegressionPoints.length,
      feature: 'x',
      target: 'y',
      usingDataset: false,
    };
  }
  const valid = dataset.rows.flatMap((row) => {
    const x = finiteNumber(row[feature]);
    const y = finiteNumber(row[target]);
    return x === null || y === null ? [] : [{ x, y }];
  });
  if (valid.length < 2) {
    return {
      points: fallbackRegressionPoints,
      total: fallbackRegressionPoints.length,
      feature: 'x',
      target: 'y',
      usingDataset: false,
    };
  }
  return {
    points: uniformlySamplePoints(valid, limit),
    total: valid.length,
    feature,
    target,
    usingDataset: true,
  };
}

export function meanSquaredError(points, weight, bias) {
  if (!points.length) return 0;
  return points.reduce((sum, point) => {
    const error = point.y - (weight * point.x + bias);
    return sum + error ** 2;
  }, 0) / points.length;
}

export function leastSquaresFit(points) {
  if (!points.length) return { weight: 0, bias: 0 };
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const numerator = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
  const denominator = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  const weight = denominator > 0 ? numerator / denominator : 0;
  return { weight, bias: meanY - weight * meanX };
}

export function playgroundRanges(points) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const rawXMin = Math.min(...xs);
  const rawXMax = Math.max(...xs);
  const rawYMin = Math.min(...ys);
  const rawYMax = Math.max(...ys);
  const xSpan = Math.max(1, rawXMax - rawXMin);
  const ySpan = Math.max(1, rawYMax - rawYMin);
  const slopeScale = ySpan / xSpan;
  const weightLimit = Math.max(1, slopeScale * 4);
  return {
    xMin: rawXMin - xSpan * 0.08,
    xMax: rawXMax + xSpan * 0.08,
    yMin: rawYMin - ySpan * 0.12,
    yMax: rawYMax + ySpan * 0.12,
    weightMin: -weightLimit,
    weightMax: weightLimit,
    weightStep: weightLimit / 200,
    biasMin: rawYMin - ySpan * 1.5,
    biasMax: rawYMax + ySpan * 1.5,
    biasStep: ySpan / 200,
  };
}

// Gradient of the mean squared error with respect to weight and bias.
export function regressionGradient(points, weight, bias) {
  const count = points.length || 1;
  let weightGradient = 0;
  let biasGradient = 0;
  for (const point of points) {
    const error = point.y - (weight * point.x + bias);
    weightGradient += -2 * point.x * error;
    biasGradient += -2 * error;
  }
  const normalizedWeight = weightGradient / count;
  const normalizedBias = biasGradient / count;
  return {
    weight: normalizedWeight,
    bias: normalizedBias,
    magnitude: Math.hypot(normalizedWeight, normalizedBias),
  };
}

export function gradientDescentStep(points, weight, bias, learningRate) {
  const gradient = regressionGradient(points, weight, bias);
  return {
    weight: weight - learningRate * gradient.weight,
    bias: bias - learningRate * gradient.bias,
    gradient,
  };
}

// Deterministic training history for a fixed parameter schedule.
export function buildRegressionTrainingHistory(points, { weight, bias, learningRate, steps }) {
  const history = [];
  let current = { weight, bias };
  for (let step = 1; step <= steps; step += 1) {
    const gradient = regressionGradient(points, current.weight, current.bias);
    current = {
      weight: current.weight - learningRate * gradient.weight,
      bias: current.bias - learningRate * gradient.bias,
    };
    history.push({
      step,
      weight: current.weight,
      bias: current.bias,
      gradient,
      loss: meanSquaredError(points, current.weight, current.bias),
    });
  }
  return history;
}

// Gradient descent on z-scored x and y (the same training semantics as the
// browser runtime), with parameters converted back to original coordinates.
// Stops when a step produces non-finite values or loss grows twice in a row.
export function buildNormalizedRegressionHistory(points, { learningRate, steps }) {
  const normalization = fitLinearNormalization(points.map((point) => ({ x: [point.x], y: point.y })), 1);
  const normalizedPoints = points.map((point) => ({
    x: normalizeLinearPoint([point.x], normalization),
    y: normalizeLinearTarget(point.y, normalization),
  }));
  let weights = [0];
  let bias = 0;
  const history = [];
  let previousLoss = Infinity;
  let growthStreak = 0;
  for (let step = 1; step <= steps; step += 1) {
    const next = linearGradientStep(normalizedPoints, weights, bias, learningRate);
    weights = next.weights;
    bias = next.bias;
    const original = denormalizeLinearParameters(weights, bias, normalization);
    const weight = original.weights[0];
    const originalBias = original.bias;
    const loss = meanSquaredError(points, weight, originalBias);
    const finite = Number.isFinite(loss) && Number.isFinite(weight) && Number.isFinite(originalBias);
    const learningRateTooHigh = finite && loss > previousLoss && growthStreak >= 1;
    if (finite && loss > previousLoss) growthStreak += 1;
    else growthStreak = 0;
    history.push({ step, weight, bias: originalBias, loss, finite, learningRateTooHigh });
    if (!finite || learningRateTooHigh) break;
    previousLoss = loss;
  }
  return { history, normalization };
}
import {
  denormalizeLinearParameters,
  fitLinearNormalization,
  linearGradientStep,
  normalizeLinearPoint,
  normalizeLinearTarget,
} from './linearRegressionMath.js';
