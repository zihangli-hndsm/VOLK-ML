import React, { useId, useRef } from 'react';

const numberLabel = (value) => {
  if (Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)) return value.toExponential(2);
  return value.toFixed(2);
};

export default function LinearRegressionView({ snapshot, t, onAddPoint, onMovePoint, onRemovePoint }) {
  const { scene, controls } = snapshot;
  const clipId = useId().replace(/:/g, '');
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const { points, line, bestFitLine, ranges } = scene;
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
    const nearest = points
      .map((item, index) => ({ index, distance: Math.hypot(xToSvg(item.x) - svgPoint.x, yToSvg(item.y) - svgPoint.y) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearest && nearest.distance < 14 && onMovePoint) {
      dragRef.current = { id: points[nearest.index].id, moved: false };
    } else if (onAddPoint && points.length < 120) {
      onAddPoint(point.x, point.y);
    }
  };
  const handlePointerMove = (event) => {
    if (!dragRef.current || !onMovePoint) return;
    const point = toFlow(event.clientX, event.clientY);
    dragRef.current.moved = true;
    onMovePoint(dragRef.current.id, point.x, point.y);
  };
  const handlePointerUp = () => { dragRef.current = null; };
  const handleDoubleClick = (event) => {
    if (!onRemovePoint) return;
    const point = toFlow(event.clientX, event.clientY);
    const svgPoint = { x: xToSvg(point.x), y: yToSvg(point.y) };
    const nearest = points
      .map((item, index) => ({ index, distance: Math.hypot(xToSvg(item.x) - svgPoint.x, yToSvg(item.y) - svgPoint.y) }))
      .sort((a, b) => a.distance - b.distance)[0];
    if (nearest && nearest.distance < 14) onRemovePoint(points[nearest.index].id);
  };
  return <svg ref={svgRef} viewBox="0 0 640 360" className="block h-auto w-full touch-none" role="img"
    aria-label={t('playground.chartLabel')}
    onPointerDown={handlePointerDown}
    onPointerMove={handlePointerMove}
    onPointerUp={handlePointerUp}
    onPointerLeave={handlePointerUp}
    onDoubleClick={handleDoubleClick}>
    <defs><clipPath id={clipId}><rect x={plot.left} y={plot.top} width={plot.right - plot.left} height={plot.bottom - plot.top} /></clipPath></defs>
    <rect x={plot.left} y={plot.top} width={plot.right - plot.left} height={plot.bottom - plot.top} fill="#f8fafc" />
    {[0, 0.25, 0.5, 0.75, 1].map((ratio) => <g key={`grid-${ratio}`}>
      <line x1={plot.left} y1={plot.top + ratio * (plot.bottom - plot.top)} x2={plot.right} y2={plot.top + ratio * (plot.bottom - plot.top)} stroke="#e2e8f0" />
      <line x1={plot.left + ratio * (plot.right - plot.left)} y1={plot.top} x2={plot.left + ratio * (plot.right - plot.left)} y2={plot.bottom} stroke="#e2e8f0" />
    </g>)}
    <path d={`M${plot.left} ${plot.top} V${plot.bottom} H${plot.right}`} fill="none" stroke="#475569" strokeWidth="2" />
    <g clipPath={`url(#${clipId})`}>
      {controls.showResiduals && points.map((point) => <line key={`residual-${point.id}`} x1={xToSvg(point.x)} y1={yToSvg(point.y)} x2={xToSvg(point.x)} y2={yToSvg(point.prediction)} stroke="#fca5a5" strokeWidth="1.4" opacity="0.6" />)}
      {controls.showBestFit && <line x1={xToSvg(ranges.xMin)} y1={yToSvg(bestFitLine.weight * ranges.xMin + bestFitLine.bias)} x2={xToSvg(ranges.xMax)} y2={yToSvg(bestFitLine.weight * ranges.xMax + bestFitLine.bias)} stroke="#059669" strokeWidth="2.5" strokeDasharray="6 5" strokeLinecap="round" />}
      <line x1={xToSvg(line.start.x)} y1={yToSvg(line.start.y)} x2={xToSvg(line.end.x)} y2={yToSvg(line.end.y)} stroke="#2563eb" strokeWidth="5" strokeLinecap="round" />
      {points.map((point) => <circle key={`point-${point.id}`} cx={xToSvg(point.x)} cy={yToSvg(point.y)} r="4.5" fill="#7c3aed" stroke="white" strokeWidth="1.5" />)}
    </g>
    {[0, 0.5, 1].map((ratio) => <React.Fragment key={`label-${ratio}`}>
      <text x={plot.left + ratio * (plot.right - plot.left)} y="344" textAnchor="middle" fontSize="12" fill="#64748b">{numberLabel(ranges.xMin + ratio * (ranges.xMax - ranges.xMin))}</text>
      <text x="49" y={plot.bottom - ratio * (plot.bottom - plot.top) + 4} textAnchor="end" fontSize="12" fill="#64748b">{numberLabel(ranges.yMin + ratio * (ranges.yMax - ranges.yMin))}</text>
    </React.Fragment>)}
    <text x="334" y="358" textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155">{snapshot.source.feature}</text>
    <text x="15" y="170" textAnchor="middle" fontSize="12" fontWeight="700" fill="#334155" transform="rotate(-90 15 170)">{snapshot.source.target}</text>
  </svg>;
}
