import ScatterRenderer from './renderers/ScatterRenderer.jsx';
import LineRenderer from './renderers/LineRenderer.jsx';
import ResidualRenderer from './renderers/ResidualRenderer.jsx';
import DecisionRegionRenderer from './renderers/DecisionRegionRenderer.jsx';
import NeighborRenderer from './renderers/NeighborRenderer.jsx';
import QueryPointRenderer from './renderers/QueryPointRenderer.jsx';
import VoteBarRenderer from './renderers/VoteBarRenderer.jsx';
import LossCurveRenderer from './renderers/LossCurveRenderer.jsx';
import FormulaRenderer from './renderers/FormulaRenderer.jsx';
import AnnotationRenderer from './renderers/AnnotationRenderer.jsx';
import MetricRenderer from './renderers/MetricRenderer.jsx';

// The unified stage resolves primitive types through this registry. Renderers
// draw JSON props only and never import model mathematics.
export const rendererByPrimitiveType = {
  scatter: ScatterRenderer,
  'regression-line': LineRenderer,
  'reference-line': LineRenderer,
  'residual-lines': ResidualRenderer,
  'decision-region': DecisionRegionRenderer,
  'neighbor-links': NeighborRenderer,
  'query-point': QueryPointRenderer,
  'vote-bars': VoteBarRenderer,
  'loss-curve': LossCurveRenderer,
  formula: FormulaRenderer,
  annotation: AnnotationRenderer,
  'metric-card': MetricRenderer,
  legend: null,
};
