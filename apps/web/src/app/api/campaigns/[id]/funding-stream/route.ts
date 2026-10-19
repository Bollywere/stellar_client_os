import { getCampaign } from "@/services/campaign.service";
import {
  FUNDING_STREAM_HEARTBEAT_MS,
  FUNDING_STREAM_TICK_MS,
  formatFunding,
  fundingPercent,
} from "@/lib/funding-counter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FundingSnapshotPayload {
  campaignId: string;
  goalAmount: string;
  raisedAmount: string;
  sponsorCount: number;
  updatedAt: number;
  percentFunded: number;
}

function snapshotPayload(campaignId: string, campaign: {
  goalAmount: string;
  raisedAmount: string;
  sponsorCount: number;
  updatedAt: number;
}): FundingSnapshotPayload {
  const raised = Number(campaign.raisedAmount.replaceAll(",", ""));
  const goal = Number(campaign.goalAmount.replaceAll(",", ""));
  return {
    campaignId,
    goalAmount: campaign.goalAmount,
    raisedAmount: campaign.raisedAmount,
    sponsorCount: campaign.sponsorCount,
    updatedAt: campaign.updatedAt,
    percentFunded: fundingPercent(Number.isFinite(raised) ? raised : 0, Number.isFinite(goal) ? goal : 0),
  };
}

function sseEvent(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Real-time funding stream for a campaign page (issue #1259 AC1).
 *
 * Server-Sent Events: a thin JSON snapshot of the campaign's funding state is
 * pushed to the client whenever the stored total changes (the backing store is
 * mutated in-process by POST /api/campaigns/:id/contributions, so at most a
 * short tick of latency separates a pledge from every open campaign page).
 *
 * Also emits a one-off `not_found` event for unknown campaigns, and a `:ping`
 * comment heartbeat so intermediaries keep the connection alive while totals
 * are quiet.
 */
export function createFundingStream(
  campaignId: string,
  {
    tickMs = FUNDING_STREAM_TICK_MS,
    heartbeatMs = FUNDING_STREAM_HEARTBEAT_MS,
    signal,
  }: { tickMs?: number; heartbeatMs?: number; signal?: AbortSignal } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            // Consumer already tore down the stream; nothing to release.
          }
        }
      };
      const push = (payload: string) => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(payload));
          } catch {
            close();
          }
        }
      };

      const onAbort = () => close();
      signal?.addEventListener("abort", onAbort, { once: true });

      let lastSignature = "";
      let lastHeartbeat = Date.now();

      try {
        while (!closed) {
          const campaign = await getCampaign(campaignId);
          if (!campaign) {
            push(sseEvent("not_found", { campaignId }));
            break;
          }

          const payload = snapshotPayload(campaignId, campaign);
          // Format-normalised signature so cached GET bodies that only differ
          // in whitespace/grouping do not spam identical events.
          const signature = `${campaign.goalAmount}|${formatFunding(Number(payload.raisedAmount.replaceAll(",", "")))}|${campaign.updatedAt}|${campaign.sponsorCount}`;
          if (signature !== lastSignature) {
            lastSignature = signature;
            push(sseEvent("funding", payload));
          }

          if (Date.now() - lastHeartbeat >= heartbeatMs) {
            lastHeartbeat = Date.now();
            push(`:ping\n\n`);
          }

          await new Promise((resolve) => setTimeout(resolve, tickMs));
          if (signal?.aborted) break;
        }
      } catch {
        // Data source failure: end the stream so the client falls back to polling.
      } finally {
        close();
        signal?.removeEventListener("abort", onAbort);
      }
    },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const campaignId = (await params).id;
  return new Response(createFundingStream(campaignId, { signal: request.signal }), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
