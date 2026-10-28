// The right-hand pane: Headers, Payload and Response for the selected request.

import { esc, statusKind, formatTime, getBody, prettyJson, highlightJson, highlightGraphQL } from "./request.js";
import { readGraphQL, formatQuery } from "./graphql.js";

const COPY_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6"/><path d="M10.5 3.2A1.7 1.7 0 0 0 8.9 2H4a2 2 0 0 0-2 2v4.9c0 .8.5 1.4 1.2 1.6"/></svg>';
const TICK_ICON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.4 6.2 11.6 13 4.8"/></svg>';

// Bumped on every render, so a response body that arrives late knows it is stale.
let renderToken = 0;

export function renderDetail(el, req, tab) {
  renderToken++;
  if (!req) {
    el.innerHTML = emptyState("Select a request to inspect it");
    return;
  }
  if (tab === "headers") el.innerHTML = headersView(req);
  else if (tab === "payload") el.innerHTML = payloadView(req);
  else renderResponse(el, req);
}

function headersView(req) {
  const res = req.entry.response || {};
  return (
    section("General", keyValues([
      ["Request URL", req.url],
      ["Request Method", req.method],
      ["Status Code", `<span class="st ${statusKind(req.status)}"><i></i>${req.status || "(pending)"}</span>`, true],
      ["Remote Address", req.entry.serverIPAddress || "—"],
      ["Protocol", req.proto || "—"],
      ["Time", formatTime(req.time)],
    ])) +
    section("Response Headers", headerList(res.headers)) +
    section("Request Headers", headerList(req.entry.request.headers))
  );
}

function payloadView(req) {
  const operations = readGraphQL(req);
  if (operations) return graphqlView(operations);

  const query = req.entry.request.queryString || [];
  const post = req.entry.request.postData;
  let html = "";

  if (query.length) {
    html += section("Query String Parameters", keyValues(query.map((q) => [q.name, q.value])));
  }
  if (post?.text) {
    const body = post.mimeType?.includes("json") ? prettyJson(post.text) : post.text;
    html += copyableSection("Request Payload", body);
  }
  return html || emptyState("This request has no payload");
}

// GraphQL requests get the document and the variables as separate, separately
// copyable blocks — which is how every GraphQL IDE wants them pasted.
function graphqlView(operations) {
  return operations.map((op, index) => {
    const label = operations.length > 1 ? `${index + 1}. ` : "";
    const title = `${label}${op.kind}${op.name ? " " + op.name : ""}`;

    if (!op.query && op.persistedHash) {
      return section(title, `<div class="gq-note">
        Persisted query — the client sent only a hash, so the document isn't in this request.
        <div class="gq-hash">${esc(op.persistedHash)}</div>
      </div>`);
    }
    return copyableSection(title, formatQuery(op.query), "graphql") +
      (op.variables != null ? copyableSection("Variables", JSON.stringify(op.variables, null, 2)) : "");
  }).join("");
}

function renderResponse(el, req) {
  el.innerHTML = `<div class="empty">Loading response…</div>`;
  const token = renderToken;
  getBody(req).then((body) => {
    if (token !== renderToken) return;   // another request or tab took over
    if (!body) {
      el.innerHTML = emptyState("This request has no response body");
      return;
    }
    const mime = req.entry.response?.content?.mimeType || "";
    el.innerHTML = copyableSection("Response", mime.includes("json") ? prettyJson(body) : body);
  });
}

function section(title, inner) {
  return `<div class="sec"><div class="sh"><h4>${esc(title)}</h4></div><div class="card">${inner}</div></div>`;
}

function copyableSection(title, text, lang) {
  const body = lang === "graphql" ? highlightGraphQL(text) : highlightJson(text);
  return `
    <div class="sec">
      <div class="sh">
        <h4>${esc(title)}</h4>
        <button class="cp" data-copy>${COPY_ICON} Copy</button>
      </div>
      <div class="card"><pre>${body}</pre></div>
    </div>`;
}

function keyValues(pairs) {
  return `<dl class="kv">${pairs
    .map(([k, v, raw]) => `<dt>${esc(k)}</dt><dd>${raw ? v : esc(v)}</dd>`)
    .join("")}</dl>`;
}

function headerList(headers) {
  if (!headers?.length) return `<dl class="kv"><dt>—</dt><dd>none</dd></dl>`;
  return keyValues(headers.filter((h) => !h.name.startsWith(":")).map((h) => [h.name, h.value]));
}

function emptyState(message) {
  return `<div class="empty">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 12h4l2.5-6 4 13 2.5-7h5"/></svg>
    <div>${esc(message)}</div>
  </div>`;
}

// Wires the Copy buttons once; they live inside re-rendered HTML so we listen on the container.
export function wireCopyButtons(el, copyText) {
  el.addEventListener("click", (event) => {
    const button = event.target.closest("[data-copy]");
    if (!button) return;
    copyText(button.closest(".sec").querySelector("pre").textContent);
    button.classList.add("done");
    button.innerHTML = TICK_ICON + " Copied";
    setTimeout(() => {
      button.classList.remove("done");
      button.innerHTML = COPY_ICON + " Copy";
    }, 1400);
  });
}
