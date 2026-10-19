import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFundingStream, GET } from "./route";
import { setCampaignDataSource, type CampaignDataSource, type CampaignRecord } from "@/services/campaign.service";

const decoder = new TextDecoder();

function campaignRecord(overrides: Partial<CampaignRecord> = {}): CampaignRecord {
  return {
    id: "camp-live",
    creator: "GAAAA...CREATOR",
    name: "Rainforest Rescue",
    status: "ACTIVE",
    goalAmount: "50000",
    raisedAmount: "1000",
    sponsorCount: 1,
    treeCount: 2,
    createdAt: 0,
    updatedAt: 0,
    statusChangedAt: 0,
    sponsors: [],
    statusHistory: [],
    ...overrides,
  };
}

/**
 * Mutable in-memory data source so a test can change the funding total
 * mid-stream, exactly like POST /api/campaigns/:id/contributions would.
 */
function makeDataSource(campaigns: CampaignRecord[]): CampaignDataSource & { setCampaign(record: CampaignRecord): void } {
  const store = [...campaigns];
  return {
    async getCampaigns() {
      return [...store];
    },
    async saveCampaign(record: CampaignRecord) {
      const index = store.findIndex((c) => c.id === record.id);
      if (index >= 0) store[index] = record;
      else store.push(record);
      return record;
    },
    setCampaign(record: CampaignRecord) {
      const index = store.findIndex((c) => c.id === record.id);
      if (index >= 0) store[index] = record;
      else store.push(record);
    },
  };
}

/** Read stream chunks until `predicate` matches or the reader finishes. */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
): Promise<string> {
  let text = "";
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += decoder.decode(value);
    if (predicate(text)) return text;
  }
  throw new Error(`Timed out reading stream: got "${text.slice(0, 200)}"`);
}

let stream: ReadableStream<Uint8Array> | undefined;

afterEach(() => {
  controller?.abort();
  if (stream) {
    stream.cancel().catch(() => undefined);
  }
  stream = undefined;
});

beforeEach(() => {
  vi_resetDataSource();
});

function vi_resetDataSource() {
  // Each test installs its own data source; reset to an empty store so they
  // cannot observe each other's campaigns.
  setCampaignDataSource(makeDataSource([]));
}

describe("GET /api/campaigns/:id/funding-stream", () => {
  it("emits a funding snapshot as server-sent events", async () => {
    setCampaignDataSource(makeDataSource([campaignRecord()]));
    controller = new AbortController();
    stream = createFundingStream("camp-live", { tickMs: 5, signal: controller.signal });
    const reader = stream.getReader() as ReadableStreamDefaultReader<Uint8Array>;

    const text = await readUntil(reader, (t) => t.includes('"raisedAmount":"1000"'));

    expect(text).toContain("event: funding");
    const eventBlock = text.split("\n\n").find((block) => block.startsWith("event: funding")) ?? "";
    const payload = JSON.parse(eventBlock.replace(/^event: funding\ndata: /, "")) as { percentFunded: number; campaignId: string };
    expect(payload.campaignId).toBe("camp-live");
    // 1000 / 50000 = 2%
    expect(payload.percentFunded).toBe(2);
  });

  it("pushes a fresh event after the funding total changes", async () => {
    const source = makeDataSource([campaignRecord()]);
    setCampaignDataSource(source);
    controller = new AbortController();
    stream = createFundingStream("camp-live", { tickMs: 5, signal: controller.signal });
    const reader = stream.getReader() as ReadableStreamDefaultReader<Uint8Array>;

    const initial = await readUntil(reader, (t) => t.includes('"raisedAmount":"1000"'));
    expect(initial).toContain('"raisedAmount":"1000"');

    source.setCampaign({ ...campaignRecord(), raisedAmount: "1000".replace("1000", "1250"), updatedAt: 5 });

    const updated = await readUntil(reader, (t) => t.includes('"raisedAmount":"1250"'));
    expect(updated).toContain("event: funding");
    expect(updated).toContain('"raisedAmount":"1250"');
  });

  it("reports not_found and ends the stream for unknown campaigns", async () => {
    controller = new AbortController();
    stream = createFundingStream("ghost-campaign", { tickMs: 5, signal: controller.signal });
    const reader = stream.getReader() as ReadableStreamDefaultReader<Uint8Array>;

    const text = await readUntil(reader, (t) => t.includes("event: not_found"));
    expect(text).toContain("event: not_found");
    expect(text).toContain('"campaignId":"ghost-campaign"');

    // The stream should end on its own after the not_found event.
    const { done } = await reader.read();
    expect(done).toBe(true);
  });

  it("returns a text/event-stream response", async () => {
    const response = await GET(
      new Request("http://test/api/campaigns/camp-live/funding-stream"),
      { params: Promise.resolve({ id: "camp-live" }) },
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toContain("no-cache");
    // Do not consume this body; it would hang open — cancel immediately.
    await response.body?.cancel();
  });

  it("does not re-emit when nothing changed between ticks", async () => {
    const source = makeDataSource([campaignRecord()]);
    setCampaignDataSource(source);
    controller = new AbortController();
    stream = createFundingStream("camp-live", { tickMs: 5, signal: controller.signal });
    const reader = stream.getReader() as ReadableStreamDefaultReader<Uint8Array>;

    await readUntil(reader, (t) => t.includes('"raisedAmount":"1000"'));
    // Several quiet ticks later there must still be exactly one funding event.
    let text = "";
    const deadline = Date.now() + 120;
    while (Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read().then(({ value }) => (value ? decoder.decode(value) : "")),
        new Promise<"">((resolve) => setTimeout(() => resolve(""), 50)),
      ]);
      text += chunk;
    }
    const fundingEvents = text.split("\n\n").filter((block) => block.startsWith("event: funding"));
    expect(fundingEvents).toHaveLength(1);
  });
});

let controller: AbortController;
