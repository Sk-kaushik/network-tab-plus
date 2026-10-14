# Network+

A DevTools network panel you can tidy up. Right-click a noisy request and it never comes back; save the filters you keep reaching for.

Works in Brave, Chrome, Edge and any other Chromium browser.

---

## Install it once (Brave or Chrome)

1. Open `brave://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode**, top-right.
3. Click **Load unpacked** and pick the `extension/` folder in this repo.
4. Open DevTools (⌥⌘I) on any page. There's a new **Network+** tab next to Network.

That's it — it survives browser restarts and updates. Keep this folder where it is; the
browser loads it from this path every time. If you change the code, hit **Reload** on the
extension card.

> Like the built-in Network tab, it only records while DevTools is open.

---

## What it does

**Hide requests for good.** Right-click any row:

| Option | What it hides |
|---|---|
| This request only | Just that row, until you clear the log |
| All with this path | Every request to that path, whatever the query string — so `/heartbeat?t=1` and `?t=2` both go |
| All from this domain | Everything from that host |

Tick **Apply on every site** before choosing, and the rule follows you everywhere
(good for analytics). Otherwise it only applies to the site you made it on.

**Hidden button** — top right, with a count. Opens a drawer listing every rule, split into
*This site* and *Everywhere*, showing how many requests each one swallowed. Hover a rule
to un-hide it.

**Saved filters** — set up a filter (text + method/status/type), then hit **+** on the
right of the filter bar and name it. It becomes a tab. Click to switch, ✕ to delete.

**Filter box** accepts plain text, `-word` to exclude, and `/regex/` for patterns. Combine
them: `api -heartbeat /v[12]/`.

**Columns** — the Columns button, or right-click any column header. Six extras are
available that aren't on by default: Path, Full URL, Initiator, Protocol, Started, Priority.

**Detail pane** — Headers, Payload and Response, with a Copy button on the last two.
Drag its left edge to resize, or hit **Expand** for full width.

---

## Publishing it to the Chrome Web Store

The extension is already store-ready: no remote code, no host permissions, `storage` is the
only permission it asks for.

```bash
./package.sh
```

That produces `network-plus-<version>.zip`. Then:

1. Register as a Chrome Web Store developer — one-off $5 fee at
   <https://chrome.google.com/webstore/devconsole>.
2. **New item** → upload the zip.
3. Fill in the listing. You'll need a 128×128 icon (in `extension/icons/`) and at least one
   1280×800 screenshot of the panel in use.
4. Under **Privacy practices**, declare the `storage` permission ("saves your hide rules and
   filters on your own machine") and tick that you don't collect user data. Nothing leaves
   the browser.
5. Set visibility to **Unlisted** if it's just for you and your team — you get a link to
   install from, and it auto-updates, without being publicly searchable.

Review usually takes a few days. Bump `version` in `extension/manifest.json` for each
upload.

---

## Layout

```
extension/
  manifest.json      MV3 manifest
  devtools.html/js   registers the panel
  panel.html         markup
  panel.css          all styling, dark + light
  panel.js           capture, filtering, menus, wiring
  store.js           hide rules, saved filters, prefs (chrome.storage.local)
  request.js         HAR entry → table row, cURL export
  detail.js          the Headers/Payload/Response pane
  graphql.js         GraphQL detection, formatting and copy
  lib/               Tabulator 6.3.1 + graphql-js 16.9.0, vendored — no CDN at runtime
  icons/
package.sh           builds the upload zip
```

No build step and no npm. Plain HTML, CSS and ES modules — what's in `extension/` is what runs.
