// GraphQL support: find the operations in a request and print them to spec.
// Formatting goes through the official parser, so any valid document comes out
// correctly — including ones a build step has minified onto a single line.

import { parse, print } from "./lib/graphql.mjs";

// Matches the operation keyword and name without needing the full parser.
const OP_RE = /\b(query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/;

export function nameFromQuery(query) {
  return typeof query === "string" ? (OP_RE.exec(query)?.[2] || "") : "";
}

function kindFromQuery(query) {
  if (typeof query !== "string") return "query";
  const match = OP_RE.exec(query);
  if (match) return match[1];
  return /^\s*mutation\b/.test(query) ? "mutation" : "query";
}

function makeOperation(query, variables, operationName, hash) {
  return {
    name: operationName || nameFromQuery(query),
    kind: kindFromQuery(query),
    query: typeof query === "string" ? query : "",
    variables: variables ?? null,
    persistedHash: hash || null,
  };
}

// Returns an array of operations, or null when this isn't a GraphQL request.
// Detection is by body shape rather than URL, so it works on any endpoint name.
export function readGraphQL(req) {
  if (req._gql !== undefined) return req._gql;

  const operations = [];
  const text = req.entry.request.postData?.text;
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = null; }
  }

  if (body && typeof body === "object") {
    for (const item of Array.isArray(body) ? body : [body]) {
      if (!item || typeof item !== "object") continue;
      const hash = item.extensions?.persistedQuery?.sha256Hash;
      if (typeof item.query !== "string" && !hash) continue;
      operations.push(makeOperation(item.query, item.variables, item.operationName, hash));
    }
  } else if (req.method === "GET" && req.url.includes("query=")) {
    const params = new URLSearchParams(req.url.split("?")[1] || "");
    const query = params.get("query");
    if (query && /^\s*(query|mutation|subscription|\{|fragment)/.test(query)) {
      let variables = null;
      try { variables = JSON.parse(params.get("variables") || "null"); } catch { /* leave null */ }
      operations.push(makeOperation(query, variables, params.get("operationName"), null));
    }
  }

  req._gql = operations.length ? operations : null;
  return req._gql;
}

export const isGraphQL = (req) => readGraphQL(req) !== null;

// Prints the document the way graphql-js does: two-space indent, one field per
// line. Falls back to the original text if it won't parse.
export function formatQuery(query) {
  if (!query) return "";
  try {
    return print(parse(query));
  } catch {
    return query;
  }
}

// Every operation's document, ready to paste into a GraphQL IDE.
export function copyableQuery(req) {
  const operations = readGraphQL(req);
  if (!operations) return "";
  return operations
    .map((op) => (op.query ? formatQuery(op.query) : `# persisted query, document not sent (${op.persistedHash})`))
    .join("\n\n");
}

export function copyableVariables(req) {
  const operations = readGraphQL(req);
  if (!operations) return "";
  const all = operations.map((op) => op.variables).filter((v) => v != null);
  if (!all.length) return "";
  return JSON.stringify(all.length === 1 ? all[0] : all, null, 2);
}
