// The ⌘F finder: searches requests by URL, headers, payload or response body.

import { getBody, parseQuery, queryMatches, queryExcludes, queryIncludes } from "./request.js";

export const SCOPES = [
  { id: "url", label: "URL" },
  { id: "headers", label: "Headers" },
  { id: "payload", label: "Payload" },
  { id: "response", label: "Response" },
];

const ALL = SCOPES.map((scope) => scope.id);

// quickMatch says "this one is out" with this, so no body gets fetched for it.
const EXCLUDED = "-";

// Binary bodies reach us base64-encoded, so searching them matches noise and
// caches megabytes we can never show.
const TEXT_TYPES = ["json", "text/", "javascript", "xml", "html", "graphql", "urlencoded", "csv"];

// Response bodies come from DevTools one round trip at a time, so they go in
// batches — small enough that the table fills in as the search runs.
const BATCH = 25;

export const find = {
  query: "",
  scopes: ["all"],
  field: "",
  matches: null,   // request id -> the scope it matched in; null when no find is on
  running: false,
};

export const findIsOn = () => find.matches !== null;

// "all" is held as its own value so the All button can show as selected.
export const chosenScopes = (scopes = find.scopes) => (scopes.includes("all") ? ALL : scopes);

/* ------------------------------------------------------------ the search */

let generation = 0;

// Leaves whatever has been found so far on screen.
export function stopFind() {
  generation++;
  find.running = false;
}

export function clearFind() {
  stopFind();
  find.matches = null;
}

// Fills find.matches as it goes, so rows can appear before the run finishes.
// onProgress gets { done, total, found }; total is 0 when no bodies are needed.
// Resolves true when this run saw itself through, false when it was stopped or
// a newer find took over — the caller can't tell from a shared flag.
export async function runFind(requests, onProgress) {
  const mine = ++generation;
  const parsed = parseQuery(find.query);
  const scopes = chosenScopes();
  const field = find.field.trim();

  const matches = new Map();
  find.matches = matches;
  find.running = true;

  // Everything but the response body is already in memory, so it is matched up
  // front; only what is left over has to be fetched.
  const needBody = [];
  for (const req of requests) {
    const where = quickMatch(req, parsed, scopes, field);
    if (where === EXCLUDED) continue;
    if (where) matches.set(req.id, where);
    else if (scopes.includes("response") && isTextBody(req)) needBody.push(req);
  }

  onProgress({ done: 0, total: needBody.length, found: matches.size });
  if (!needBody.length) {
    find.running = false;
    return true;
  }

  for (let at = 0; at < needBody.length; at += BATCH) {
    const batch = needBody.slice(at, at + BATCH);
    const bodies = await Promise.all(batch.map((req) => getBody(req)));
    if (mine !== generation) return false;   // stopped, or a newer find took over

    batch.forEach((req, index) => {
      if (responseMatches(bodies[index], parsed, field)) matches.set(req.id, "response");
    });
    onProgress({ done: Math.min(at + BATCH, needBody.length), total: needBody.length, found: matches.size });
  }
  find.running = false;
  return true;
}

/* ------------------------------------------------------- per-scope rules */

// Returns the scope it matched in, EXCLUDED when a -term rules it out, or "".
function quickMatch(req, parsed, scopes, field) {
  // A field asks about one key's value, so each value is judged on its own and
  // -term there means "that key does not hold this".
  if (field) {
    if (scopes.includes("url") && urlFieldMatches(req, parsed, field)) return "url";
    if (scopes.includes("headers") && headerFieldMatches(req, parsed, field)) return "headers";
    if (scopes.includes("payload") && jsonFieldMatches(req.entry.request.postData?.text, parsed, field)) return "payload";
    return "";
  }

  // Without a field an exclusion has to see every place at once. Judging each
  // place alone would keep a request whose URL has the term just because one
  // of its headers doesn't.
  const places = textPlaces(req, scopes);
  if (places.some(([, text]) => queryExcludes(text, parsed))) return EXCLUDED;
  return places.find(([, text]) => queryIncludes(text, parsed))?.[0] || "";
}

function textPlaces(req, scopes) {
  const places = [];
  if (scopes.includes("url")) places.push(["url", req.url]);
  // All headers as one block, so terms can sit in different headers.
  if (scopes.includes("headers")) {
    const headers = [...(req.entry.request.headers || []), ...(req.entry.response?.headers || [])];
    places.push(["headers", headers.map((h) => `${h.name}: ${h.value}`).join("\n")]);
  }
  if (scopes.includes("payload")) places.push(["payload", req.entry.request.postData?.text || ""]);
  return places;
}

function responseMatches(text, parsed, field) {
  if (!text) return false;
  if (field) return jsonFieldMatches(text, parsed, field);
  return !queryExcludes(text, parsed) && queryIncludes(text, parsed);
}

function isTextBody(req) {
  const mime = (req.entry.response?.content?.mimeType || "").toLowerCase();
  if (!mime) return true;   // unknown type: most of them are text
  return TEXT_TYPES.some((type) => mime.includes(type));
}

function urlFieldMatches(req, parsed, field) {
  return (req.entry.request.queryString || [])
    .some((param) => sameKey(param.name, field) && queryMatches(param.value, parsed));
}

function headerFieldMatches(req, parsed, field) {
  const headers = [...(req.entry.request.headers || []), ...(req.entry.response?.headers || [])];
  return headers.some((h) => sameKey(h.name, field) && queryMatches(h.value, parsed));
}

// A field only means something against structure, so a body that isn't JSON
// can't match one.
function jsonFieldMatches(text, parsed, field) {
  if (!text) return false;
  let data;
  try { data = JSON.parse(text); } catch { return false; }
  return hasFieldValue(data, parsed, field);
}

// Walks with its own stack rather than recursion: JSON.parse will happily
// accept a body nested deeper than the call stack can follow.
function hasFieldValue(root, parsed, field) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
      continue;
    }
    if (!node || typeof node !== "object") continue;

    for (const [key, value] of Object.entries(node)) {
      if (sameKey(key, field) && queryMatches(asText(value), parsed)) return true;
      stack.push(value);
    }
  }
  return false;
}

function asText(value) {
  return value && typeof value === "object" ? JSON.stringify(value) : String(value);
}

function sameKey(key, field) {
  return String(key).toLowerCase() === field.toLowerCase();
}
