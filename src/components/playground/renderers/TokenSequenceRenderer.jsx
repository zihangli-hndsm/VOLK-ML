export default function TokenSequenceRenderer({ props = {}, plot = { left: 0, top: 0, right: 640, bottom: 360 } }) {
  const tokens = props.tokens ?? [];
  const highlighted = new Set(props.highlights ?? []);
  const width = (plot.right - plot.left) / Math.max(1, tokens.length);
  return <g data-primitive="token-sequence">
    {tokens.map((token, index) => <g key={`${String(token)}-${index}`}>
      <rect x={plot.left + index * width + 2} y={plot.top + 120} width={Math.max(1, width - 4)} height="64" rx="6" fill={highlighted.has(index) ? '#dbeafe' : '#f8fafc'} stroke={highlighted.has(index) ? '#2563eb' : '#cbd5e1'} />
      <text x={plot.left + index * width + width / 2} y={plot.top + 156} textAnchor="middle" fontSize="12" fill="#334155">{String(token)}</text>
    </g>)}
  </g>;
}

