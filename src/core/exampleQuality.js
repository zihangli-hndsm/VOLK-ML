// Pure, dependency-free teaching-example quality checks.

export function classDistribution(dataset) {
  const counts = new Map();
  for (const row of dataset.rows) {
    const label = row?.[dataset.targetColumn];
    counts.set(String(label), (counts.get(String(label)) ?? 0) + 1);
  }
  const total = dataset.rows.length || 1;
  return Object.fromEntries([...counts].map(([label, count]) => [label, count / total]));
}

function thresholdAccuracy(values) {
  // values: [{ projected, label }]; find the best threshold that splits labels
  // into two sides, each predicted by its majority class.
  const sorted = [...values].sort((a, b) => a.projected - b.projected);
  if (sorted.length < 2) return 0;
  let leftCounts = new Map();
  let rightCounts = new Map();
  for (const item of sorted) rightCounts.set(item.label, (rightCounts.get(item.label) ?? 0) + 1);
  let best = 0;
  const total = sorted.length;
  let leftTotal = 0;
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const item = sorted[index];
    leftCounts.set(item.label, (leftCounts.get(item.label) ?? 0) + 1);
    rightCounts.set(item.label, rightCounts.get(item.label) - 1);
    leftTotal += 1;
    if (sorted[index].projected === sorted[index + 1].projected) continue;
    const leftBest = Math.max(...leftCounts.values());
    const rightBest = Math.max(...rightCounts.values());
    const accuracy = (leftBest + rightBest) / total;
    if (accuracy > best) best = accuracy;
  }
  return best;
}

export function bestSingleFeatureThresholdAccuracy(dataset) {
  let best = 0;
  for (const column of dataset.featureColumns) {
    const values = dataset.rows
      .filter((row) => Number.isFinite(Number(row[column])))
      .map((row) => ({ projected: Number(row[column]), label: String(row[dataset.targetColumn]) }));
    if (values.length < 2) continue;
    best = Math.max(best, thresholdAccuracy(values));
  }
  return best;
}

export function bestLinearSeparatorAccuracy2D(dataset) {
  const [xFeature, yFeature] = dataset.featureColumns;
  if (!xFeature || !yFeature) return 0;
  const points = dataset.rows
    .filter((row) => Number.isFinite(Number(row[xFeature])) && Number.isFinite(Number(row[yFeature])))
    .map((row) => ({ label: String(row[dataset.targetColumn]), x: Number(row[xFeature]), y: Number(row[yFeature]) }));
  if (points.length < 2) return 0;
  let best = 0;
  for (let degrees = 0; degrees < 180; degrees += 1) {
    const radians = (degrees / 180) * Math.PI;
    const dx = Math.cos(radians);
    const dy = Math.sin(radians);
    const projected = points.map((point) => ({ label: point.label, projected: point.x * dx + point.y * dy }));
    best = Math.max(best, thresholdAccuracy(projected));
  }
  return best;
}

export function regressionR2(actual, predicted) {
  if (!actual.length) return 0;
  const mean = actual.reduce((sum, value) => sum + value, 0) / actual.length;
  const total = actual.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  if (total === 0) return 1;
  const residual = actual.reduce((sum, value, index) => sum + (value - predicted[index]) ** 2, 0);
  return 1 - residual / total;
}

export function validateDatasetContract(dataset, contract = {}) {
  const failures = [];
  if (!dataset) return [{ field: 'dataset', actual: null, expected: 'present' }];
  if (contract.minRows !== undefined && dataset.rows.length < contract.minRows) {
    failures.push({ field: 'rows', actual: dataset.rows.length, expected: `>= ${contract.minRows}` });
  }
  if (contract.maxRows !== undefined && dataset.rows.length > contract.maxRows) {
    failures.push({ field: 'rows', actual: dataset.rows.length, expected: `<= ${contract.maxRows}` });
  }
  if (contract.minFeatures !== undefined && dataset.featureColumns.length < contract.minFeatures) {
    failures.push({ field: 'features', actual: dataset.featureColumns.length, expected: `>= ${contract.minFeatures}` });
  }
  if (dataset.featureColumns.includes(dataset.targetColumn)) {
    failures.push({ field: 'features', actual: 'target in features', expected: 'disjoint' });
  }
  if (contract.classBalance) {
    const distribution = classDistribution(dataset);
    for (const fraction of Object.values(distribution)) {
      if (fraction < contract.classBalance.min || fraction > contract.classBalance.max) {
        failures.push({ field: 'classBalance', actual: fraction, expected: `[${contract.classBalance.min}, ${contract.classBalance.max}]` });
      }
    }
  }
  if (contract.maxSingleFeatureThresholdAccuracy !== undefined) {
    const accuracy = bestSingleFeatureThresholdAccuracy(dataset);
    if (accuracy >= contract.maxSingleFeatureThresholdAccuracy) {
      failures.push({ field: 'maxSingleFeatureThresholdAccuracy', actual: accuracy, expected: `< ${contract.maxSingleFeatureThresholdAccuracy}` });
    }
  }
  if (contract.maxLinearSeparatorAccuracy !== undefined) {
    const accuracy = bestLinearSeparatorAccuracy2D(dataset);
    if (accuracy >= contract.maxLinearSeparatorAccuracy) {
      failures.push({ field: 'maxLinearSeparatorAccuracy', actual: accuracy, expected: `< ${contract.maxLinearSeparatorAccuracy}` });
    }
  }
  return failures;
}

export function validateInputShapeAgainstDataset(nodes, dataset) {
  if (!dataset) return [];
  const failures = [];
  for (const node of nodes) {
    if (node.data?.manifest?.op !== 'tensor_input') continue;
    const shape = String(node.data.parameters.shape ?? '').trim();
    const parsed = Number(shape);
    if (Number.isInteger(parsed) && parsed > 0 && parsed !== dataset.featureColumns.length) {
      failures.push({
        field: 'inputShape',
        actual: parsed,
        expected: dataset.featureColumns.length,
        node: node.id,
      });
    }
  }
  return failures;
}

// Structural guard against post-label mutation: applied datasets must declare
// that labels were sampled from a probability after features were generated.
export function validateNoPostLabelMutationMetadata(definition) {
  if (!definition) return [{ field: 'definition', actual: null, expected: 'present' }];
  const failures = [];
  if (definition.labelSampling !== 'probability') {
    failures.push({ field: 'labelSampling', actual: definition.labelSampling ?? null, expected: 'probability' });
  }
  if (definition.featuresGeneratedBeforeLabels !== true) {
    failures.push({ field: 'featuresGeneratedBeforeLabels', actual: definition.featuresGeneratedBeforeLabels ?? null, expected: true });
  }
  return failures;
}

// Checks that the trainer model path contains at least one nonlinear activation
// between consecutive dense layers.
export function validateRequiredNonlinearity(nodes, edges) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const output = nodes.find((node) => node.data?.manifest?.op === 'model_output');
  if (!output) return [];
  const incoming = (node) => edges.filter((edge) => edge.target === node.id);
  const sourceOf = (node, handle) => {
    const edge = incoming(node).find((item) => item.targetHandle === handle);
    return edge ? byId.get(edge.source) : null;
  };
  const ops = [];
  let current = sourceOf(output, 'input');
  const seen = new Set();
  while (current && current.data?.manifest?.op !== 'tensor_input' && !seen.has(current.id)) {
    seen.add(current.id);
    ops.push(current.data.manifest.op);
    current = sourceOf(current, 'input');
  }
  const activations = new Set(['relu', 'sigmoid', 'tanh', 'gelu', 'softmax']);
  const hasActivationBetweenDense = ops.some((op, index) => (
    activations.has(op) && ops[index - 1] === 'dense' && ops[index + 1] === 'dense'
  ));
  return hasActivationBetweenDense
    ? []
    : [{ field: 'requiredNonlinearity', actual: [...ops].reverse().join('->'), expected: 'dense->activation->dense' }];
}

export function validateExampleTeachingContract(example, project, runResult, extra = {}) {
  const contract = example.teachingContract ?? {};
  const failures = project.data ? validateDatasetContract(project.data, contract) : [];
  failures.push(...validateInputShapeAgainstDataset(project.graph.nodes, project.data));
  if (contract.requiredNonlinearity) {
    failures.push(...validateRequiredNonlinearity(project.graph.nodes, project.graph.edges));
  }
  if (contract.expectedBrowserResult && runResult) {
    const metric = contract.expectedBrowserResult.metric;
    const value = runResult?.metrics?.[metric];
    if (typeof value !== 'number') {
      failures.push({ field: `expectedBrowserResult.${metric}`, actual: value ?? null, expected: 'a number' });
    } else {
      if (contract.expectedBrowserResult.min !== undefined && value < contract.expectedBrowserResult.min) {
        failures.push({ field: `expectedBrowserResult.${metric}`, actual: value, expected: `>= ${contract.expectedBrowserResult.min}` });
      }
      if (contract.expectedBrowserResult.max !== undefined && value > contract.expectedBrowserResult.max) {
        failures.push({ field: `expectedBrowserResult.${metric}`, actual: value, expected: `<= ${contract.expectedBrowserResult.max}` });
      }
    }
  }
  if (contract.linearBaselineGap !== undefined && extra.linearBaselineR2 !== undefined && runResult) {
    const gap = runResult.metrics.r2 - extra.linearBaselineR2;
    if (gap < contract.linearBaselineGap) {
      failures.push({ field: 'linearBaselineGap', actual: gap, expected: `>= ${contract.linearBaselineGap}` });
    }
  }
  return failures;
}
