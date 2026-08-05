export function describeRows(rows) {
  if (!rows.length || typeof rows[0] !== 'object' || Array.isArray(rows[0])) throw new Error('Object rows are required.');
  const names = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return names.map((name) => {
    const present = rows.map((row) => row[name]).filter((value) => value !== '' && value !== null && value !== undefined);
    const numericCount = present.filter((value) => Number.isFinite(Number(value))).length;
    return { name, type: present.length > 0 && numericCount === present.length ? 'number' : 'text', missing: rows.length - present.length };
  });
}

const dataset = (name, task, rows, featureColumns, targetColumn, trainRatio = 0.8) => ({
  name,
  task,
  rows,
  columns: describeRows(rows),
  featureColumns,
  targetColumn,
  trainRatio,
});

function examScores() {
  const rows = Array.from({ length: 100 }, (_, index) => {
    const studyHours = 1 + (index % 20) * 0.45;
    const practiceTests = (index * 7) % 11;
    const score = 35 + studyHours * 4.8 + practiceTests * 1.7 + Math.sin(index * 1.9) * 2;
    return { study_hours: Number(studyHours.toFixed(2)), practice_tests: practiceTests, exam_score: Number(score.toFixed(2)) };
  });
  return dataset('Exam Scores', 'regression', rows, ['study_hours', 'practice_tests'], 'exam_score');
}

function flowerClassification() {
  const labels = ['setosa', 'versicolor', 'virginica'];
  const rows = Array.from({ length: 90 }, (_, index) => {
    const group = index % labels.length;
    const offset = Math.floor(index / labels.length);
    return {
      sepal_length: Number((4.8 + group * 0.9 + Math.sin(offset) * 0.18).toFixed(2)),
      sepal_width: Number((3.5 - group * 0.35 + Math.cos(offset * 1.3) * 0.12).toFixed(2)),
      petal_length: Number((1.4 + group * 2.05 + Math.sin(offset * 0.7) * 0.2).toFixed(2)),
      species: labels[group],
    };
  });
  return dataset('Flower Classification', 'classification', rows, ['sepal_length', 'sepal_width', 'petal_length'], 'species');
}

function iris() {
  const labels = ['setosa', 'versicolor', 'virginica'];
  const rows = Array.from({ length: 90 }, (_, index) => {
    const group = index % labels.length;
    const offset = Math.floor(index / labels.length);
    return {
      sepal_length: Number((4.9 + group * 1.0 + Math.sin(offset * 0.8) * 0.22).toFixed(2)),
      sepal_width: Number((3.4 - group * 0.30 + Math.cos(offset * 1.1) * 0.14).toFixed(2)),
      petal_length: Number((1.4 + group * 2.3 + Math.sin(offset * 0.6) * 0.24).toFixed(2)),
      petal_width: Number((0.2 + group * 0.9 + Math.cos(offset * 0.9) * 0.1).toFixed(2)),
      species: labels[group],
    };
  });
  return dataset('Iris Flowers', 'classification', rows, ['sepal_length', 'sepal_width', 'petal_length', 'petal_width'], 'species');
}

function wineQuality() {
  const rows = Array.from({ length: 72 }, (_, index) => {
    const base = index % 24;
    const copy = Math.floor(index / 24);
    const jitter = copy === 0 ? 0 : Math.sin(index * 1.7) * 0.06;
    const alcohol = 8.4 + base * 0.11 + jitter;
    const sulphates = 0.42 + (base % 5) * 0.06 + jitter * 0.4;
    const acidity = 5.8 + (base % 4) * 0.35 + jitter * 1.2;
    return {
      alcohol: Number(alcohol.toFixed(2)),
      sulphates: Number(sulphates.toFixed(2)),
      acidity: Number(acidity.toFixed(2)),
      quality: Number((1.4 + alcohol * 0.42 + sulphates * 1.7 - acidity * 0.09).toFixed(3)),
    };
  });
  return dataset('Wine Quality', 'regression', rows, ['alcohol', 'sulphates', 'acidity'], 'quality');
}

function energyDemand() {
  const rows = Array.from({ length: 80 }, (_, index) => {
    const temperature = Number((-5 + (index % 16) * 2.5).toFixed(2));
    const humidity = 35 + (index % 12) * 5;
    // Demand follows a U-shape over temperature: heating below the comfort point,
    // cooling above it, plus a mild humidity term and deterministic noise.
    const demand = 60 + Math.abs(temperature - 14) * 6 + humidity * 0.35 + Math.sin(index * 0.8) * 2;
    return {
      temperature,
      humidity,
      energy_demand: Number(demand.toFixed(3)),
    };
  });
  return dataset('Energy Demand', 'regression', rows, ['temperature', 'humidity'], 'energy_demand');
}

function emailSpam() {
  const rows = Array.from({ length: 60 }, (_, index) => {
    const spam = index % 2 === 0;
    const instance = Math.floor(index / 2);
    // Spam tends to be verbose with many links; ham is short with few links.
    const wordCount = spam
      ? 140 + ((instance * 7) % 120)
      : 50 + ((instance * 3) % 70);
    const linkCount = spam
      ? 3 + (instance % 5)
      : instance % 3;
    return {
      word_count: wordCount,
      link_count: linkCount,
      label: spam ? 'spam' : 'ham',
    };
  });
  return dataset('Email Spam', 'classification', rows, ['word_count', 'link_count'], 'label');
}

export const sampleDatasets = [
  { labelKey: 'data.sample.examScores', dataset: examScores() },
  { labelKey: 'data.sample.flowerClassification', dataset: flowerClassification() },
  { labelKey: 'data.sample.iris', dataset: iris() },
  { labelKey: 'data.sample.wineQuality', dataset: wineQuality() },
  { labelKey: 'data.sample.energyDemand', dataset: energyDemand() },
  { labelKey: 'data.sample.emailSpam', dataset: emailSpam() },
];
