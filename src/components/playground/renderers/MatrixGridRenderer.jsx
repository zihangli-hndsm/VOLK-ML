// Model-independent weight matrix grid: cells carry {row, column, value,
// label?}. Cell fill follows the sign of the value (blue positive, amber
// negative); labels render when the cell is large enough.
export default function MatrixGridRenderer({ props, t }) {
  const rows = props?.rows ?? 0;
  const columns = props?.columns ?? 0;
  const cells = props?.cells ?? [];
  if (!rows || !columns || !cells.length) return null;
  const left = 350;
  const top = 150;
  const cell = Math.min(26, Math.floor(180 / columns));
  const cellHeight = Math.min(26, Math.floor(130 / rows));
  const width = columns * cell;
  const height = rows * cellHeight;
  const byPosition = new Map(cells.map((item) => [`${item.row}:${item.column}`, item]));
  return <g>
    <rect x={left - 8} y={top - 14} width={width + 16} height={height + 22} fill="#f8fafc" stroke="#cbd5e1" rx="8" />
    <text x={left} y={top - 2} fontSize="10" fontWeight="800" fill="#475569">{t('playground.matrixGridTitle')}</text>
    {Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => {
      const item = byPosition.get(`${row}:${column}`);
      const value = item?.value ?? 0;
      const fill = value >= 0 ? 'rgba(37, 99, 235, 0.75)' : 'rgba(245, 158, 11, 0.75)';
      return <g key={`cell-${row}-${column}`}>
        <rect x={left + column * cell} y={top + row * cellHeight} width={cell - 2} height={cellHeight - 2}
          rx="3" fill={fill} opacity={Math.min(1, 0.35 + Math.abs(value) * 2)} />
        {cell >= 18 ? <text x={left + column * cell + (cell - 2) / 2} y={top + row * cellHeight + (cellHeight - 2) / 2 + 3}
          textAnchor="middle" fontSize="8" fontWeight="700" fill="white">{item?.label ?? Number(value).toFixed(1)}</text> : null}
      </g>;
    }))}
  </g>;
}
