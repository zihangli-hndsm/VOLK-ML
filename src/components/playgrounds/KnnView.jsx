import React, { useRef } from 'react';

const LABEL_COLORS = ['#2563eb', '#7c3aed', '#059669', '#d97706', '#dc2626', '#0891b2'];

export default function KnnView({ snapshot, t, onAddPoint, onMovePoint }) {
  const { scene } = snapshot;
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const labels = [...new Set(scene.points.map((point) => point.label))].sort();
  const colorByLabel = Object.fromEntries(labels.map((label, index) => [label, LABEL_COLORS[index % LABEL_COLORS.length]]));
  const displayPoints = scene.points;
  const query = { x: scene.query.x, y: scene.query.y };
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
    if (nearest && nearest.distance < 14 && onMovePoint) {
      dragRef.current = { id: displayPoints[nearest.index].id, moved: false };
    } else if (onAddPoint && displayPoints.length < 200) {
      const label = nearest ? displayPoints[nearest.index].label : labels[0];
      onAddPoint(point.x, point.y, label);
    }
  };
  const handlePointerMove = (event) => {
    if (!dragRef.current || !onMovePoint) return;
    const point = toFlow(event.clientX, event.clientY);
    dragRef.current.moved = true;
    onMovePoint(dragRef.current.id, point.x, point.y);
  };
  const handlePointerUp = () => { dragRef.current = null; };
  const selectedNeighbors = scene.neighbors.filter((neighbor) => neighbor.selected);
  return <>
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
    {displayPoints.map((point) => <circle key={`point-${point.id}`} cx={xToSvg(point.x)} cy={yToSvg(point.y)} r="5" fill={colorByLabel[point.label] ?? '#64748b'} stroke="white" strokeWidth="1.5" />)}
    {snapshot.controls.showNeighborOrder && selectedNeighbors.map((neighbor) => {
      const point = displayPoints.find((item) => item.id === neighbor.pointId);
      if (!point) return null;
      return <text key={`rank-${neighbor.pointId}`} x={xToSvg(point.x)} y={yToSvg(point.y) - 8} textAnchor="middle" fontSize="11" fontWeight="700" fill="#334155">{neighbor.rank}</text>;
    })}
    <circle cx={xToSvg(query.x)} cy={yToSvg(query.y)} r="7" fill="#0f172a" stroke="white" strokeWidth="2" />
    <text x="334" y="358" textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155">{snapshot.controls.xFeature}</text>
    <text x="15" y="170" textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155" transform="rotate(-90 15 170)">{snapshot.controls.yFeature}</text>
  </svg>
  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
    <p className="text-xs font-black uppercase tracking-wider text-slate-500">{t('playground.knn.votes')}</p>
    <div className="mt-2 space-y-1">
      {Object.entries(scene.voting.counts).map(([label, count]) => {
        const total = Object.values(scene.voting.counts).reduce((sum, value) => sum + value, 0) || 1;
        const predicted = scene.voting.predictedLabel === label;
        return <div key={label} className="flex items-center gap-2 text-sm">
          <span className="w-16 truncate font-bold" style={{ color: colorByLabel[label] }}>{label}</span>
          <div className="h-4 flex-1 overflow-hidden rounded-full bg-white">
            <div className="h-full rounded-full" style={{ width: `${(count / total) * 100}%`, background: colorByLabel[label] ?? '#94a3b8' }} />
          </div>
          <span className="w-6 text-right font-mono font-bold text-slate-700">{count}</span>
          {predicted && <span className="text-xs font-black text-slate-900">←</span>}
        </div>;
      })}
      {scene.voting.tie && <p className="mt-1 text-xs font-bold text-amber-700">{t('playground.knn.voteTie')}</p>}
    </div>
  </div>
  </>;
}
