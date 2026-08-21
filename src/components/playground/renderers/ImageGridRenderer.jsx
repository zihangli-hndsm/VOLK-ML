export default function ImageGridRenderer({ props = {}, plot = { left: 0, top: 0, right: 640, bottom: 360 } }) {
  const images = props.images ?? [];
  const columns = Math.max(1, Math.min(8, props.columns ?? Math.ceil(Math.sqrt(Math.max(1, images.length)))));
  const cellWidth = (plot.right - plot.left) / columns;
  const rows = Math.ceil(images.length / columns);
  const cellHeight = (plot.bottom - plot.top) / Math.max(1, rows);
  return <g data-primitive="image-grid">
    {images.map((image, index) => {
      const width = Math.max(1, image.width);
      const height = Math.max(1, image.height);
      const x0 = plot.left + (index % columns) * cellWidth;
      const y0 = plot.top + Math.floor(index / columns) * cellHeight;
      const pixelWidth = cellWidth / width;
      const pixelHeight = cellHeight / height;
      return <g key={String(image.id ?? index)}>
        {(image.pixels ?? []).map((value, pixelIndex) => {
          const x = x0 + (pixelIndex % width) * pixelWidth;
          const y = y0 + Math.floor(pixelIndex / width) * pixelHeight;
          const shade = Math.round(Math.max(0, Math.min(1, Number(value))) * 255);
          return <rect key={`${image.id ?? index}-${pixelIndex}`} x={x} y={y} width={pixelWidth + 0.2} height={pixelHeight + 0.2} fill={`rgb(${shade},${shade},${shade})`} />;
        })}
      </g>;
    })}
  </g>;
}

