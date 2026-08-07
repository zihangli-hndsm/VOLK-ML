// Shared linear regression mathematics used by the browser runtime and every
// linear regression playground.
//
// Training always happens in a standardized (z-score) feature/target space so
// a fixed learning rate is stable across datasets with very different scales.
// Parameters are converted back to raw coordinates for display and prediction.
// The runtime and the playground both step through createLinearRegressionTrainer
// / stepLinearRegressionTrainer so their traces cannot drift apart.

export function fitLinearNormalization(points, featureCount) {
  const samples = points.map((point) => ({ x: Array.isArray(point.x) ? point.x : [point.x], y: point.y }));
  const count = featureCount ?? samples[0]?.x.length ?? 1;
  const xMeans = Array.from({ length: count }, (_, feature) => (
    samples.reduce((sum, sample) => sum + sample.x[feature], 0) / samples.length
  ));
  const xStds = Array.from({ length: count }, (_, feature) => (
    Math.sqrt(samples.reduce(
      (sum, sample) => sum + (sample.x[feature] - xMeans[feature]) ** 2,
      0,
    ) / samples.length) || 1
  ));
  const yMean = samples.reduce((sum, sample) => sum + sample.y, 0) / samples.length;
  const yStd = Math.sqrt(samples.reduce(
    (sum, sample) => sum + (sample.y - yMean) ** 2,
    0,
  ) / samples.length) || 1;
  return { xMeans, xStds, yMean, yStd };
}

export function normalizeLinearPoint(x, normalization) {
  return x.map((value, feature) => (
    (value - normalization.xMeans[feature]) / normalization.xStds[feature]
  ));
}

export function normalizeLinearTarget(y, normalization) {
  return (y - normalization.yMean) / normalization.yStd;
}

// Converts normalized-space parameters back into raw feature coordinates.
// For one feature:
//   W = w * yStd / xStd
//   B = yMean + b * yStd - W * xMean
export function denormalizeLinearParameters({ weights, bias, normalization }) {
  const { xMeans, xStds, yMean, yStd } = normalization;
  const rawWeights = weights.map((weight, feature) => weight * yStd / xStds[feature]);
  const rawBias = yMean + bias * yStd
    - rawWeights.reduce((sum, weight, feature) => sum + weight * xMeans[feature], 0);
  return { weights: rawWeights, bias: rawBias };
}

// Converts raw feature-coordinate parameters into normalized space.
// For one feature:
//   w = W * xStd / yStd
//   b = (B - yMean + W * xMean) / yStd
export function normalizeLinearParameters({ weights, bias, normalization }) {
  const { xMeans, xStds, yMean, yStd } = normalization;
  const normalizedWeights = weights.map((weight, feature) => weight * xStds[feature] / yStd);
  const normalizedBias = (bias - yMean
    + weights.reduce((sum, weight, feature) => sum + weight * xMeans[feature], 0)) / yStd;
  return { weights: normalizedWeights, bias: normalizedBias };
}

// Fits standardization statistics and returns a trainer object. The trainer
// itself is a plain data object; stepping it produces the next parameters.
export function createLinearRegressionTrainer(points) {
  const samples = points.map((point) => ({ x: Array.isArray(point.x) ? [...point.x] : [point.x], y: point.y }));
  const featureCount = samples[0]?.x.length ?? 1;
  const normalization = fitLinearNormalization(samples, featureCount);
  return {
    featureCount,
    normalization,
    rawPoints: samples,
    normalizedPoints: samples.map((sample) => ({
      x: normalizeLinearPoint(sample.x, normalization),
      y: normalizeLinearTarget(sample.y, normalization),
    })),
  };
}

// One gradient descent step in standardized space. Returns the next parameters
// in both normalized and raw coordinates plus the loss and gradient for the
// current parameters. The gradient is the derivative of the normalized MSE
// (the browser runtime convention), so the update is `param - lr * gradient`.
export function stepLinearRegressionTrainer(trainer, { weights, bias, learningRate }) {
  const { featureCount, normalization, rawPoints, normalizedPoints } = trainer;
  const weightsArray = (Array.isArray(weights) ? weights : [weights]).map(Number);
  const biasValue = Number(bias);
  const learningRateValue = Number(learningRate);
  const count = Math.max(1, normalizedPoints.length);
  let lossSum = 0;
  const gradientWeights = Array.from({ length: featureCount }, () => 0);
  let gradientBias = 0;
  normalizedPoints.forEach((sample) => {
    const prediction = weightsArray.reduce(
      (sum, weight, feature) => sum + weight * sample.x[feature],
      biasValue,
    );
    const error = prediction - sample.y;
    lossSum += error * error;
    gradientWeights.forEach((_, feature) => { gradientWeights[feature] += 2 * error * sample.x[feature]; });
    gradientBias += 2 * error;
  });
  const lossNormalized = lossSum / count;
  const gradient = {
    weights: gradientWeights.map((value) => value / count),
    bias: gradientBias / count,
    magnitude: Math.hypot(gradientBias / count, ...gradientWeights.map((value) => value / count)),
  };
  const normalizedParameters = {
    weights: weightsArray.map((weight, feature) => (
      weight - learningRateValue * gradient.weights[feature]
    )),
    bias: biasValue - learningRateValue * gradient.bias,
  };
  const rawParameters = denormalizeLinearParameters({ weights: normalizedParameters.weights, bias: normalizedParameters.bias, normalization });
  const lossRaw = rawPoints.length
    ? rawPoints.reduce((sum, sample) => {
      const prediction = rawParameters.weights.reduce(
        (total, weight, feature) => total + weight * sample.x[feature],
        rawParameters.bias,
      );
      const error = prediction - sample.y;
      return sum + error * error;
    }, 0) / rawPoints.length
    : 0;
  const nextLossNormalized = normalizedPoints.length
    ? normalizedPoints.reduce((sum, sample) => {
      const prediction = normalizedParameters.weights.reduce(
        (total, weight, feature) => total + weight * sample.x[feature],
        normalizedParameters.bias,
      );
      const error = prediction - sample.y;
      return sum + error * error;
    }, 0) / normalizedPoints.length
    : 0;
  return {
    normalizedParameters,
    rawParameters,
    normalization,
    lossNormalized,
    lossRaw,
    nextLossRaw: lossRaw,
    nextLossNormalized,
    gradient,
  };
}
