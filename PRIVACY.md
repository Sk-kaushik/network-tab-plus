# Privacy Policy — Network Tab+

**Last updated: 15 October 2026**

## Summary

Network Tab+ does not collect, transmit, sell or share any data. There is no account, no
server, and no analytics. Everything the extension stores stays in your own browser.

## What the extension stores

Network Tab+ uses Chrome's `storage` permission to save your settings locally on your own
machine, via `chrome.storage.local`. Specifically:

- Rules you create to hide particular requests (the path or domain you chose to hide, and
  whether the rule applies everywhere or only on one site, in which case that site's
  address is saved with it)
- Filters you save: their name, search text, and the methods, statuses and types you picked
- Which table columns you have chosen to show
- The width of the detail pane, and which filter rows (method, status, type) are shown
- Your on/off choices for "Preserve log", "Hide data: URLs" and "Third-party only"

That is the complete list.

## What the extension does not store

- No request or response bodies
- No headers, cookies, tokens or credentials
- No browsing history (the only addresses saved are the ones in hide rules you create)
- No page content
- No personal information of any kind
- No usage analytics, telemetry or crash reports

Network requests shown in the panel are read from the Chrome DevTools API while DevTools
is open, displayed to you, and discarded when you clear the log or close DevTools. They
are never written to storage.

## Data transmission

None. Network Tab+ requests no host permissions and makes no network requests of its own.
It cannot contact any server, including ours. All code, including the two open-source
libraries it uses (Tabulator and graphql-js), is bundled inside the extension package —
nothing is fetched from the internet at runtime.

## Third parties

There are none. No data is shared with anyone, because no data leaves your browser.

## Permissions

`storage` is the only permission the extension requests. It is used solely to remember
the settings listed above between sessions.

## Your control over your data

Everything is stored locally and under your control:

- Remove individual hide rules or saved filters from within the panel
- Use "Un-hide all" to clear every hide rule at once
- Uninstalling the extension removes all stored settings from your browser

## Children

Network Tab+ is a developer tool and is not directed at children.

## Changes to this policy

If this policy changes, the updated version will be published at this same URL with a new
date at the top.

## Contact

Questions about this policy: open an issue at
https://github.com/Sk-kaushik/network-tab-plus or contact the developer through GitHub at
https://github.com/Sk-kaushik
