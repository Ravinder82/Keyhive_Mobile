import type { BreakdownEntry, Insight, RecentActivityItem } from "../shared/types";
import { formatDuration, formatNumber, formatUsd } from "../shared/types";
import type { ReactNode } from "react";

// ---------------------------------------------------------------- MetricCard

export function MetricCard(props: {
  label: string;
  value: string;
  delta?: { text: string; tone: "up-good" | "up-bad" | "down-good" | "down-bad" | "flat" };
  smallValue?: boolean;
}) {
  return (
    <div className="metric-card" role="group" aria-label={props.label}>
      <div className="label">{props.label}</div>
      <div className={props.smallValue ? "value small" : "value"}>{props.value}</div>
      {props.delta && (
        <div className={`delta ${props.delta.tone}`}>
          {props.delta.text}
          {props.delta.tone !== "flat" ? (
            <span className="sr-only"> versus previous period</span>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function deltaTone(
  direction: "up" | "down",
  goodWhenUp: boolean,
): "up-good" | "down-good" | "up-bad" | "down-bad" {
  if (direction === "up") return goodWhenUp ? "up-good" : "up-bad";
  return goodWhenUp ? "down-bad" : "down-good";
}

// -------------------------------------------------------------- Breakdowns

export function BreakdownList(props: { entries: BreakdownEntry[]; emptyText: string }) {
  if (props.entries.length === 0) {
    return <p className="chart-summary">{props.emptyText}</p>;
  }
  return (
    <ul className="breakdown-list">
      {props.entries.slice(0, 6).map((e) => (
        <li key={e.key} className="breakdown-item">
          <span className="name" title={e.key}>{e.key}</span>
          <span className="num">
            {formatNumber(e.requests)} · {Math.round(e.share * 100)}%
            {e.costUsd !== null ? ` · ${formatUsd(e.costUsd)}` : ""}
          </span>
          <span className="bar-track" aria-hidden="true">
            <span className="bar-fill" style={{ width: `${Math.max(3, e.share * 100)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ Insights

const LAYER_META: Record<
  string,
  { tag: string; cls: string; glyph: string; name: string }
> = {
  need_to_know: { tag: "ntk", cls: "ntk", glyph: "★", name: "Need to Know" },
  needs_attention: { tag: "attention", cls: "attention", glyph: "⚠\uFE0E", name: "Needs Attention" },
  watch: { tag: "watch", cls: "watch", glyph: "◔", name: "Watch" },
  healthy: { tag: "healthy", cls: "healthy", glyph: "✓", name: "Healthy" },
};

function InsightCard({ insight }: { insight: Insight }) {
  const meta = LAYER_META[insight.layer] ?? LAYER_META.watch!;
  return (
    <article className={`insight-card ${meta.cls}`} aria-label={`${meta.name}: ${insight.title}`}>
      <span className="glyph" aria-hidden="true">{meta.glyph}</span>
      <span className={`layer-tag ${meta.tag}`}>{meta.name}</span>
      <div className="title">{insight.title}</div>
      <div className="detail">{insight.detail}</div>
      <div className="insight-metrics">
        {insight.metrics.map((m, i) => (
          <span key={i}>
            <span className="m-label">{m.label}: </span>
            <span className="m-value">
              {m.value}
              {m.compare ? <span className="m-label"> ({m.compare})</span> : null}
            </span>
          </span>
        ))}
        <span>
          <span className="m-label">Window: </span>
          <span className="m-value">{insight.windowLabel}</span>
        </span>
      </div>
    </article>
  );
}

/** InsightPanel — additive layer over the raw metrics; never replaces them. */
export function InsightPanel({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) {
    return (
      <p className="chart-summary">
        No insights yet — they appear automatically once enough request history exists in this
        window. Raw metrics below remain available at all times.
      </p>
    );
  }
  return (
    <div className="insight-list">
      {insights.map((i) => (
        <InsightCard key={i.id} insight={i} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------ RecentActivity

export function RecentActivity({ items }: { items: RecentActivityItem[] }) {
  if (items.length === 0) {
    return <p className="chart-summary">No recorded activity yet.</p>;
  }
  return (
    <ul className="activity-list">
      {items.map((a) => (
        <li key={a.eventId} className="activity-item">
          <span className="when">{new Date(a.timestamp).toLocaleString()}</span>
          <span className="what">
            {a.provider}
            {a.model ? ` · ${a.model}` : ""}
          </span>
          <span className={`res ${a.status === "success" ? "ok" : "bad"}`}>
            {a.status === "success"
              ? `OK · ${formatDuration(a.latencyMs)}${a.estimatedCostUsd !== undefined && a.estimatedCostUsd > 0 ? ` · ${formatUsd(a.estimatedCostUsd)}` : ""}`
              : `FAILED · ${a.errorCategory ?? "error"}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- EmptyState

export function EmptyState(props: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="big" aria-hidden="true">{props.icon}</div>
      <strong>{props.title}</strong>
      {props.children}
    </div>
  );
}
