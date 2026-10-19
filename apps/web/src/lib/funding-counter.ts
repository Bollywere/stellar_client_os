/**
 * Shared helpers for the real-time campaign funding counter (issue #1259).
 *
 * Kept framework-free so the SSE route, the hook, and the animated number
 * component can all share the exact same formatting and easing maths.
 */

/** Interval used when the live SSE stream is unavailable (issue #1259 AC3). */
export const FUNDING_POLL_INTERVAL_MS = 30_000;

/** Idle refresh cadence of the server-side data source while an SSE stream is open. */
export const FUNDING_STREAM_TICK_MS = 2_000;

/** Heartbeat spacing for the SSE comment line that keeps proxies from idling out. */
export const FUNDING_STREAM_HEARTBEAT_MS = 15_000;

/**
 * Round-to-int easing for the number rolling animation: fast start, gentle
 * landing, always monotonic between `from` and `to` for t ∈ [0, 1].
 */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return 1 - Math.pow(1 - clamped, 3);
}

/**
 * Grouped integer display for a funding amount, e.g. 33850 -> "33,850".
 * Negative or non-finite values degrade to "0" so the counter never shows NaN.
 */
export function formatFunding(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Math.round(value).toLocaleString("en-US");
}

/** Value shown at animation time `t` (0..1) between two funding totals. */
export function tweenFundingValue(from: number, to: number, t: number): number {
  if (!Number.isFinite(from)) from = 0;
  if (!Number.isFinite(to)) to = 0;
  return from + (to - from) * easeOutCubic(t);
}

/** Funding percentage against the goal, clamped to whole 0..100 like the page. */
export function fundingPercent(raised: number, goal: number): number {
  const goalValue = Number.isFinite(goal) ? goal : 0;
  if (goalValue <= 0) return 0;
  return Math.min(100, Math.round(((Number.isFinite(raised) ? raised : 0) / goalValue) * 100));
}
