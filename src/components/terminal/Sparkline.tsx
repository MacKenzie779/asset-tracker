/** Hand-built polyline sparkline. Draws into a `0 0 100 H` viewBox and stretches to the given CSS size. */
export default function Sparkline({
  values,
  width = 104,
  height = 22,
  vbHeight = 22,
  stroke,
  strokeWidth = 1.2,
  pad = 1.5,
  className,
}: {
  values: number[];
  width?: number | string;
  height?: number;
  vbHeight?: number;
  stroke: string;
  strokeWidth?: number;
  pad?: number;
  className?: string;
}) {
  const pts = sparkPoints(values, vbHeight, pad);
  return (
    <svg
      viewBox={`0 0 100 ${vbHeight}`}
      preserveAspectRatio="none"
      style={{ width, height, display: 'block', flex: 'none' }}
      className={className}
      aria-hidden="true"
    >
      {pts && <polyline points={pts} fill="none" stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

/** "x,y x,y …" in a 0..100 × 0..H box, y inverted, with `pad` units of headroom. */
export function sparkPoints(values: number[], vbHeight: number, pad = 1.5): string | null {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const usable = vbHeight - pad * 2;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = pad + usable - ((v - min) / span) * usable;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}
