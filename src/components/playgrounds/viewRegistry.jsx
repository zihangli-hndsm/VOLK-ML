import LinearRegressionView from './LinearRegressionView.jsx';
import KnnView from './KnnView.jsx';

export const playgroundViews = {
  'linear-regression': LinearRegressionView,
  'knn-classification': KnnView,
};

export function PlaygroundStageView({ playgroundId, snapshot, t }) {
  const View = playgroundViews[playgroundId];
  return View ? <View snapshot={snapshot} t={t} /> : null;
}
