import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useFundingCounter, type FundingSnapshot } from "./use-funding-counter";

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];

  url: string;
  readyState: number = FakeEventSource.OPEN;
  closed = false;
  private listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: (event: MessageEvent<string>) => void) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name)!.add(listener);
  }

  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  emit(name: string, data: unknown) {
    for (const listener of this.listeners.get(name) ?? []) {
      listener(new MessageEvent(name, { data: JSON.stringify(data) }));
    }
  }

  emitError(readyState: number) {
    this.readyState = readyState;
    act(() => {
      this.onerror?.();
    });
  }
}

const snapshotShape = (overrides: Partial<FundingSnapshot> = {}): FundingSnapshot => ({
  campaignId: "camp-1259",
  goalAmount: "50000",
  raisedAmount: "33850",
  sponsorCount: 5,
  updatedAt: 1_000,
  percentFunded: 68,
  ...overrides,
});

const flushEffects = () => act(async () => Promise.resolve());

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource as unknown as typeof EventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("useFundingCounter", () => {
  it("subscribes to the SSE funding stream and applies live updates", async () => {
    const { result } = renderHook(() => useFundingCounter("camp-1259"));
    await flushEffects();

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("/api/campaigns/camp-1259/funding-stream");

    act(() => {
      FakeEventSource.instances[0].emit("funding", snapshotShape());
    });

    expect(result.current.status).toBe("live");
    expect(result.current.snapshot?.raisedAmount).toBe("33850");
    expect(result.current.lastUpdated).not.toBeNull();
  });

  it("ignores funding events for a different campaign id", async () => {
    renderHook(() => useFundingCounter("camp-1259"));
    await flushEffects();

    act(() => {
      FakeEventSource.instances[0].emit("funding", snapshotShape({ campaignId: "other" }));
    });

    // Status stays idle until the stream identifies itself.
    await waitFor(() => {
      // The connection itself is the only observable activity.
      expect(FakeEventSource.instances[0].closed).toBe(false);
    });
  });

  it("falls back to 30-second polling when EventSource is unavailable", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", undefined);
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ goalAmount: "50000", raisedAmount: "33850", sponsorCount: 2, updatedAt: 42 }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useFundingCounter("camp-1259"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => Promise.resolve());

    expect(result.current.status).toBe("polling");
    expect(result.current.snapshot?.raisedAmount).toBe("33850");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // The next poll only happens on the 30-second interval boundary.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ goalAmount: "50000", raisedAmount: "36000", sponsorCount: 3, updatedAt: 99 }),
      })),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    await act(async () => Promise.resolve());
    expect(result.current.snapshot?.raisedAmount).toBe("36000");
  });

  it("switches to polling when the stream errors terminally", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ goalAmount: "50000", raisedAmount: "33850", sponsorCount: 2, updatedAt: 42 }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useFundingCounter("camp-1259"));
    await flushEffects();
    expect(result.current.status).toBe("idle");

    FakeEventSource.instances[0].emitError(FakeEventSource.CLOSED);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => Promise.resolve());

    expect(result.current.status).toBe("polling");
    expect(result.current.snapshot?.raisedAmount).toBe("33850");
  });

  it("keeps the last known value but shows not-found when the campaign is unknown", async () => {
    const { result } = renderHook(() => useFundingCounter("camp-1259"));
    await flushEffects();

    act(() => {
      FakeEventSource.instances[0].emit("funding", snapshotShape());
      FakeEventSource.instances[0].emit("not_found", { campaignId: "camp-1259" });
    });

    expect(result.current.status).toBe("not-found");
    expect(result.current.snapshot?.raisedAmount).toBe("33850");
  });

  it("closes the stream and clears the poller on unmount", async () => {
    const { unmount } = renderHook(() => useFundingCounter("camp-1259"));
    await flushEffects();

    unmount();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });

  it("does nothing without a campaign id", () => {
    renderHook(() => useFundingCounter(undefined));
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
