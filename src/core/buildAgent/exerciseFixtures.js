export const exerciseIrisRows = [
  [5.1, 3.5, 1.4, 0.2, 'setosa'], [4.9, 3.0, 1.4, 0.2, 'setosa'],
  [4.7, 3.2, 1.3, 0.2, 'setosa'], [4.6, 3.1, 1.5, 0.2, 'setosa'],
  [5.0, 3.6, 1.4, 0.2, 'setosa'], [5.4, 3.9, 1.7, 0.4, 'setosa'],
  [7.0, 3.2, 4.7, 1.4, 'versicolor'], [6.4, 3.2, 4.5, 1.5, 'versicolor'],
  [6.9, 3.1, 4.9, 1.5, 'versicolor'], [5.5, 2.3, 4.0, 1.3, 'versicolor'],
  [6.5, 2.8, 4.6, 1.5, 'versicolor'], [5.7, 2.8, 4.5, 1.3, 'versicolor'],
  [6.3, 3.3, 6.0, 2.5, 'virginica'], [5.8, 2.7, 5.1, 1.9, 'virginica'],
  [7.1, 3.0, 5.9, 2.1, 'virginica'], [6.3, 2.9, 5.6, 1.8, 'virginica'],
  [6.5, 3.0, 5.8, 2.2, 'virginica'], [7.6, 3.0, 6.6, 2.1, 'virginica'],
].map(([sepal_length, sepal_width, petal_length, petal_width, species]) => ({
  sepal_length, sepal_width, petal_length, petal_width, species,
}));

export const exerciseWineRows = Array.from({ length: 24 }, (_, index) => {
  const alcohol = 8.4 + index * 0.11;
  const sulphates = 0.42 + (index % 5) * 0.06;
  const acidity = 5.8 + (index % 4) * 0.35;
  return {
    alcohol: Number(alcohol.toFixed(2)),
    sulphates: Number(sulphates.toFixed(2)),
    acidity: Number(acidity.toFixed(2)),
    quality: Number((1.4 + alcohol * 0.42 + sulphates * 1.7 - acidity * 0.09).toFixed(3)),
  };
});

export const exerciseMlpRows = Array.from({ length: 60 }, (_, index) => {
  const positive = index % 2 === 0;
  const offset = Math.floor(index / 2) * 0.015;
  return { feature_a: (positive ? 3 : -3) + offset, feature_b: (positive ? 2 : -2) - offset, label: positive ? 'positive' : 'negative' };
});

export const exerciseMlpRegressionRows = Array.from({ length: 80 }, (_, index) => {
  const feature_a = (index % 10) - 5;
  const feature_b = Math.floor(index / 10) - 4;
  return { feature_a, feature_b, target: 1.5 * feature_a - 2 * feature_b + 0.5 };
});

export const exerciseDatasets = Object.freeze({
  iris: {
    name: 'UCI Iris exercise subset', task: 'classification', rows: exerciseIrisRows,
    featureColumns: ['sepal_length', 'sepal_width', 'petal_length', 'petal_width'], targetColumn: 'species',
  },
  wine: {
    name: 'Wine quality regression exercise subset', task: 'regression', rows: exerciseWineRows,
    featureColumns: ['alcohol', 'sulphates', 'acidity'], targetColumn: 'quality',
  },
  mlpClassification: {
    name: 'Small MLP classification exercise', task: 'classification', rows: exerciseMlpRows,
    featureColumns: ['feature_a', 'feature_b'], targetColumn: 'label',
  },
  mlpRegression: {
    name: 'Small MLP regression exercise', task: 'regression', rows: exerciseMlpRegressionRows,
    featureColumns: ['feature_a', 'feature_b'], targetColumn: 'target',
  },
});
