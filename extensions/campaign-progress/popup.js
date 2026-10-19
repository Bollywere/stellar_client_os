/**
 * Fundable Campaign Progress popup (issue #1251).
 *
 * Scans the browser's real bookmarks for campaign page links (AC: "bookmarked
 * campaigns"), fetches each campaign from the platform API, and renders name,
 * percentage funded and days remaining (AC2). Clicking a row opens the
 * campaign page in a new tab (AC3).
 *
 * Runs unmodified in both Chrome (chrome.*) and Firefox (browser.*).
 */

const api = typeof browser !== "undefined" ? browser : chrome;

const CAMPAIGN_PATH_RE = /\/campaigns\/([^/?#]+)/;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_API_BASE = "http://localhost:3000";

const el = (id) => document.getElementById(id);

function campaignIdFromUrl(url) {
  try {
    const match = new RegExp(CAMPAIGN_PATH_RE.source).exec(new URL(url).pathname);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function getApiBase() {
  const stored = await api.storage.local.get({ apiBase: DEFAULT_API_BASE });
  return (stored.apiBase || DEFAULT_API_BASE).replace(/\/+$/, "");
}

async function fetchCampaign(id, base) {
  const response = await fetch(`${base}/api/campaigns/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
  return response.json();
}

function percentFunded(campaign) {
  const goal = Number(String(campaign.goalAmount ?? "0").replaceAll(",", ""));
  const raised = Number(String(campaign.raisedAmount ?? "0").replaceAll(",", ""));
  if (!Number.isFinite(goal) || goal <= 0 || !Number.isFinite(raised)) return null;
  return Math.min(100, Math.round((raised / goal) * 100));
}

function daysRemaining(campaign) {
  const end = campaign.endDate ? Date.parse(campaign.endDate) : NaN;
  if (Number.isFinite(end)) {
    return Math.max(0, Math.ceil((end - Date.now()) / DAY_MS));
  }
  // Fallback to the duration record when endDate is absent.
  if (Number.isFinite(campaign.durationMs) && campaign.createdAt) {
    const deadline = campaign.createdAt + campaign.durationMs;
    return Math.max(0, Math.ceil((deadline - Date.now()) / DAY_MS));
  }
  return null;
}

function renderRow(bookmark, campaign) {
  const li = document.createElement("li");
  li.className = "campaign";
  li.tabIndex = 0;
  li.setAttribute("role", "button");

  const pct = percentFunded(campaign);
  const days = daysRemaining(campaign);

  const name = document.createElement("div");
  name.className = "name";
  name.textContent = campaign.name || bookmark.title || bookmark.id;

  const meta = document.createElement("div");
  meta.className = "meta";
  const pctSpan = document.createElement("span");
  pctSpan.className = "pct";
  pctSpan.textContent = pct === null ? "—" : `${pct}% funded`;
  const daysSpan = document.createElement("span");
  daysSpan.textContent = days === null ? "" : `${days} day${days === 1 ? "" : "s"} left`;
  meta.append(pctSpan, daysSpan);

  const bar = document.createElement("div");
  bar.className = "progress";
  const fill = document.createElement("div");
  fill.style.width = `${pct ?? 0}%`;
  bar.append(fill);

  li.append(name, meta, bar);

  const open = () => api.tabs.create({ url: bookmark.url });
  li.addEventListener("click", open);
  li.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });
  return li;
}

async function load() {
  const list = el("campaigns");
  const empty = el("empty");
  const error = el("error");
  list.textContent = "";
  empty.classList.add("hidden");
  error.classList.add("hidden");

  try {
    const base = await getApiBase();
    const bookmarks = await api.bookmarks.getTree();
    const campaignBookmarks = [];
    const walk = (node) => {
      for (const child of node.children ?? []) {
        const id = child.url ? campaignIdFromUrl(child.url) : null;
        if (id) campaignBookmarks.push({ id, url: child.url, title: child.title });
        walk(child);
      }
    };
    walk(bookmarks[0]);

    if (campaignBookmarks.length === 0) {
      empty.classList.remove("hidden");
      return;
    }

    const results = await Promise.allSettled(
      campaignBookmarks.map(async (bookmark) => ({
        bookmark,
        campaign: await fetchCampaign(bookmark.id, base),
      })),
    );

    let rendered = 0;
    for (const result of results) {
      if (result.status === "fulfilled") {
        list.append(renderRow(result.value.bookmark, result.value.campaign));
        rendered += 1;
      }
    }
    if (rendered === 0) {
      error.textContent = "Could not load campaigns — is the platform running?";
      error.classList.remove("hidden");
    } else {
      const failed = results.length - rendered;
      if (failed > 0) {
        error.textContent = `${failed} bookmarked campaign${failed === 1 ? "" : "s"} could not be loaded.`;
        error.classList.remove("hidden");
      }
    }
  } catch (err) {
    error.textContent = err && err.message ? err.message : "Failed to load bookmarks.";
    error.classList.remove("hidden");
  }
}

/** Offer to bookmark the current tab when it is a campaign page (AC1 entry point). */
async function setupBookmarkButton() {
  const button = el("bookmark-tab");
  const hint = el("tab-hint");
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    const id = tab && tab.url ? campaignIdFromUrl(tab.url) : null;
    if (!id) {
      hint.textContent = "Current tab is not a campaign page.";
      return;
    }
    button.disabled = false;
    button.textContent = "Bookmark this tab";
    button.addEventListener("click", async () => {
      const existing = await api.bookmarks.search({ url: tab.url });
      if (existing.length === 0) {
        await api.bookmarks.create({ title: tab.title || `Campaign ${id}`, url: tab.url });
      }
      button.disabled = true;
      button.textContent = "Bookmarked ✓";
      await load();
    });
  } catch {
    hint.textContent = "";
  }
}

async function setupApiBaseInput() {
  const input = el("api-base");
  const stored = await api.storage.local.get({ apiBase: DEFAULT_API_BASE });
  input.value = stored.apiBase || DEFAULT_API_BASE;
  input.addEventListener("change", async () => {
    const value = input.value.trim().replace(/\/+$/, "") || DEFAULT_API_BASE;
    await api.storage.local.set({ apiBase: value });
    await load();
  });
}

el("refresh").addEventListener("click", load);
document.addEventListener("DOMContentLoaded", () => {
  setupApiBaseInput();
  setupBookmarkButton();
  load();
});
