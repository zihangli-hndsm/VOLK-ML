import React, { useRef, useState } from 'react';

const LABEL_COLORS = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2'];

export default function KnnView({ snapshot, t, onAddPoint, onMovePoint }) {
  const { scene } = snapshot;
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const [showFixedFeatures, setShowFixedFeatures] = useState(false);
  const labels = [...new Set(scene.points.map((point) => point.label))].sort();
  const colorByLabel = Object.fromEntries(labels.map((label, index) => [label, LABEL_COLORS[index % LABEL_COLORS.length]]));
  const useNormalized = scene.normalize;
  const displayPoint = (point) => ({ x: useNormalized ? point.normalizedX : point.x, y: useNormalized ? point.normalizedY : point.y });
  const query = useNormalized ? { x: scene.query.normalizedX, y: scene.query.normalizedY } : { x: scene.query.x, y: scene.query.y };
  const toRaw = (display) => useNormalized
    ? {
      x: display.x * scene.normalization.xStd + scene.normalization.xMean,
      y: display.y * scene.normalization.yStd + scene.normalization.yMean,
    }
    : display;
  const displayPoints = scene.points.map((point) => ({ ...point, ...displayPoint(point) }));
  const xs = displayPoints.map((point) => point.x);
  const ys = displayPoints.map((point) => point.y);
  const xSpan = Math.max(0.5, Math.max(...xs) - Math.min(...xs));
  const ySpan = Math.max(0.5, Math.max(...ys) - Math.min(...ys));
  const ranges = {
    xMin: Math.min(...xs) - xSpan * 0.1,
    xMax: Math.max(...xs) + xSpan * 0.1,
    yMin: Math.min(...ys) - ySpan * 0.1,
    yMax: Math.max(...ys) + ySpan * 0.1,
  };
  const plot = { left: 58, right: 620, top: 20, bottom: 320 };
  const xToSvg = (x) => plot.left + ((x - ranges.xMin) / (ranges.xMax - ranges.xMin)) * (plot.right - plot.left);
  const yToSvg = (y) => plot.bottom - ((y - ranges.yMin) / (ranges.yMax - ranges.yMin)) * (plot.bottom - plot.top);
  const toFlow = (clientX, clientY) => {
    const rect = svgRef.current.getBoundingClientRect();
    const scaleX = 640 / rect.width;
    const scaleY = 360 / rect.height;
    const svgX = (clientX - rect.left) * scaleX;
    const svgY = (clientY - rect.top) * scaleY;
    return {
      x: ranges.xMin + ((svgX - plot.left) / (plot.right - plot.left)) * (ranges.xMax - ranges.xMin),
      y: ranges.yMax - ((svgY - plot.top) / (plot.bottom - plot.top)) * (ranges.yMax - ranges.yMin),
    };
  };
  const handlePointerDown = (event) => {
    if (!onAddPoint && !onMovePoint) return;
    const point = toFlow(event.clientX, event.clientY);
    const svgPoint = { x: xToSvg(point.x), y: yToSvg(point.y) };
    const nearest = displayPoints
      .map((item, index) => ({ index, distance: Math.hypot(xToSvg(item.x) - svgPoint.x, yToSvg(item.y) - svgPoint.y) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearest && nearest.distance < 14 && displayPoints[nearest.index].subset === 'train' && onMovePoint) {
      dragRef.current = { id: displayPoints[nearest.index].id, moved: false };
    } else if (onAddPoint && displayPoints.length < 200) {
      const label = nearest ? displayPoints[nearest.index].label : labels[0];
      const raw = toRaw(point);
      onAddPoint(raw.x, raw.y, label);
    }
  };
  const handlePointerMove = (event) => {
    if (!dragRef.current || !onMovePoint) return;
    const point = toFlow(event.clientX, event.clientY);
    dragRef.current.moved = true;
    const raw = toRaw(point);
    onMovePoint(dragRef.current.id, raw.x, raw.y);
  };
  const handlePointerUp = () => { dragRef.current = null; };
  const selectedNeighbors = scene.neighbors.filter((neighbor) => neighbor.selected);
  return <div>
    {scene.projection.enabled && <div className="border-b border-slate-200 bg-sky-50 p-3 text-xs font-bold text-sky-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{t('playground.knn.projectionSlice')} — {t('playground.knn.fixedAtMean')}</span>
        <button type="button" onClick={() => setShowFixedFeatures((value) => !value)} className="rounded-lg bg-white px-2 py-1 text-[11px] text-sky-700">
          {showFixedFeatures ? t('common.close') : t('playground.knn.fixedFeatures')}
        </button>
      </div>
      {showFixedFeatures && <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono">
        {Object.entries(scene.projection.fixedFeatures).map(([feature, value]) => (
          <div key={feature} className="flex justify-between gap-2"><dt className="text-sky-600">{feature}</dt><dd className="font-bold text-slate-900">{Number(value).toFixed(3)}</dd></div>
        ))}
      </dl>}
    </div>}
    {!useNormalized && <div className="border-b border-slate-200 bg-amber-50 p-2 text-center text-[11px] font-bold text-amber-700">{t('playground.knn.rawComparison')}</div>}
    <svg ref={svgRef} viewBox="0 0 640 360" className="block h-auto w-full touch-none" role="img"
      aria-label={t('playground.knn.chartLabel')}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}>
      <rect x={plot.left} y={plot.top} width={plot.right - plot.left} height={plot.bottom - plot.top} fill="#f8fafc" />
      {scene.decisionRegions.enabled && scene.decisionRegions.cells.map((cell) => {
        const color = colorByLabel[cell.label];
        if (!color) return null;
        const width = (plot.right - plot.left) / scene.decisionRegions.resolution;
        const height = (plot.bottom - plot.top) / scene.decisionRegions.resolution;
        return <rect key={`${cell.x.toFixed(3)}-${cell.y.toFixed(3)}`} x={xToSvg(cell.x) - width / 2} y={yToSvg(cell.y) - height / 2}
          width={width + 0.5} height={height + 0.5} fill={color} opacity="0.22" />;
      })}
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => <g key={`grid-${ratio}`}>
        <line x1={plot.left} y1={plot.top + ratio * (plot.bottom - plot.top)} x2={plot.right} y2={plot.top + ratio * (plot.bottom - plot.top)} stroke="#e2e8f0" />
        <line x1={plot.left + ratio * (plot.right - plot.left)} y1={plot.top} x2={plot.left + ratio * (plot.right - plot.left)} y2={plot.bottom} stroke="#e2e8f0" />
      </g>)}
      <path d={`M${plot.left} ${plot.top} V${plot.bottom} H${plot.right}`} fill="none" stroke="#475569" strokeWidth="2" />
      {snapshot.controls.showNeighborOrder && selectedNeighbors.map((neighbor) => {
        const point = displayPoints.find((item) => item.id === neighbor.pointId);
        if (!point) return null;
        return <React.Fragment key={`neighbor-${neighbor.pointId}`}>
          <circle cx={xToSvg(query.x)} cy={yToSvg(query.y)} r={Math.hypot(xToSvg(point.x) - xToSvg(query.x), yToSvg(point.y) - yToSvg(query.y))} fill="none" stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" />
          <line x1={xToSvg(query.x)} y1={yToSvg(query.y)} x2={xToSvg(point.x)} y2={yToSvg(point.y)} stroke={colorByLabel[neighbor.label]} strokeWidth="2" opacity="0.85" />
        </React.Fragment>;
      })}
      {displayPoints.map((point) => (point.subset === 'test'
        ? <circle key={`point-${point.id}`} cx={xToSvg(point.x)} cy={yToSvg(point.y)} r="5" fill="white" stroke={colorByLabel[point.label] ?? '#64748b'} strokeWidth="2" />
        : <circle key={`point-${point.id}`} cx={xToSvg(point.x)} cy={yToSvg(point.y)} r="5" fill={colorByLabel[point.label] ?? '#64748b'} stroke="white" strokeWidth="1.5" />))}
      {snapshot.controls.showNeighborOrder && selectedNeighbors.map((neighbor) => {
        const point = displayPoints.find((item) => item.id === neighbor.pointId);
        if (!point) return null;
        return <text key={`rank-${neighbor.pointId}`} x={xToSvg(point.x)} y={yToSvg(point.y) - 8} textAnchor="middle" fontSize="11" fontWeight="700" fill="#334155">{neighbor.rank}</text>;
      })}
      <circle cx={xToSvg(query.x)} cy={yToSvg(query.y)} r="7" fill="#0f172a" stroke="white" strokeWidth="2" />
      <text x="334" y="358" textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155">{snapshot.controls.xFeature}</text>
      <text x="15" y="170" textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155" transform="rotate(-90 15 170)">{snapshot.controls.yFeature}</text>
    </svg>
  </div>;
}
