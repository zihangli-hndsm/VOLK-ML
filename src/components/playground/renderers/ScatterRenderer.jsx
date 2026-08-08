export default function ScatterRenderer({ props, xToSvg, yToSvg, colorByLabel }) {
  const { points } = props;
  return points.map((point) => (point.subset === 'test'
    ? <circle key={`point-${point.id}`} cx={xToSvg(point.x)} cy={yToSvg(point.y)} r="5" fill="white" stroke={colorByLabel[point.label] ?? '#64748b'} strokeWidth="2" />
    : <circle key={`point-${point.id}`} cx={xToSvg(point.x)} cy={yToSvg(point.y)} r={props.highlighted ? 8 : 5} fill={colorByLabel[point.label] ?? '#64748b'} stroke={props.highlighted ? '#f59e0b' : 'white'} strokeWidth={props.highlighted ? 3 : 1.5} />));
}
