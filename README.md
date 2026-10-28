# Network Tab+

A DevTools network panel you can tidy up.

The built-in Network tab shows you everything, forever. Heartbeats, analytics beacons, the
same poll every two seconds — all of it, every time, and you re-type the same filter to get
rid of it. Network Tab+ lets you hide a request for good, save the filters you keep reaching
for, and search inside requests instead of only across their URLs.

Works in Brave, Chrome, Edge and any other Chromium browser.

---

## Install

Load it from source. It takes a minute and survives browser restarts.

1. Clone or download this repo.
2. Open `brave://extensions` (or `chrome://extensions`).
3. Turn on **Developer mode**, top right.
4. Click **Load unpacked** and pick the `extension/` folder.
5. Open DevTools (⌥⌘I / F12) on any page — there's a new **Network Tab+** tab next to Network.

Keep the folder where it is; the browser loads it from that path every time. After changing
the code, hit **Reload** on the extension card.

> Like the built-in Network tab, it only records while DevTools is open. It does pick up
> requests that happened before you opened the panel, though.

---

## What it does

### Hide requests for good

Right-click any row:

| Option | What it hides |
|---|---|
| This request only | Just that row, until you clear the log |
| All with this path | Every request to that path, whatever the query string — `/heartbeat?t=1` and `?t=2` both go |
| All from this domain | Everything from that host |

Tick **Apply on every site** before choosing and the rule follows you everywhere, which is
what you want for analytics. Otherwise it only applies to the site you made it on.

The **Hidden** button, top right, opens a drawer listing every rule — split into *This site*
and *Everywhere*, with a count of how many requests each one swallowed. Un-hide from there.

### Find inside requests (⌘F)

The filter box only ever matched the URL. `⌘F` (`Ctrl F` on Windows and Linux) opens a
finder that searches **URL, headers, payload and response body** — any mix of them.

- Scopes are multi-select. **All** is the default; picking another drops All, picking more
  adds them, turning the last one off goes back to All.
- Matching requests filter the table, the Type column is replaced by **Where it matched**,
  and matched text is highlighted.
- The optional **field** box narrows it further: field `status` with query `active` matches
  only where a key named `status` holds that value — JSON keys at any depth, header names,
  or URL query parameters.
- Response bodies are the only part not already in memory, so they're fetched in batches
  behind a progress bar you can stop. Results fill in as they're found.

A chip on the filter bar shows the active find; click it to edit, ✕ to clear.

### Saved filters

Set up a filter (text plus method, status and type), hit **+** on the right of the filter
bar and name it. It becomes a tab — click to switch, double-click to rename, ✕ to delete.
Edit an applied filter and a **Save** button appears to update it in place.

### Filter box

Plain text, `-word` to exclude, `/regex/` for patterns. Combine them:
`api -heartbeat /v[12]/`. The finder takes the same syntax.

One thing to know about `-word` in the finder: it is checked against the places the search
actually looked at. A request that matches on its URL is never read any further, so an
excluded word sitting in its response body won't rule it out. Searching Response on its own
applies the exclusion to the body.

### GraphQL

GraphQL requests are detected by body shape, so batched, GET-style and persisted queries all
work. The Payload tab shows the document and the variables as separate, separately copyable
blocks — formatted with the real GraphQL parser, so what you paste into your IDE is valid.
The operation name is available as a column.

### The rest

- **Columns** — the Columns button, or right-click any header. Seven extras are off by
  default: GraphQL operation, Path, Full URL, Initiator, Protocol, Started, Priority.
- **Detail pane** — Headers, Payload and Response, each with a Copy button. Drag its left
  edge to resize, or **Expand** for full width.
- **Copy as cURL** and copy payload/response from the right-click menu.
- Follows your DevTools theme, dark and light.

---

## Contributing

Issues and pull requests are welcome — bug reports, a feature you miss from the Network tab,
or a fix for something that annoys you.

There is nothing to set up. No build step, no npm, no bundler. Clone it, load `extension/`
unpacked, edit a file, hit **Reload** on the extension card. What's in `extension/` is
exactly what runs.

A few things worth knowing before you open a PR:

- **Keep it dependency-free.** The two vendored libraries in `extension/lib/` are loaded
  from disk, never a CDN. Please don't add a build step or a package manager.
- **Keep the permissions list at `storage`.** No host permissions, no remote code, nothing
  leaves the browser. That's the whole privacy story (see [PRIVACY.md](PRIVACY.md)) and it
  should stay true.
- **Match the surrounding style.** Plain ES modules, short comments, no framework.
- Say what you changed and how you checked it. There's no test suite, so a note on what you
  clicked through is genuinely useful.

Open an issue first if it's a big change, so you don't build something that doesn't fit.

---

## Layout

```
extension/
  manifest.json      MV3 manifest
  devtools.html/js   registers the panel
  panel.html         markup
  panel.css          all styling, dark + light
  panel.js           capture, filtering, menus, wiring
  find.js            the ⌘F finder
  store.js           hide rules, saved filters, prefs (chrome.storage.local)
  request.js         HAR entry → table row, query matching, cURL export
  detail.js          the Headers/Payload/Response pane
  graphql.js         GraphQL detection, formatting and copy
  lib/               Tabulator 6.3.1 + graphql-js 16.9.0, vendored
  icons/
package.sh           builds a zip of extension/
```

Both bundled libraries are MIT licensed — see [THIRD-PARTY.md](THIRD-PARTY.md).
