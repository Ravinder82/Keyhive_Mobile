/**
 * Explainable insight scoring (doc §15):
 *   priority = severity × confidence × magnitude × recency
 * All inputs are produced by deterministic rules; nothing is opaque.
 */

import type { Insight } from "../shared/types";

export interface ScoreableInsight extends Omit<Insight, "score"> {}

export function computeScore(i: ScoreableInsight): number {
  const magNorm = Math.min(1, Math.abs(i.magnitude));
  const raw = i.severity * i.confidence * (magNorm === 0 ? 0.5 : magNorm) * i.recency;
  return Math.round(raw * 1000) / 1000;
}

/**
 * Recency decays exponentially with the age of the underlying signal,
 * half-life = one third of the comparison window.
 */
export function recencyOf(signalTimestamp: number, windowMs: number, now: number): number {
  const age = Math.max(0, now - signalTimestamp);
  const halfLife = windowMs / 3;
  return Math.max(0.1, Math.pow(0.5, age / halfLife));
}

export function confidenceFromSample(currentN: number, baselineN: number): number {
  // Full confidence once we have >=10 current samples backed by >=10 baseline.
  return Math.min(1, (Math.min(currentN, 10) / 10) * 0.6 + (Math.min(baselineN, 10) / 10) * 0.4);
}

export function finalize(
  cands: ScoreableInsight[],
): Insight[] {
  return cands.map((c) => ({ ...c, score: computeScore(c) }));
}
