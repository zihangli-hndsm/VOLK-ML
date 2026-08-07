export default function DecisionRegionRenderer({ props, xToSvg, yToSvg, colorByLabel }) {
  const { cells, resolution } = props;
  const width = 562 / resolution;
  const height = 300 / resolution;
  return cells.map((cell) => {
    const color = colorByLabel[cell.label];
    if (!color) return null;
    return <rect key={`${cell.x.toFixed(3)}-${cell.y.toFixed(3)}`} x={xToSvg(cell.x) - width / 2} y={yToSvg(cell.y) - height / 2}
      width={width + 0.5} height={height + 0.5} fill={color} opacity="0.22" />;
  });
}
