export default function LineRenderer({ props, xToSvg, yToSvg, variant }) {
  const { line } = props;
  const dashed = variant === 'reference-line';
  return <line x1={xToSvg(line.start.x)} y1={yToSvg(line.start.y)} x2={xToSvg(line.end.x)} y2={yToSvg(line.end.y)}
    stroke={props.highlighted ? '#f59e0b' : dashed ? '#059669' : '#2563eb'}
    strokeWidth={dashed ? 2.5 : props.highlighted ? 8 : 5}
    strokeDasharray={dashed ? '6 5' : undefined} strokeLinecap="round" />;
}
