"use client";

import { useEffect, useRef, useState } from "react";
import { FUNDING_POLL_INTERVAL_MS } from "@/lib/funding-counter";

export type FundingFeedStatus = "idle" | "live" | "polling" | "not-found";

export interface FundingSnapshot {
  campaignId: string;
  goalAmount: string;
  raisedAmount: string;
  sponsorCount: number;
  updatedAt: number;
  percentFunded: number;
}

export interface UseFundingCounterResult {
  snapshot: FundingSnapshot | null;
  status: FundingFeedStatus;
  /** Epoch ms of the last accepted update (SSE or poll). */
  lastUpdated: number | null;
}

function parseAmount(value: string): number {
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Subscribe to a campaign's funding total in real time (issue #1259).
 *
 * Primary transport is the SSE stream at /api/campaigns/:id/funding-stream.
 * When SSE is unavailable in the browser, the stream ends (server data error),
 * or the campaign is unknown, the hook falls back to fetching
 * /api/campaigns/:id on a 30-second interval. While the SSE feed is healthy
 * the poller idles, so no wasted requests hit the server.
 */
export function useFundingCounter(
  campaignId: string | undefined,
  options: { pollIntervalMs?: number } = {},
): UseFundingCounterResult {
  const pollIntervalMs = options.pollIntervalMs ?? FUNDING_POLL_INTERVAL_MS;
  const [snapshot, setSnapshot] = useState<FundingSnapshot | null>(null);
  const [status, setStatus] = useState<FundingFeedStatus>("idle");
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const latest = useRef({ snapshot, status });
  useEffect(() => {
    // Mirror latest state for the interval closure without re-subscribing.
    latest.current = { snapshot, status };
  }, [snapshot, status]);

  useEffect(() => {
    if (!campaignId) return undefined;

    let disposed = false;

    // ── Fallback poller ────────────────────────────────────────────────────
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = undefined;
      }
    };
    const applySnapshot = (next: FundingSnapshot) => {
      if (disposed) return;
      setSnapshot(next);
      setLastUpdated(Date.now());
    };

    const pollOnce = async () => {
      try {
        const response = await fetch(`/api/campaigns/${campaignId}`, { cache: "no-store" });
        if (!response.ok) {
          if (response.status === 404) {
            setStatus("not-found");
            stopPolling();
          }
          return;
        }
        const campaign = (await response.json()) as {
          goalAmount?: string;
          raisedAmount?: string;
          sponsorCount?: number;
          updatedAt?: number;
        };
        const raised = parseAmount(campaign.raisedAmount ?? "0");
        const goal = parseAmount(campaign.goalAmount ?? "0");
        const empty = raised === 0 && goal === 0;
        if (!campaign.goalAmount && empty) {
          // GET /api/campaigns/:id 404s as { error }; guard against a 200 with
          // no funding fields just in case.
          return;
        }
        setStatus("polling");
        applySnapshot({
          campaignId,
          goalAmount: campaign.goalAmount ?? "0",
          raisedAmount: campaign.raisedAmount ?? "0",
          sponsorCount: campaign.sponsorCount ?? 0,
          updatedAt: campaign.updatedAt ?? Date.now(),
          percentFunded: goal > 0 ? Math.min(100, Math.round((raised / goal) * 100)) : 0,
        });
      } catch {
        // Network hiccup: keep polling.
      }
    };
    const startPolling = () => {
      if (pollTimer || disposed) return;
      stopPollingEventSource();
      setStatus((current) => (current === "not-found" ? current : "polling"));
      void pollOnce();
      pollTimer = setInterval(() => {
        if (latest.current.status === "live") return; // live feed covers updates
        void pollOnce();
      }, pollIntervalMs);
    };

    // ── SSE primary transport ─────────────────────────────────────────────
    let eventSource: EventSource | undefined;
    const stopPollingEventSource = () => {
      eventSource?.close();
      eventSource = undefined;
    };
    const connectStream = () => {
      if (disposed || typeof window === "undefined" || typeof window.EventSource !== "function") {
        startPolling();
        return;
      }
      let stream: EventSource;
      try {
        stream = new EventSource(`/api/campaigns/${campaignId}/funding-stream`);
      } catch {
        // Some browsers throw on constructor when throttled; fall back to polls.
        startPolling();
        return;
      }
      eventSource = stream;

      stream.addEventListener("funding", (event) => {
        const data = JSON.parse((event as MessageEvent<string>).data) as FundingSnapshot;
        if (data.campaignId !== campaignId) return;
        stopPolling(); // live wins; cancel any fallback poller
        setStatus("live");
        applySnapshot(data);
      });
      stream.addEventListener("not_found", () => {
        setStatus("not-found");
        stopPolling();
      });
      stream.onerror = () => {
        // Keep polling meanwhile; if the stream is terminally broken (CLOSED)
        // close it for good and let the poll keep data fresh.
        if (stream.readyState !== EventSource.CONNECTING && stream.readyState !== EventSource.OPEN) {
          stream.close();
          eventSource = undefined;
        }
        if (!pollTimer && latest.current.status !== "not-found") {
          startPolling();
        }
      };
    };

    connectStream();

    return () => {
      disposed = true;
      stopPolling();
      stopPollingEventSource();
    };
  }, [campaignId, pollIntervalMs]);

  return { snapshot, status, lastUpdated };
}
