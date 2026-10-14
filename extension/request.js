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

// Headers we leave out of the cURL command because curl sets them itself.
const SKIP_HEADERS = ["content-length", "host", "connection"];

export function toCurl(req) {
  const parts = [`curl '${shellQuote(req.url)}'`];
  if (req.method !== "GET") parts.push(`-X ${req.method}`);

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
export function getBody(req) {
  if (req._body !== undefined) return Promise.resolve(req._body);
  return new Promise((resolve) => {
    try {
      req.entry.getContent((content) => {
        req._body = content ?? "";
        resolve(req._body);
      });
    } catch {
      req._body = "";
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
