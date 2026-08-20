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
import ParameterTrajectoryRenderer from './renderers/ParameterTrajectoryRenderer.jsx';
import NetworkGraphRenderer from './renderers/NetworkGraphRenderer.jsx';
import MatrixGridRenderer from './renderers/MatrixGridRenderer.jsx';
import HistogramRenderer from './renderers/HistogramRenderer.jsx';
import ImageGridRenderer from './renderers/ImageGridRenderer.jsx';
import TokenSequenceRenderer from './renderers/TokenSequenceRenderer.jsx';
import AttentionMatrixRenderer from './renderers/AttentionMatrixRenderer.jsx';
import RankedResultsRenderer from './renderers/RankedResultsRenderer.jsx';

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
  'parameter-trajectory': ParameterTrajectoryRenderer,
  'network-graph': NetworkGraphRenderer,
  'matrix-grid': MatrixGridRenderer,
  histogram: HistogramRenderer,
  'image-grid': ImageGridRenderer,
  'token-sequence': TokenSequenceRenderer,
  'attention-matrix': AttentionMatrixRenderer,
  'ranked-results': RankedResultsRenderer,
};
