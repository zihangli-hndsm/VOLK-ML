// Shared linear regression training math used by the browser runtime and the
// Linear Regression playground. Training runs on z-scored x and y; parameters
// are converted back to original coordinates for prediction and display.

export function fitLinearNormalization(points, featureCount) {
  const xMeans = Array.from({ length: featureCount }, (_, feature) => (
    points.reduce((sum, sample) => sum + sample.x[feature], 0) / points.length
  ));
  const xStds = Array.from({ length: featureCount }, (_, feature) => (
    Math.sqrt(points.reduce(
      (sum, sample) => sum + (sample.x[feature] - xMeans[feature]) ** 2,
      0,
    ) / points.length) || 1
  ));
  const yMean = points.reduce((sum, sample) => sum + sample.y, 0) / points.length;
  const yStd = Math.sqrt(points.reduce(
    (sum, sample) => sum + (sample.y - yMean) ** 2,
    0,
  ) / points.length) || 1;
  return { xMeans, xStds, yMean, yStd };
}

export function normalizeLinearPoint(x, normalization) {
  return x.map((value, feature) => (value - normalization.xMeans[feature]) / normalization.xStds[feature]);
}

export function normalizeLinearTarget(y, normalization) {
  return (y - normalization.yMean) / normalization.yStd;
}

// One mini-batch-free gradient descent step on normalized points. Loss is the
// mean squared error in normalized space, matching the runtime semantics.
export function linearGradientStep(normalizedPoints, weights, bias, learningRate) {
  let loss = 0;
  const dw = weights.map(() => 0);
  let db = 0;
  normalizedPoints.forEach(({ x, y }) => {
    const error = weights.reduce((sum, weight, feature) => sum + weight * x[feature], bias) - y;
    loss += error * error;
    dw.forEach((_, feature) => { dw[feature] += 2 * error * x[feature]; });
    db += 2 * error;
  });
  loss /= normalizedPoints.length;
  return {
    weights: weights.map((weight, feature) => weight - learningRate * (dw[feature] / normalizedPoints.length)),
    bias: bias - learningRate * (db / normalizedPoints.length),
    loss,
  };
}

export function denormalizeLinearParameters(weights, bias, normalization) {
  const weightsPerFeature = weights.map((weight, feature) => (
    weight * (normalization.yStd / normalization.xStds[feature])
  ));
  return {
    weights: weightsPerFeature,
    bias: normalization.yMean + bias * normalization.yStd
      - weightsPerFeature.reduce((sum, weight, feature) => sum + weight * normalization.xMeans[feature], 0),
  };
}
