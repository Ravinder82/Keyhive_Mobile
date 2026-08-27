import type { SeriesPoint } from "../shared/types";
import { formatDuration, formatNumber, formatUsd } from "../shared/types";

export function timeLabel(t: number, range: string): string {
  const d = new Date(t);
  if (range === "24h") {
    return d.toLocaleTimeString([], { hour: "numeric" });
  }
  if (range === "all") {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

interface UsageChartProps {
  series: SeriesPoint[];
  range: string;
}

/** Requests-per-bucket bars with failure overlay. Color is never the only signal. */
export function UsageChart({ series, range }: UsageChartProps) {
  if (series.length === 0 || series.every((p) => p.requests === 0)) {
    return (
      <p className="chart-summary">No requests recorded in this window yet.</p>
    );
  }
  const max = Math.max(...series.map((p) => p.requests));
  const total = series.reduce((a, p) => a + p.requests, 0);
  const fails = series.reduce((a, p) => a + p.failures, 0);
  const W = 100;
  const H = 34;
  const bw = W / series.length;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Requests per bucket, ${total} total`}>
        {series.map((p, i) => {
          const h = max > 0 ? (p.requests / max) * (H - 4) : 0;
          const fh = p.requests > 0 ? (p.failures / p.requests) * h : 0;
          return (
            <g key={p.t}>
              <rect x={i * bw + bw * 0.15} y={H - h} width={bw * 0.7} height={h - fh} rx={1}
                fill="var(--accent)" opacity="0.85">
                <title>{`${timeLabel(p.t, range)}: ${p.requests} requests`}</title>
              </rect>
              {fh > 0 && (
                <rect x={i * bw + bw * 0.15} y={H - h} width={bw * 0.7} height={fh} rx={1}
                  fill="var(--bad)">
                  <title>{`${timeLabel(p.t, range)}: ${p.failures} failed`}</title>
                </rect>
              )}
            </g>
          );
        })}
      </svg>
      <p className="chart-summary">
        {formatNumber(total)} request{total === 1 ? "" : "s"} across {series.length} bucket
        {series.length === 1 ? "" : "s"}
        {fails > 0 ? `, ${formatNumber(fails)} failed (red segments)` : ", none failed"}
        . Buckets left→right are oldest→newest.
      </p>
      <p className="chart-axis">
        {timeLabel(series[0]!.t, range)} – {timeLabel(series[series.length - 1]!.t, range)}
      </p>
    </div>
  );
}

/** Spend-over-time area sparkline. */
export function CostChart({ series, range }: UsageChartProps) {
  const pts = series.filter((p) => p.costUsd !== null && p.costUsd > 0);
  const totalCost = series.reduce((a, p) => a + (p.costUsd ?? 0), 0);
  if (pts.length === 0) {
    return (
      <p className="chart-summary">
        No estimated spend recorded in this window. Costs appear when token pricing for the used
        models is known.
      </p>
    );
  }
  const max = Math.max(...pts.map((p) => p.costUsd ?? 0));
  const W = 100;
  const H = 34;
  const step = pts.length > 1 ? W / (pts.length - 1) : 0;
  const coords = pts.map((p, i) => {
    const x = i * step;
    const y = H - ((p.costUsd ?? 0) / max) * (H - 6) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Estimated spend over time, total ${formatUsd(totalCost)}`}>
        <polygon points={`0,${H} ${coords.join(" ")} ${(pts.length - 1) * step},${H}`}
          fill="var(--ok-soft)" stroke="none" />
        <polyline points={coords.join(" ")} fill="none" stroke="var(--ok)" strokeWidth="1.5"
          vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="chart-summary">
        Estimated spend {range !== "all" ? `in the last ${range}` : "overall"}:{" "}
        <strong>{formatUsd(totalCost)}</strong> (estimate, not an invoice). Peak bucket{" "}
        {formatUsd(max)}. Oldest→newest left→right.
      </p>
      <p className="chart-axis">
        {timeLabel(pts[0]!.t, range)} – {timeLabel(pts[pts.length - 1]!.t, range)}
      </p>
    </div>
  );
}

/** Average latency line. */
export function LatencyTrend({ series, range }: UsageChartProps) {
  const pts = series.filter((p) => p.latencyMs !== null);
  if (pts.length === 0) {
    return <p className="chart-summary">No latency data in this window yet.</p>;
  }
  const vals = pts.map((p) => p.latencyMs ?? 0);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const W = 100;
  const H = 34;
  const step = pts.length > 1 ? W / (pts.length - 1) : 0;
  const coords = pts.map((p, i) => {
    const x = i * step;
    const y = H - (((p.latencyMs ?? 0) - min) / Math.max(1, max - min)) * (H - 6) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Latency trend, average ${formatDuration(avg)}`}>
        <polyline points={coords.join(" ")} fill="none" stroke="var(--warn)" strokeWidth="1.5"
          vectorEffect="non-scaling-stroke" />
      </svg>
      <p className="chart-summary">
        Average latency {formatDuration(avg)}, ranging {formatDuration(min)}–{formatDuration(max)}.
        Oldest→newest left→right.
      </p>
      <p className="chart-axis">
        {timeLabel(pts[0]!.t, range)} – {timeLabel(pts[pts.length - 1]!.t, range)}
      </p>
    </div>
  );
}
