import { useMemo } from 'react';
import { rendererByPrimitiveType } from './rendererRegistry.jsx';
import { resolveMotionConfig } from './motion.js';
import { usePrimitiveMotion, useReducedMotionPreference } from './usePrimitiveMotion.js';
import { buildLabelColorMap } from './visualEncoding.js';

const PLOT = { left: 58, right: 620, top: 20, bottom: 320 };
const EMPTY_STAGE_LAYOUT = [];

// The unified stage only knows primitives. It never imports model math and
// never special-cases a model; every drawing decision comes from the JSON
// primitive props in the snapshot.
export default function PlaygroundStage({ snapshot, t }) {
  const { primitives, script, visualState } = snapshot;
  const layout = script?.layout?.stage ?? EMPTY_STAGE_LAYOUT;
  const visible = useMemo(() => primitives.filter((primitive) => (
    layout.includes(primitive.id) && visualState[primitive.id] !== false
  )), [layout, primitives, visualState]);
  const reducedMotion = useReducedMotionPreference();
  const motionConfig = resolveMotionConfig(snapshot, reducedMotion);
  const { primitives: renderedPrimitives, motion } = usePrimitiveMotion(visible, motionConfig);
  const scatter = visible.find((primitive) => primitive.type === 'scatter');
  const points = scatter?.props?.points ?? [];
  const axes = scatter?.props?.axes ?? { x: 'x', y: 'y' };
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const xSpan = Math.max(0.5, xs.length ? Math.max(...xs) - Math.min(...xs) : 1);
  const ySpan = Math.max(0.5, ys.length ? Math.max(...ys) - Math.min(...ys) : 1);
  const ranges = {
    xMin: xs.length ? Math.min(...xs) - xSpan * 0.1 : -1,
    xMax: xs.length ? Math.max(...xs) + xSpan * 0.1 : 1,
    yMin: ys.length ? Math.min(...ys) - ySpan * 0.1 : -1,
    yMax: ys.length ? Math.max(...ys) + ySpan * 0.1 : 1,
  };
  const xToSvg = (x) => PLOT.left + ((x - ranges.xMin) / (ranges.xMax - ranges.xMin)) * (PLOT.right - PLOT.left);
  const yToSvg = (y) => PLOT.bottom - ((y - ranges.yMin) / (ranges.yMax - ranges.yMin)) * (PLOT.bottom - PLOT.top);
  const colorByLabel = buildLabelColorMap(points);
  return <svg viewBox="0 0 640 360" className="block h-auto w-full" role="img" aria-label={t('playground.chartLabel')}>
    <rect x={PLOT.left} y={PLOT.top} width={PLOT.right - PLOT.left} height={PLOT.bottom - PLOT.top} fill="#f8fafc" />
    {[0, 0.25, 0.5, 0.75, 1].map((ratio) => <g key={`grid-${ratio}`}>
      <line x1={PLOT.left} y1={PLOT.top + ratio * (PLOT.bottom - PLOT.top)} x2={PLOT.right} y2={PLOT.top + ratio * (PLOT.bottom - PLOT.top)} stroke="#e2e8f0" />
      <line x1={PLOT.left + ratio * (PLOT.right - PLOT.left)} y1={PLOT.top} x2={PLOT.left + ratio * (PLOT.right - PLOT.left)} y2={PLOT.bottom} stroke="#e2e8f0" />
    </g>)}
    <path d={`M${PLOT.left} ${PLOT.top} V${PLOT.bottom} H${PLOT.right}`} fill="none" stroke="#475569" strokeWidth="2" />
    {renderedPrimitives.map((primitive) => {
      const Renderer = rendererByPrimitiveType[primitive.type];
      if (!Renderer) return null;
      return <Renderer key={primitive.id} props={primitive.props} variant={primitive.type}
        xToSvg={xToSvg} yToSvg={yToSvg} colorByLabel={colorByLabel} plot={PLOT} motion={motion} t={t} />;
    })}
    <text x="334" y="358" textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155">{axes.x}</text>
    <text x="15" y="170" textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155" transform="rotate(-90 15 170)">{axes.y}</text>
  </svg>;
}
