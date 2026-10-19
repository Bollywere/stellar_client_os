# Fundable Campaign Progress (browser extension)

A lightweight browser extension that shows funding progress for your **bookmarked** Fundable campaigns without visiting the platform ([issue #1251](https://github.com/Fundable-Protocol/stellar_client_os/issues/1251)).

## Acceptance criteria

- **Available for Chrome and Firefox** — Manifest V3 with `browser_specific_settings.gecko`, plain HTML/CSS/JS (no build step). Uses the `chrome.*` / `browser.*` polyglot, so one codebase loads in both browsers.
- **Shows campaign name, percentage funded, and days remaining** — the popup scans your real browser bookmarks for `/campaigns/:id` links, fetches each campaign from the platform API, and renders a row with name, `% funded`, a progress bar, and `N days left`.
- **Click to open campaign page in new tab** — clicking (or pressing Enter/Space on) a row calls `tabs.create` with the campaign URL.

## Install (Chrome)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select this `extensions/campaign-progress/` folder

## Install (Firefox)

1. Open `about:debugging#/runtime/this-firefox`
2. **Load Temporary Add-on…** → select `extensions/campaign-progress/manifest.json`

(For permanent distribution, package and sign via the [Firefox Add-ons Developer Hub](https://addons.mozilla.org/developers/).)

## Usage

1. Bookmark any campaign page (or open one and press **Bookmark this tab** in the popup)
2. Click the extension icon — your bookmarked campaigns appear with live funding progress
3. Click a row to open that campaign in a new tab

The **API** field at the bottom of the popup sets the platform origin (default `http://localhost:3000`; point it at your deployed instance, e.g. `https://<your-host>`).

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest, Chrome + Firefox (`gecko.id`), permissions: `storage`, `tabs`, `bookmarks` |
| `popup.html` / `popup.css` | Popup shell and styles |
| `popup.js` | Bookmark scan → `GET /api/campaigns/:id` → render name / % funded / days remaining; open-in-new-tab; API base setting |
| `icons/icon48.png`, `icons/icon128.png` | Extension icons |

## Notes

- Days remaining prefers the campaign's `endDate` and falls back to `createdAt + durationMs`.
- Fetch failures surface as a per-campaign count in the popup instead of breaking the whole list.
