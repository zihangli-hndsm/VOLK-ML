// Model-independent layered network graph: nodes carry {id, layer, label?,
// value?} and edges carry {source, target, weight?}. Layers are laid out
// left-to-right; edge thickness follows |weight| and node fill follows the
// sign of the activation (blue positive, amber negative, gray hidden).
export default function NetworkGraphRenderer({ props, t }) {
  const nodes = props?.nodes ?? [];
  const edges = props?.edges ?? [];
  if (!nodes.length) return null;
  const left = 30;
  const right = 320;
  const top = 30;
  const bottom = 300;
  const layers = [...new Set(nodes.map((node) => node.layer))].sort((a, b) => a - b);
  const positions = new Map();
  for (const layer of layers) {
    const members = nodes.filter((node) => node.layer === layer);
    const x = left + (layers.indexOf(layer) / Math.max(1, layers.length - 1)) * (right - left);
    members.forEach((node, index) => {
      const y = top + ((index + 0.5) / members.length) * (bottom - top);
      positions.set(String(node.id), { x, y });
    });
  }
  const nodeById = new Map(nodes.map((node) => [String(node.id), node]));
  const colorOf = (value) => {
    if (value === null || value === undefined) return '#94a3b8';
    return value >= 0 ? '#2563eb' : '#f59e0b';
  };
  return <g>
    <rect x={left - 10} y={top - 14} width={right - left + 20} height={bottom - top + 28} fill="#f8fafc" stroke="#cbd5e1" rx="8" />
    <text x={left} y={top - 2} fontSize="10" fontWeight="800" fill="#475569">{t('playground.networkGraphTitle')}</text>
    {edges.map((edge, index) => {
      const source = positions.get(String(edge.source));
      const target = positions.get(String(edge.target));
      if (!source || !target) return null;
      const weight = typeof edge.weight === 'number' ? edge.weight : 0;
      return <line key={`edge-${edge.source}-${edge.target}-${index}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y}
        stroke={weight >= 0 ? '#60a5fa' : '#fbbf24'} strokeWidth={Math.max(0.5, Math.min(4, Math.abs(weight) * 6))}
        opacity={0.75 * (props.motionOpacity ?? 1) * (edge.motionOpacity ?? 1)} />;
    })}
    {nodes.map((node) => {
      const position = positions.get(String(node.id));
      if (!position) return null;
      const value = nodeById.get(String(node.id))?.value;
      return <g key={String(node.id)}>
        <circle cx={position.x} cy={position.y} r="11" fill={colorOf(value)} stroke="white" strokeWidth="2" opacity={(value === null ? 0.45 : 1) * (props.motionOpacity ?? 1) * (node.motionOpacity ?? 1)} />
        <text x={position.x} y={position.y + 3} textAnchor="middle" fontSize="8" fontWeight="800" fill="white" opacity={(props.motionOpacity ?? 1) * (node.motionOpacity ?? 1)}>{node.label ?? ''}</text>
        {value !== null && value !== undefined
          ? <text x={position.x} y={position.y - 15} textAnchor="middle" fontSize="8" fill="#475569" opacity={(props.motionOpacity ?? 1) * (node.motionOpacity ?? 1)}>{Number(value).toFixed(2)}</text>
          : null}
      </g>;
    })}
  </g>;
}
