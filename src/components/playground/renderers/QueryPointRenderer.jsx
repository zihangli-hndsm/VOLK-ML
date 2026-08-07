export default function QueryPointRenderer({ props, xToSvg, yToSvg }) {
  const { query } = props;
  return <circle cx={xToSvg(query.x)} cy={yToSvg(query.y)} r="7" fill="#0f172a" stroke="white" strokeWidth="2" />;
}
