// Tiny gray picture for the (i) popups, drawn as SVG squares from a 0..1 array (no image file).

export interface HelpImageProps {
  data: Float32Array;
  w: number;
  h: number;
  /** Accessible name, e.g. "Before: a star and one hot pixel". */
  label: string;
  caption?: string;
  px?: number;
}

export default function HelpImage({ data, w, h, label, caption, px = 10 }: HelpImageProps) {
  const rects = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round(255 * Math.min(1, Math.max(0, data[y * w + x])));
      rects.push(<rect key={y * w + x} x={x} y={y} width={1} height={1} fill={`rgb(${v} ${v} ${v})`} />);
    }
  }
  return (
    <figure style={{ margin: 0, textAlign: "center" }}>
      <svg role="img" aria-label={label} width={w * px} height={h * px} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" style={{ border: "1px solid #666" }}>
        {rects}
      </svg>
      {caption && <figcaption style={{ fontSize: 11 }}>{caption}</figcaption>}
    </figure>
  );
}
