import { useMemo, useState } from "react";
import { formatBytes } from "../../shared/types";

interface Slice {
  key: string;
  label: string;
  value: number;
  color: string;
  sub?: string;
}

/* ================= Donut ================= */
export function DonutChart({
  data,
  centerTitle,
  centerValue,
  centerSub,
  size = 210,
  thickness = 26,
}: {
  data: Slice[];
  centerTitle?: string;
  centerValue?: string;
  centerSub?: string;
  size?: number;
  thickness?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  const total = useMemo(() => data.reduce((a, s) => a + s.value, 0), [data]);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  const slices = data.map((s) => {
    const frac = total > 0 ? s.value / total : 0;
    const dash = frac * circ;
    const o = offset;
    offset += dash;
    return { ...s, frac, dash, offset: o };
  });

  return (
    <div className="row" style={{ alignItems: "center", gap: 20 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={thickness} />
        {slices.map((s, i) => {
          const isActive = active === i;
          return (
            <circle
              key={s.key}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={isActive ? thickness + 5 : thickness}
              strokeDasharray={`${Math.max(0, s.dash - 2)} ${circ - Math.max(0, s.dash - 2)}`}
              strokeDashoffset={-s.offset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${cx} ${cy})`}
              style={{
                cursor: "pointer",
                transition: "stroke-width 0.25s ease, filter 0.25s ease",
                filter: isActive ? `drop-shadow(0 0 10px ${s.color})` : undefined,
                opacity: active === null || isActive ? 1 : 0.45,
              }}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              <title>{`${s.label} — ${formatBytes(s.value)} (${(s.frac * 100).toFixed(1)} %)`}</title>
            </circle>
          );
        })}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="#ececf7" style={{ fontSize: 17, fontWeight: 750 }}>
          {centerValue ?? (active !== null ? formatBytes(slices[active]?.value ?? 0) : formatBytes(total))}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fill="#9d9db8" style={{ fontSize: 12 }}>
          {active !== null ? slices[active]?.label ?? "" : centerTitle ?? "Total"}
        </text>
        {centerSub && (
          <text x={cx} y={cy + 30} textAnchor="middle" fill="#6d6d89" style={{ fontSize: 11 }}>
            {centerSub}
          </text>
        )}
      </svg>
      <div className="chart-legend flex-1">
        {slices.map((s, i) => (
          <div key={s.key} className="legend-item" onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}>
            <span className="legend-swatch" style={{ background: s.color, boxShadow: `0 0 8px ${s.color}66` }} />
            <span className="legend-name">{s.label}</span>
            <span className="legend-val">{formatBytes(s.value)}</span>
            <span className="legend-val faint" style={{ width: 44, textAlign: "right" }}>
              {total > 0 ? ((s.value / total) * 100).toFixed(1) : 0}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ================= Barres horizontales ================= */
export function BarChart({ data, max }: { data: Slice[]; max?: number }) {
  const m = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {data.map((d) => (
        <div key={d.key} className="row" style={{ gap: 12 }}>
          <span className="legend-name" style={{ width: 130, flexShrink: 0 }}>
            {d.label}
          </span>
          <div style={{ flex: 1, position: "relative" }}>
            <div
              style={{
                height: 20,
                borderRadius: 6,
                background: `linear-gradient(90deg, ${d.color}cc, ${d.color}55)`,
                width: `${Math.max(1.5, (d.value / m) * 100)}%`,
                boxShadow: `0 0 12px ${d.color}55`,
                transition: "width 0.7s cubic-bezier(0.22,1,0.36,1)",
              }}
            />
          </div>
          <span className="legend-val nowrap">{formatBytes(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ================= Courbe d'évolution ================= */
export function LineChart({
  points,
  width = 720,
  height = 260,
}: {
  points: Array<{ at: number; value: number }>;
  width?: number;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const geom = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map((p) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = (max - min) * 0.12 || 1;
    const lo = min - pad;
    const hi = max + pad;
    const stepX = width / (points.length - 1);
    const xs = points.map((_, i) => i * stepX);
    const ys = points.map((p) => height - ((p.value - lo) / (hi - lo)) * height);
    const line = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
    const area = `${line} L${width},${height} L0,${height} Z`;
    return { line, area, xs, ys, min, max, stepX };
  }, [points, width, height]);

  if (!geom) {
    return <div className="muted small" style={{ padding: 20 }}>Données insuffisantes pour tracer l'évolution.</div>;
  }

  return (
    <div style={{ position: "relative" }} onMouseLeave={() => setHover(null)}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ overflow: "visible" }}>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#7c3aed" />
            <stop offset="100%" stopColor="#c084fc" />
          </linearGradient>
        </defs>
        {[0, 0.33, 0.66, 1].map((f) => (
          <line key={f} x1={0} y1={height * f} x2={width} y2={height * f} stroke="rgba(255,255,255,0.05)" strokeDasharray="4 6" />
        ))}
        <path d={geom.area} fill="url(#areaGrad)" />
        <path
          d={geom.line}
          fill="none"
          stroke="url(#lineGrad)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: "drop-shadow(0 0 8px rgba(139,92,246,0.6))" }}
        />
        {points.map((_, i) => (
          <circle
            key={i}
            cx={geom.xs[i]}
            cy={geom.ys[i]}
            r={hover === i ? 6 : 4}
            fill="#14142a"
            stroke="#a855f7"
            strokeWidth={2}
            style={{ cursor: "crosshair", transition: "r 0.15s" }}
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>
      {hover !== null && (
        <div
          className="treemap-tooltip"
          style={{
            left: Math.min(width - 150, Math.max(0, geom.xs[hover] - 75)),
            top: Math.min(height - 80, Math.max(10, geom.ys[hover] - 80)),
          }}
        >
          <div className="tt-title">
            {new Date(points[hover].at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })}
          </div>
          <div className="tt-line">Stockage : {formatBytes(points[hover].value)}</div>
        </div>
      )}
    </div>
  );
}
