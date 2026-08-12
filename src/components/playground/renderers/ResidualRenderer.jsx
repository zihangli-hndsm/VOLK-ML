export default function ResidualRenderer({ props, xToSvg, yToSvg }) {
  const { points = [] } = props ?? {};
  return points.map((point) => (
    <line key={`residual-${point.id ?? point.x}`} x1={xToSvg(point.x)} y1={yToSvg(point.y)} x2={xToSvg(point.x)} y2={yToSvg(point.prediction)} stroke={point.subset === 'test' ? '#7c3aed' : '#fca5a5'} strokeWidth={point.subset === 'test' ? 2 : 1.4} strokeDasharray={point.subset === 'test' ? '4 3' : undefined} opacity={0.6 * (props.motionOpacity ?? 1) * (point.motionOpacity ?? 1)} />
  ));
}
