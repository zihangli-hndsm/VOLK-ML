export default function AttentionMatrixRenderer({ props = {}, plot = { left: 0, top: 0, right: 640, bottom: 360 } }) {
  const rows = Math.max(1, props.rows ?? 1);
  const columns = Math.max(1, props.columns ?? 1);
  const cells = props.cells ?? [];
  const cellWidth = (plot.right - plot.left) / columns;
  const cellHeight = (plot.bottom - plot.top) / rows;
  const byPosition = new Map(cells.map((cell) => [`${cell.row}:${cell.column}`, cell.value]));
  return <g data-primitive="attention-matrix">
    {Array.from({ length: rows * columns }, (_, index) => {
      const row = Math.floor(index / columns);
      const column = index % columns;
      const value = Math.max(0, Math.min(1, Number(byPosition.get(`${row}:${column}`) ?? 0)));
      return <rect key={`${row}-${column}`} x={plot.left + column * cellWidth} y={plot.top + row * cellHeight} width={cellWidth + 0.2} height={cellHeight + 0.2} fill={`rgba(37,99,235,${value})`} />;
    })}
  </g>;
}

