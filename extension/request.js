// Turns a raw HAR entry from DevTools into the flat shape the table and detail pane use.

export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function normalize(entry, id) {
  let url;
  try {
    url = new URL(entry.request.url);
  } catch {
    url = { hostname: "", pathname: entry.request.url, search: "" };
  }

  return {
    id,
    entry,
    url: entry.request.url,
    host: url.hostname,
    path: url.pathname,
    name: displayName(url),
    method: entry.request.method,
    status: entry.response.status,
    type: resourceType(entry),
    sizeBytes: transferSize(entry),
    size: formatBytes(transferSize(entry)),
    time: Math.max(0, Math.round(entry.time)),
    started: entry.startedDateTime,
    proto: entry.response.httpVersion || "",
    initiator: initiatorOf(entry),
    priority: entry._priority || "",
    operation: quickOperation(entry),
  };
}

// The GraphQL operation name, pulled straight out of the JSON body. Deliberately
// avoids the GraphQL parser so this stays cheap enough to run on every request.
function quickOperation(entry) {
  const text = entry.request.postData?.text;
  if (!text || text.length > 200000 || !text.includes('"query"')) return "";
  try {
    const body = JSON.parse(text);
    return (Array.isArray(body) ? body : [body])
      .map((item) => item?.operationName || nameFromQueryText(item?.query))
      .filter(Boolean)
      .join(", ");
  } catch {
    return "";
  }
}

function nameFromQueryText(query) {
  if (typeof query !== "string") return "";
  return /\b(?:query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(query)?.[1] || "";
}

function displayName(url) {
  const last = url.pathname.split("/").filter(Boolean).pop();
  return (last || url.hostname || "/") + (url.search || "");
}

function resourceType(entry) {
  if (entry._resourceType) return entry._resourceType;
  const mime = entry.response?.content?.mimeType || "";
  if (mime.includes("javascript")) return "script";
  if (mime.includes("css")) return "stylesheet";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("font/")) return "font";
  if (mime.includes("html")) return "document";
  return "other";
}

function transferSize(entry) {
  const res = entry.response || {};
  if (typeof res._transferSize === "number" && res._transferSize >= 0) return res._transferSize;
  if (typeof res.bodySize === "number" && res.bodySize >= 0) return res.bodySize;
  return res.content?.size || 0;
}

function initiatorOf(entry) {
  const init = entry._initiator;
  if (!init) return "";
  const frame = init.stack?.callFrames?.[0];
  if (frame?.url) return `${shortFile(frame.url)}:${(frame.lineNumber || 0) + 1}`;
  if (init.url) return shortFile(init.url);
  return init.type || "";
}

function shortFile(url) {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).pop() || url;
  } catch {
    return url;
  }
}

export function formatBytes(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " kB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

export function formatTime(ms) {
  if (ms < 1000) return Math.round(ms) + " ms";
  return (ms / 1000).toFixed(2) + " s";
}

export function statusKind(status) {
  if (!status) return "un";
  if (status < 300) return "ok";
  if (status < 400) return "rd";
  return "bd";
}

/* ------------------------------------------------- query text matching */

// The filter box and the finder share one syntax: plain terms, -exclusions, /regex/.
export function parseQuery(text) {
  const include = [], exclude = [], regexes = [];
  for (const term of String(text ?? "").trim().split(/\s+/).filter(Boolean)) {
    if (term.startsWith("-") && term.length > 1) {
      exclude.push(term.slice(1).toLowerCase());
    } else if (term.length > 2 && term.startsWith("/") && term.endsWith("/")) {
      try { regexes.push(new RegExp(term.slice(1, -1), "i")); } catch { /* ignore bad regex while typing */ }
    } else {
      include.push(term.toLowerCase());
    }
  }
  return { include, exclude, regexes };
}

export function queryIsEmpty(parsed) {
  return !parsed.include.length && !parsed.exclude.length && !parsed.regexes.length;
}

// Split in two because the finder needs them separately: an exclusion has to be
// judged across everything it searched, while the terms to find are judged per place.
export function queryExcludes(text, parsed) {
  const lower = String(text ?? "").toLowerCase();
  return parsed.exclude.some((term) => lower.includes(term));
}

export function queryIncludes(text, parsed) {
  const value = String(text ?? "");
  const lower = value.toLowerCase();
  return parsed.include.every((term) => lower.includes(term)) &&
         parsed.regexes.every((re) => re.test(value));
}

export function queryMatches(text, parsed) {
  return !queryExcludes(text, parsed) && queryIncludes(text, parsed);
}

// Wraps each plain term in <mark>, for the Name column while a find is active.
// Escaping happens per segment, so the marks survive but the text stays safe.
export function markTerms(text, terms) {
  const value = String(text ?? "");
  if (!terms.length) return esc(value);

  // Matched on the original string: lower-casing it first would shift every
  // position, because some characters get longer in lower case (İ is one).
  const pattern = new RegExp(terms.map(escapeRegex).join("|"), "gi");
  let out = "", cursor = 0, hit;
  while ((hit = pattern.exec(value)) !== null) {
    out += esc(value.slice(cursor, hit.index)) + "<mark>" + esc(hit[0]) + "</mark>";
    cursor = hit.index + hit[0].length;
  }
  return out + esc(value.slice(cursor));
}

function escapeRegex(term) {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Headers we leave out of the cURL command because curl sets them itself.
const SKIP_HEADERS = ["content-length", "host", "connection"];

export function toCurl(req) {
  const parts = [`curl '${shellQuote(req.url)}'`];
  if (req.method !== "GET") parts.push(`-X '${shellQuote(req.method)}'`);

  for (const header of req.entry.request.headers || []) {
    const name = header.name.toLowerCase();
    if (name.startsWith(":") || SKIP_HEADERS.includes(name)) continue;
    parts.push(`-H '${shellQuote(header.name)}: ${shellQuote(header.value)}'`);
  }

  const body = req.entry.request.postData?.text;
  if (body) parts.push(`--data-raw '${shellQuote(body)}'`);

  return parts.join(" \\\n  ");
}

// Single quotes can't be escaped inside single quotes, so close, add one, reopen.
function shellQuote(value) {
  return String(value ?? "").replace(/'/g, `'\\''`);
}

// Reads the response body. DevTools hands it over asynchronously, so we cache it.
// DevTools never calls back for some bodies — a no-store response the page
// itself never read is one. The finder asks for 25 at a time, so a single one
// of those used to stall the whole search.
const BODY_WAIT = 5000;

export function getBody(req) {
  // Only a non-empty body is cached. DevTools can return nothing on the first
  // ask and the content a moment later, and caching "" made that permanent.
  if (req._body) return Promise.resolve(req._body);
  return new Promise((resolve) => {
    const giveUp = setTimeout(() => resolve(""), BODY_WAIT);
    try {
      req.entry.getContent((content) => {
        clearTimeout(giveUp);
        // Still cached if it turns up late, so a later look gets it for free.
        req._body = content || "";
        resolve(req._body);
      });
    } catch {
      clearTimeout(giveUp);
      resolve("");
    }
  });
}

export function prettyJson(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

export function highlightGraphQL(text) {
  return esc(text)
    .replace(/(&quot;[^&]*?&quot;)/g, '<span class="s">$1</span>')
    .replace(/\b(query|mutation|subscription|fragment|on|true|false|null)\b/g, '<span class="k">$1</span>')
    .replace(/(\$[A-Za-z_][A-Za-z0-9_]*)/g, '<span class="nu">$1</span>');
}

export function highlightJson(text) {
  return esc(text)
    .replace(/&quot;([^&]*?)&quot;:/g, '<span class="k">"$1"</span>:')
    .replace(/: &quot;([^&]*?)&quot;/g, ': <span class="s">"$1"</span>')
    .replace(/: (-?\d+\.?\d*)/g, ': <span class="nu">$1</span>')
    .replace(/: (true|false|null)/g, ': <span class="bo">$1</span>');
}
