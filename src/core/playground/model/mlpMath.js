// Pure MLP mathematics shared by the browser runtime, the model adapter and
// the contract tests. Everything is deterministic: data generation and
// parameter initialization use a seeded PRNG, so the same seed + controls
// replay to exactly the same training/prediction outcome.

export const DEFAULT_MLP_SEED = 2026;

// Small deterministic PRNG (mulberry32). No Math.random() anywhere.
export function createSeededRandom(seed = DEFAULT_MLP_SEED) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic 2D XOR classification data: two class 'a' clusters at
// (-1,-1)/(1,1) and two class 'b' clusters at (-1,1)/(1,-1), with seeded
// Gaussian noise. Labels mirror the KNN convention (string labels).
export function generateXorDataset({
  seed = DEFAULT_MLP_SEED,
  pointsPerCluster = 10,
  noise = 0.25,
} = {}) {
  const random = createSeededRandom(seed);
  const normal = () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = random();
    while (v === 0) v = random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const clusters = [
    { center: [-1, -1], label: 'a' },
    { center: [1, 1], label: 'a' },
    { center: [-1, 1], label: 'b' },
    { center: [1, -1], label: 'b' },
  ];
  const points = [];
  let index = 0;
  for (const cluster of clusters) {
    for (let count = 0; count < pointsPerCluster; count += 1) {
      points.push({
        id: `p${index}`,
        features: {
          x1: Number((cluster.center[0] + normal() * noise).toFixed(4)),
          x2: Number((cluster.center[1] + normal() * noise).toFixed(4)),
        },
        label: cluster.label,
      });
      index += 1;
    }
  }
  return points;
}

const round = (value, digits = 4) => Number(value.toFixed(digits));

// Initializes a 1-hidden-layer MLP with moderately scaled random weights:
// weights in [-1, 1] and biases in [-0.5, 0.5]. Larger-than-tiny initial
// weights matter on XOR: full-batch gradients through a near-zero W2 stay
// microscopic and the network barely learns.
export function initMlpParameters({ hiddenSize, inputSize = 2, seed = DEFAULT_MLP_SEED }) {
  const random = createSeededRandom(seed + hiddenSize * 31);
  const W1 = Array.from({ length: hiddenSize }, () => (
    Array.from({ length: inputSize }, () => round(random() * 2 - 1))
  ));
  const b1 = Array.from({ length: hiddenSize }, () => round(random() - 0.5));
  const W2 = Array.from({ length: 1 }, () => (
    Array.from({ length: hiddenSize }, () => round(random() * 2 - 1))
  ));
  const b2 = round(random() - 0.5);
  return { W1, b1, W2, b2 };
}

export function forwardMlp(params, x) {
  const { W1, b1, W2, b2 } = params;
  const z1 = W1.map((row, hidden) => (
    row.reduce((sum, weight, input) => sum + weight * x[input], 0) + b1[hidden]
  ));
  const a1 = z1.map(Math.tanh);
  const z2 = W2[0].reduce((sum, weight, hidden) => sum + weight * a1[hidden], 0) + b2;
  const probability = 1 / (1 + Math.exp(-z2));
  return { z1, a1, z2, probability };
}

export function predictMlp(params, x) {
  const { probability } = forwardMlp(params, x);
  return {
    probability,
    label: probability >= 0.5 ? 'b' : 'a',
  };
}

// Backpropagation for the 1-hidden-layer tanh network with binary
// cross-entropy loss (standard for sigmoid classification, and it converges
// much faster than MSE on XOR). Returns the gradients for every parameter
// tensor.
export function mlpGradients(params, x, target) {
  const { W1, b1, W2 } = params;
  const { a1, z1, z2, probability } = forwardMlp(params, x);
  // Binary cross-entropy with sigmoid: dL/dz2 = probability - target.
  const dZ2 = probability - target;
  const dW2 = a1.map((activation) => dZ2 * activation);
  const dB2 = dZ2;
  const dA1 = W2[0].map((weight) => dZ2 * weight);
  const dZ1 = a1.map((activation, hidden) => dA1[hidden] * (1 - activation * activation));
  const dW1 = W1.map((row, hidden) => row.map((_, input) => dZ1[hidden] * x[input]));
  const dB1 = dZ1;
  return { dW1, dB1, dW2, dB2 };
}

export function mlpLossForSamples(params, samples) {
  let total = 0;
  for (const sample of samples) {
    const { probability } = forwardMlp(params, sample.x);
    const clipped = Math.min(0.999999, Math.max(0.000001, probability));
    total += -(sample.y * Math.log(clipped) + (1 - sample.y) * Math.log(1 - clipped));
  }
  return total / Math.max(1, samples.length);
}

function finiteParams(params) {
  const values = [
    ...params.W1.flat(),
    ...params.b1,
    ...params.W2.flat(),
    params.b2,
  ];
  return values.every(Number.isFinite);
}

// Deterministic full-batch gradient-descent training. Returns the final
// parameters plus a per-step history with loss, representative parameter
// movement (weight / bias) and the stop reason, mirroring the LR adapter's
// failure semantics:
//   'learning-rate-too-high' when a finite step increases the loss,
//   'diverged' when parameters become non-finite.
export function trainMlp({ samples, params, learningRate, steps, seed = DEFAULT_MLP_SEED }) {
  let current = {
    W1: params.W1.map((row) => [...row]),
    b1: [...params.b1],
    W2: params.W2.map((row) => [...row]),
    b2: params.b2,
  };
  const history = [];
  let previousLoss = mlpLossForSamples(current, samples);
  let stopReason = null;
  for (let step = 1; step <= steps; step += 1) {
    const gradients = samples.reduce((accumulated, sample) => {
      const gradient = mlpGradients(current, sample.x, sample.y);
      return {
        dW1: accumulated.dW1.map((row, hidden) => row.map((value, input) => value + gradient.dW1[hidden][input])),
        dB1: accumulated.dB1.map((value, hidden) => value + gradient.dB1[hidden]),
        dW2: accumulated.dW2.map((value, hidden) => value + gradient.dW2[hidden]),
        dB2: accumulated.dB2 + gradient.dB2,
      };
    }, {
      dW1: current.W1.map((row) => row.map(() => 0)),
      dB1: current.b1.map(() => 0),
      dW2: current.W2[0].map(() => 0),
      dB2: 0,
    });
    const count = Math.max(1, samples.length);
    const next = {
      W1: current.W1.map((row, hidden) => row.map((value, input) => value - learningRate * gradients.dW1[hidden][input] / count)),
      b1: current.b1.map((value, hidden) => value - learningRate * gradients.dB1[hidden] / count),
      W2: current.W2.map((row) => row.map((value, hidden) => value - learningRate * gradients.dW2[hidden] / count)),
      b2: current.b2 - learningRate * gradients.dB2 / count,
    };
    if (!finiteParams(next)) {
      stopReason = 'diverged';
      break;
    }
    const nextLoss = mlpLossForSamples(next, samples);
    const gradientMagnitude = Math.sqrt(
      gradients.dW1.flat().reduce((sum, value) => sum + value * value, 0)
      + gradients.dB1.reduce((sum, value) => sum + value * value, 0)
      + gradients.dW2.reduce((sum, value) => sum + value * value, 0)
      + gradients.dB2 * gradients.dB2,
    ) / count;
    history.push({
      step,
      loss: nextLoss,
      weight: next.W1[0][0],
      bias: next.b1[0],
      gradientMagnitude,
    });
    if (nextLoss - previousLoss > 1e-9 * Math.max(1, Math.abs(previousLoss))) {
      stopReason = 'learning-rate-too-high';
      break;
    }
    previousLoss = nextLoss;
    current = next;
  }
  return { params: current, history, stopReason };
}

// Computes a 2D decision-region grid (cells with predicted labels) over a
// padded feature range, using the same resolution convention as KNN.
export function computeMlpDecisionRegions({ params, points, resolution = 48 }) {
  const xs = points.map((point) => point.features.x1);
  const ys = points.map((point) => point.features.x2);
  const xSpan = Math.max(1, Math.max(...xs) - Math.min(...xs));
  const ySpan = Math.max(1, Math.max(...ys) - Math.min(...ys));
  const xMin = Math.min(...xs) - xSpan * 0.08;
  const xMax = Math.max(...xs) + xSpan * 0.08;
  const yMin = Math.min(...ys) - ySpan * 0.08;
  const yMax = Math.max(...ys) + ySpan * 0.08;
  const cells = [];
  for (let row = 0; row < resolution; row += 1) {
    const y = yMin + ((row + 0.5) / resolution) * (yMax - yMin);
    for (let column = 0; column < resolution; column += 1) {
      const x = xMin + ((column + 0.5) / resolution) * (xMax - xMin);
      cells.push({ x, y, label: predictMlp(params, [x, y]).label });
    }
  }
  return { resolution, cells, xMin, xMax, yMin, yMax };
}
