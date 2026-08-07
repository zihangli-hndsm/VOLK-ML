export default function ResidualRenderer({ props, xToSvg, yToSvg }) {
  const { points } = props;
  return points.map((point) => (
    <line key={`residual-${point.id ?? point.x}`} x1={xToSvg(point.x)} y1={yToSvg(point.y)} x2={xToSvg(point.x)} y2={yToSvg(point.prediction)} stroke="#fca5a5" strokeWidth="1.4" opacity="0.6" />
  ));
}
