// Smoke test for popup.js (issue #1251) — stubs chrome.* + DOM, no deps.
// Run: node smoke-test.mjs
import { readFileSync } from "node:fs";

const rows = [];
function fakeEl(id) {
  return {
    id,
    textContent: "",
    value: "",
    disabled: false,
    className: "",
    children: [],
    classList: { add() {}, remove() {} },
    style: {},
    listeners: {},
    append(...kids) {
      this.children.push(...kids);
      rows.push(...kids);
    },
    addEventListener(ev, fn) {
      this.listeners[ev] = fn;
    },
    setAttribute() {},
  };
}

const els = {};
for (const id of ["campaigns", "empty", "error", "refresh", "bookmark-tab", "tab-hint", "api-base"]) {
  els[id] = fakeEl(id);
}

const allEls = new Map(Object.entries(els));

globalThis.document = {
  getElementById: (id) => allEls.get(id) ?? fakeEl(id),
  addEventListener: (ev, fn) => {
    if (ev === "DOMContentLoaded") globalThis.__ready = fn;
  },
  createElement: (tag) => fakeEl(tag),
};

const now = Date.now();
const DAY = 86_400_000;

globalThis.fetch = async (url) => {
  if (url.includes("camp-101")) {
    return {
      ok: true,
      json: async () => ({
        id: "camp-101",
        name: "Amazon Reserve",
        goalAmount: "50000",
        raisedAmount: "37500",
        endDate: new Date(now + 9 * DAY).toISOString(),
      }),
    };
  }
  if (url.includes("camp-404")) return { ok: false, status: 404 };
  return {
    ok: true,
    json: async () => ({
      id: "camp-fb",
      name: "Duration Campaign",
      goalAmount: "1000",
      raisedAmount: "100",
      createdAt: now - DAY,
      durationMs: 5 * DAY,
    }),
  };
};

const createdTabs = [];

globalThis.chrome = {
  storage: { local: { get: async (d) => d, set: async () => {} } },
  tabs: {
    create: (o) => createdTabs.push(o),
    query: async () => [{ url: "https://app/campaigns/camp-101", title: "Tab" }],
  },
  bookmarks: {
    getTree: async () => [
      {
        children: [
          {
            children: [
              { url: "https://app/campaigns/camp-101", title: "Amazon", children: [] },
              { url: "https://app/campaigns/camp-404", title: "Ghost", children: [] },
              { url: "https://app/campaigns/camp-fb?x=1", title: "Fallback", children: [] },
              { url: "https://example.com/other", title: "Not a campaign", children: [] },
            ],
          },
        ],
      },
    ],
    search: async () => [],
    create: async (b) => b,
  },
};

const source = readFileSync(new URL("./popup.js", import.meta.url), "utf8");
(0, eval)(source);

const dump = (el, out = []) => {
  out.push(String(el.textContent ?? ""));
  (el.children ?? []).forEach((c) => dump(c, out));
  return out;
};

await new Promise((resolve) => {
  globalThis.__ready();
  setTimeout(resolve, 150);
});

const assert = (cond, msg) => {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exit(1);
  }
  console.log("ok:", msg);
};

const campaignRows = rows.filter((r) => r.className === "campaign");
assert(campaignRows.length === 2, `2 campaign rows rendered (got ${campaignRows.length})`);

const joined = campaignRows.map((r) => dump(r).join(" ")).join(" ");
assert(joined.includes("Amazon Reserve"), "shows campaign name (AC2)");
assert(joined.includes("75% funded"), "shows percentage funded (AC2)");
assert(joined.includes("9 days left"), "shows days remaining from endDate (AC2)");
assert(joined.includes("10% funded"), "duration fallback computes percent");
assert(joined.includes("Duration Campaign") && joined.includes("4 days left"), "duration fallback computes days");

campaignRows[0].listeners.click();
assert(createdTabs.length === 1 && createdTabs[0].url === "https://app/campaigns/camp-101", "click opens campaign in new tab (AC3)");

const ghostError = els.error.textContent;
assert(ghostError.includes("could not be loaded"), "failed bookmark reported, not crashed");

console.log("\nALL SMOKE CHECKS PASSED");
