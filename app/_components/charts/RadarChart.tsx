// Premium SVG radar chart — reusable across roster analysis, player profiles,
// etc. Pure SVG (server-renderable), dark-mode tuned. Pass 0-100 values per
// axis and a single accent color; the polygon fills with a muted wash of it.

export type RadarAxis = { label: string; value: number };

export default function RadarChart({
  data,
  color,
  size = 220,
  className,
}: {
  data: RadarAxis[];
  color: string;
  size?: number;
  className?: string;
}) {
  const n = data.length;
  if (n < 3) return null;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 26; // leave room for labels
  const rings = [0.25, 0.5, 0.75, 1];

  // Axis i points up first, then clockwise.
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, frac: number) => ({
    x: cx + Math.cos(angle(i)) * r * frac,
    y: cy + Math.sin(angle(i)) * r * frac,
  });
  const polygon = (frac: (i: number) => number) =>
    data
      .map((_, i) => {
        const p = pt(i, frac(i));
        return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      })
      .join(" ");

  const dataPoly = polygon((i) => Math.max(0, Math.min(1, data[i].value / 100)));

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label="Positional strength radar"
    >
      {/* concentric grid rings */}
      {rings.map((frac) => (
        <polygon
          key={frac}
          points={polygon(() => frac)}
          fill="none"
          stroke="rgba(63,63,70,0.35)"
          strokeWidth={1}
        />
      ))}
      {/* spokes */}
      {data.map((_, i) => {
        const p = pt(i, 1);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={p.x}
            y2={p.y}
            stroke="rgba(63,63,70,0.3)"
            strokeWidth={1}
          />
        );
      })}
      {/* data polygon */}
      <polygon
        points={dataPoly}
        fill={color}
        fillOpacity={0.18}
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 4px ${color}66)` }}
      />
      {/* vertices */}
      {data.map((d, i) => {
        const p = pt(i, Math.max(0, Math.min(1, d.value / 100)));
        return <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={color} />;
      })}
      {/* axis labels */}
      {data.map((d, i) => {
        const p = pt(i, 1.16);
        const a = angle(i);
        const anchor =
          Math.abs(Math.cos(a)) < 0.3
            ? "middle"
            : Math.cos(a) > 0
              ? "start"
              : "end";
        return (
          <text
            key={i}
            x={p.x}
            y={p.y + 3}
            textAnchor={anchor}
            className="fill-zinc-400"
            fontSize={11}
            fontFamily="ui-sans-serif, system-ui, sans-serif"
          >
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}
