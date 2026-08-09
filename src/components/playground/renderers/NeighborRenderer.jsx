import React from 'react';

export default function NeighborRenderer({ props, xToSvg, yToSvg, colorByLabel }) {
  const { neighbors = [], points = [], query, showOrder } = props ?? {};
  if (!showOrder) return null;
  if (!query || !Array.isArray(neighbors) || !Array.isArray(points)) return null;
  const selected = neighbors.filter((neighbor) => neighbor.selected);
  return <>
    {selected.map((neighbor) => {
      const point = points.find((item) => item.id === neighbor.pointId);
      if (!point) return null;
      return <React.Fragment key={`neighbor-${neighbor.pointId}`}>
        <circle cx={xToSvg(query.x)} cy={yToSvg(query.y)} r={Math.hypot(xToSvg(point.x) - xToSvg(query.x), yToSvg(point.y) - yToSvg(query.y))} fill="none" stroke="#94a3b8" strokeWidth="1.2" strokeDasharray="4 3" opacity={0.7 * (props.motionOpacity ?? 1) * (neighbor.motionOpacity ?? 1)} />
        <line x1={xToSvg(query.x)} y1={yToSvg(query.y)} x2={xToSvg(point.x)} y2={yToSvg(point.y)} stroke={props.highlighted ? '#f59e0b' : colorByLabel?.[neighbor.label] ?? '#94a3b8'} strokeWidth={props.highlighted ? 4 : 2} opacity={0.85 * (props.motionOpacity ?? 1) * (neighbor.motionOpacity ?? 1)} />
      </React.Fragment>;
    })}
    {selected.map((neighbor) => {
      const point = points.find((item) => item.id === neighbor.pointId);
      if (!point) return null;
      return <text key={`rank-${neighbor.pointId}`} x={xToSvg(point.x)} y={yToSvg(point.y) - 8} textAnchor="middle" fontSize="11" fontWeight="700" fill="#334155" opacity={(props.motionOpacity ?? 1) * (neighbor.motionOpacity ?? 1)}>{neighbor.rank}</text>;
    })}
  </>;
}
