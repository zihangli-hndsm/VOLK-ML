// Deterministic teaching datasets for the example projects.
// Every dataset is generated from an explicit seed; no Math.random() anywhere.
// Feature generation always completes before labels are sampled, so labels can
// never leak back into inputs.

import { generateXorDataset, XOR_CONCEPT_DATASET_SPEC } from './playground/model/mlpMath.js';

export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomNormal(random) {
  let spare = null;
  return () => {
    if (spare !== null) {
      const value = spare;
      spare = null;
      return value;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = random() * 2 - 1;
      v = random() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const multiplier = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * multiplier;
    return u * multiplier;
  };
}

const round = (value, digits = 3) => Number(value.toFixed(digits));
const sigmoid = (value) => 1 / (1 + Math.exp(-value));

function datasetShape(name, task, rows, featureColumns, targetColumn, trainRatio = 0.8) {
  const names = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return {
    name,
    task,
    rows,
    columns: names.map((name) => ({
      name,
      type: rows.every((row) => Number.isFinite(Number(row[name]))) ? 'number' : 'text',
      missing: 0,
    })),
    featureColumns,
    targetColumn,
    trainRatio,
  };
}

function linearTrend() {
  const random = createSeededRandom(2026);
  const normal = randomNormal(random);
  const rows = Array.from({ length: 120 }, (_, index) => {
    const x = round(-4 + random() * 8);
    const y = round(1.8 * x + 0.7 + normal() * 0.65);
    return { x, y };
  });
  return datasetShape('Linear Trend', 'regression', rows, ['x'], 'y', 0.8);
}

function housePrice() {
  const random = createSeededRandom(2027);
  const normal = randomNormal(random);
  const rows = Array.from({ length: 170 }, (_, index) => {
    const area = round(50 + random() * 160);
    const bedrooms = Math.max(1, Math.min(6, 1 + Math.floor(random() * 3) + (area > 140 ? 1 : 0) + (area > 190 ? 1 : 0)));
    const age = Math.floor(random() * 45);
    const price = round(28 + 1.45 * area + 13.5 * bedrooms - 0.7 * age + normal() * 12);
    return { area_sqm: area, bedrooms, age_years: age, price };
  });
  return datasetShape('House Prices', 'regression', rows, ['area_sqm', 'bedrooms', 'age_years'], 'price', 0.8);
}

function knnNeighborhood() {
  const random = createSeededRandom(2028);
  const normal = randomNormal(random);
  const rows = Array.from({ length: 200 }, (_, index) => {
    const theta = random() * Math.PI;
    const x1 = index % 2 === 0
      ? Math.cos(theta) + normal() * 0.12
      : 1 - Math.cos(theta) + normal() * 0.12;
    const x2 = index % 2 === 0
      ? Math.sin(theta) + normal() * 0.12
      : 0.5 - Math.sin(theta) + normal() * 0.12;
    return {
      x1: round(x1),
      x2: round(x2),
      label: index % 2 === 0 ? 'a' : 'b',
    };
  });
  return datasetShape('KNN Neighborhood', 'classification', rows, ['x1', 'x2'], 'label', 0.8);
}

function iris() {
  const random = createSeededRandom(2029);
  const specs = [
    ['setosa', 4.5, 1.3, 3.0, 1.0, 1.0, 0.9, 0.1, 0.4],
    ['versicolor', 5.0, 1.5, 2.2, 1.0, 3.0, 2.2, 1.0, 0.8],
    ['virginica', 5.8, 1.7, 2.4, 1.0, 4.6, 1.8, 1.4, 1.0],
  ];
  const rows = [];
  for (let group = 0; group < 3; group += 1) {
    const [label, sepalMin, sepalSpan, sepalWMin, sepalWSpan, petalMin, petalSpan, petalWMin, petalWSpan] = specs[group];
    for (let index = 0; index < 50; index += 1) {
      rows.push({
        sepal_length: round(sepalMin + random() * sepalSpan),
        sepal_width: round(sepalWMin + random() * sepalWSpan),
        petal_length: round(petalMin + random() * petalSpan),
        petal_width: round(petalWMin + random() * petalWSpan),
        species: label,
      });
    }
  }
  return datasetShape(
    'Iris Flowers',
    'classification',
    rows,
    ['sepal_length', 'sepal_width', 'petal_length', 'petal_width'],
    'species',
    0.8,
  );
}

function xorMlpConcept() {
  const points = generateXorDataset(XOR_CONCEPT_DATASET_SPEC);
  const rows = points.map((point) => ({
    x1: point.features.x1,
    x2: point.features.x2,
    label: point.label,
  }));
  return datasetShape('XOR Concept', 'classification', rows, ['x1', 'x2'], 'label', 0.75);
}

function xorMlpRobustness() {
  const random = createSeededRandom(2030);
  const rows = Array.from({ length: 240 }, (_, index) => {
    const magnitude1 = 0.15 + random() * 0.85;
    const magnitude2 = 0.15 + random() * 0.85;
    const x1 = round(random() < 0.5 ? -magnitude1 : magnitude1);
    const x2 = round(random() < 0.5 ? -magnitude2 : magnitude2);
    const baseLabel = x1 * x2 >= 0 ? 'a' : 'b';
    const label = random() < 0.05 ? (baseLabel === 'a' ? 'b' : 'a') : baseLabel;
    return { x1, x2, label };
  });
  return datasetShape('XOR Label Noise Robustness', 'classification', rows, ['x1', 'x2'], 'label', 0.8);
}

function spam() {
  const random = createSeededRandom(2031);
  const rows = Array.from({ length: 400 }, (_, index) => {
    const word_count = 20 + Math.floor(random() * 260);
    const link_count = Math.floor(random() * 16);
    const uppercase_ratio = round(random());
    const suspicious_word_count = Math.floor(random() * 12);
    const sender_reputation = round(random() * 4 - 2);
    const attachment_count = Math.floor(random() * 4);
    const personalization_score = round(random());
    const reply_chain_depth = Math.floor(random() * 8);
    const send_hour = Math.floor(random() * 24);
    const subject_length = 10 + Math.floor(random() * 70);
    const score = (
      0.7 * link_count * (sender_reputation < 0 ? 1 : 0)
      + 1.6 * uppercase_ratio * (suspicious_word_count / 12)
      + 1.0 * attachment_count * (1 - personalization_score)
      + 0.4 * (word_count / 280)
      - 3.071
    );
    const label = random() < sigmoid(score) ? 'spam' : 'ham';
    return {
      word_count,
      link_count,
      uppercase_ratio,
      suspicious_word_count,
      sender_reputation,
      attachment_count,
      personalization_score,
      reply_chain_depth,
      send_hour,
      subject_length,
      label,
    };
  });
  return datasetShape(
    'Email Spam',
    'classification',
    rows,
    [
      'word_count',
      'link_count',
      'uppercase_ratio',
      'suspicious_word_count',
      'sender_reputation',
      'attachment_count',
      'personalization_score',
      'reply_chain_depth',
      'send_hour',
      'subject_length',
    ],
    'label',
    0.8,
  );
}

function energyDemand() {
  const random = createSeededRandom(2032);
  const normal = randomNormal(random);
  const rows = Array.from({ length: 320 }, (_, index) => {
    const temperature = round(-5 + random() * 40);
    const humidity = round(30 + random() * 60);
    const occupancy = round(random());
    const hour = random() * 24;
    const hour_sin = round(Math.sin((hour / 24) * 2 * Math.PI));
    const hour_cos = round(Math.cos((hour / 24) * 2 * Math.PI));
    const heating = Math.max(0, 14 - temperature) * 5.2;
    const cooling = Math.max(0, temperature - 22) * 5.2;
    const morningPeak = 11 * (0.5 + 0.5 * Math.cos(((hour - 8) / 24) * 2 * Math.PI));
    const eveningPeak = 12 * (0.5 + 0.5 * Math.cos(((hour - 20) / 24) * 2 * Math.PI));
    const interaction = 0.06 * humidity * Math.max(0, temperature - 22);
    const demand = 8 + heating * 0.06 + cooling * 0.06 + 0.5 * occupancy + morningPeak * 0.05 + eveningPeak * 0.055 + interaction * 0.0008 + normal() * 0.12;
    return {
      temperature,
      humidity,
      occupancy,
      hour_sin,
      hour_cos,
      energy_demand: round(demand),
    };
  });
  return datasetShape(
    'Energy Demand',
    'regression',
    rows,
    ['temperature', 'humidity', 'occupancy', 'hour_sin', 'hour_cos'],
    'energy_demand',
    0.8,
  );
}

function diabetes() {
  const random = createSeededRandom(2033);
  const normal = randomNormal(random);
  const rows = Array.from({ length: 400 }, (_, index) => {
    const age = Math.round(20 + random() * 55);
    const bmi = round(18 + random() * 22);
    const glucose = round(70 + random() * 150 + (bmi > 30 ? 12 : 0) + normal() * 8);
    const blood_pressure = round(60 + 0.35 * age + random() * 20);
    const insulin = round(5 + random() * 145);
    const activity_level = round(Math.max(0, random() * 10 - (bmi > 32 ? 1.5 : 0)));
    const family_history = random() < 0.28 ? 1 : 0;
    const score = (
      0.035 * (glucose - 150)
      + (bmi > 30 && activity_level < 4 ? 1.2 : 0)
      + (age > 55 && blood_pressure > 90 ? 1.0 : 0)
      + (family_history === 1 && glucose > 130 ? 0.8 : 0)
      - 0.4
    );
    const label = random() < sigmoid(score) ? 'diabetic' : 'healthy';
    return {
      age,
      bmi,
      glucose,
      blood_pressure,
      insulin,
      activity_level,
      family_history,
      label,
    };
  });
  return datasetShape(
    'Diabetes Risk',
    'classification',
    rows,
    ['age', 'bmi', 'glucose', 'blood_pressure', 'insulin', 'activity_level', 'family_history'],
    'label',
    0.8,
  );
}

export const teachingDatasets = [
  { id: 'linear-trend', role: 'concept', seed: 2026, dataset: linearTrend(), pedagogy: { concept: 'linear-regression', visualFeatureColumns: ['x'], irrelevantFeatureColumns: [] }, labelSampling: 'rule', featuresGeneratedBeforeLabels: true },
  { id: 'house-price', role: 'applied', seed: 2027, dataset: housePrice(), pedagogy: { concept: 'multiple-linear-regression', visualFeatureColumns: ['area_sqm'], irrelevantFeatureColumns: [] }, labelSampling: 'rule', featuresGeneratedBeforeLabels: true },
  { id: 'knn-neighborhood', role: 'concept', seed: 2028, dataset: knnNeighborhood(), pedagogy: { concept: 'nonlinear-decision-boundary', visualFeatureColumns: ['x1', 'x2'], irrelevantFeatureColumns: [] }, labelSampling: 'rule', featuresGeneratedBeforeLabels: true },
  { id: 'iris', role: 'applied', seed: 2029, dataset: iris(), pedagogy: { concept: 'overlapping-classes', visualFeatureColumns: ['petal_length', 'petal_width'], irrelevantFeatureColumns: [] }, labelSampling: 'rule', featuresGeneratedBeforeLabels: true },
  { id: 'xor-mlp-concept', role: 'concept', seed: XOR_CONCEPT_DATASET_SPEC.seed, dataset: xorMlpConcept(), pedagogy: { concept: 'nonlinear-decision-boundary', visualFeatureColumns: ['x1', 'x2'], irrelevantFeatureColumns: [], geometry: 'four-clear-quadrants', labels: 'deterministic-rule' }, labelSampling: 'rule', featuresGeneratedBeforeLabels: true },
  { id: 'xor-mlp-robustness', role: 'robustness', seed: 2030, dataset: xorMlpRobustness(), pedagogy: { concept: 'label-noise-robustness', visualFeatureColumns: ['x1', 'x2'], irrelevantFeatureColumns: [] }, labelSampling: 'probability', featuresGeneratedBeforeLabels: true },
  { id: 'spam', role: 'applied', seed: 2031, dataset: spam(), pedagogy: { concept: 'feature-interactions', visualFeatureColumns: ['link_count', 'sender_reputation'], irrelevantFeatureColumns: ['send_hour', 'subject_length'] }, labelSampling: 'probability', featuresGeneratedBeforeLabels: true },
  { id: 'energy', role: 'applied', seed: 2032, dataset: energyDemand(), pedagogy: { concept: 'nonlinear-regression', visualFeatureColumns: ['temperature', 'occupancy'], irrelevantFeatureColumns: [] }, labelSampling: 'rule', featuresGeneratedBeforeLabels: true },
  { id: 'diabetes', role: 'applied', seed: 2033, dataset: diabetes(), pedagogy: { concept: 'feature-interactions', visualFeatureColumns: ['glucose', 'bmi'], irrelevantFeatureColumns: [] }, labelSampling: 'probability', featuresGeneratedBeforeLabels: true },
];

export function teachingDatasetById(id) {
  return teachingDatasets.find((item) => item.id === id) ?? null;
}
