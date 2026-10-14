// Network Tab+ panel: captures requests from DevTools, filters them, and keeps hide rules.

import { store, ALL_COLUMNS, DEFAULT_COLUMNS, ruleApplies, ruleMatches } from "./store.js";
import { normalize, esc, formatBytes, formatTime, statusKind, toCurl, getBody, prettyJson } from "./request.js";
import { renderDetail, wireCopyButtons } from "./detail.js";
import { isGraphQL, copyableQuery, copyableVariables } from "./graphql.js";

const MAX_REQUESTS = 5000;   // oldest rows drop off beyond this, to keep memory sane
const RENDER_DELAY = 100;    // ms to batch bursts of requests into one table update

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const STATUSES = ["2xx", "3xx", "4xx", "5xx"];

// Same set and order as Chrome's own Network tab.
const TYPE_GROUPS = [
  { id: "xhr",      label: "Fetch/XHR", types: ["xhr", "fetch"] },
  { id: "doc",      label: "Doc",       types: ["document"] },
  { id: "css",      label: "CSS",       types: ["stylesheet"] },
  { id: "js",       label: "JS",        types: ["script"] },
  { id: "font",     label: "Font",      types: ["font"] },
  { id: "img",      label: "Img",       types: ["image"] },
  { id: "media",    label: "Media",     types: ["media"] },
  { id: "manifest", label: "Manifest",  types: ["manifest"] },
  { id: "socket",   label: "Socket",    types: ["websocket"] },
  { id: "wasm",     label: "Wasm",      types: ["wasm"] },
  { id: "other",    label: "Other",     types: [] },   // catch-all for everything above
];

const typeGroupOf = (type) =>
  TYPE_GROUPS.find((group) => group.types.includes(type))?.id || "other";

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------ state */

let requests = [];
let nextId = 1;
let site = "";                       // origin of the inspected page
let selectedId = null;
let detailTab = "headers";
let paused = false;
let renderTimer = null;
let hiddenNow = 0;
let menuRequest = null;              // request the context menu was opened on
let tableReady = false;              // Tabulator builds asynchronously; nothing may touch it before this
const sessionHidden = new Set();     // "this request only" hides, forgotten on clear

const filterState = { query: "", methods: [], statuses: [], types: [] };
let activeViewId = null;

let table = null;

/* ------------------------------------------------------------------ table */

const COLUMN_DEFS = {
  name:      { title: "Name", field: "name", minWidth: 170, widthGrow: 3, formatter: (c) => esc(c.getValue()) },
  method:    { title: "Method", field: "method", width: 96, minWidth: 92,
               formatter: (c) => `<span class="m ${esc(c.getValue())}">${esc(c.getValue())}</span>` },
  status:    { title: "Status", field: "status", width: 92, minWidth: 86,
               formatter: (c) => {
                 const value = c.getValue();
                 return `<span class="st ${statusKind(value)}"><i></i>${value || "—"}</span>`;
               } },
  type:      { title: "Type", field: "type", width: 96, minWidth: 84, cssClass: "cell-mono", formatter: (c) => esc(c.getValue()) },
  size:      { title: "Size", field: "sizeBytes", width: 88, minWidth: 78, hozAlign: "right", headerHozAlign: "right",
               cssClass: "cell-num", formatter: (c) => esc(c.getData().size) },
  time:      { title: "Time", field: "time", width: 86, minWidth: 76, hozAlign: "right", headerHozAlign: "right",
               cssClass: "cell-num", formatter: (c) => esc(formatTime(c.getValue())) },
  host:      { title: "Domain", field: "host", minWidth: 150, widthGrow: 1, cssClass: "cell-mono", formatter: (c) => esc(c.getValue()) },
  operation: { title: "GraphQL operation", field: "operation", width: 170, minWidth: 130, cssClass: "cell-mono", formatter: (c) => esc(c.getValue()) },
  path:      { title: "Path", field: "path", minWidth: 150, widthGrow: 2, cssClass: "cell-mono", formatter: (c) => esc(c.getValue()) },
  url:       { title: "Full URL", field: "url", minWidth: 200, widthGrow: 3, cssClass: "cell-mono", formatter: (c) => esc(c.getValue()) },
  initiator: { title: "Initiator", field: "initiator", width: 170, minWidth: 130, cssClass: "cell-mono", formatter: (c) => esc(c.getValue()) },
  proto:     { title: "Protocol", field: "proto", width: 86, minWidth: 76, cssClass: "cell-mono", formatter: (c) => esc(c.getValue()) },
  started:   { title: "Started", field: "started", width: 100, minWidth: 88, hozAlign: "right", headerHozAlign: "right",
               cssClass: "cell-num", formatter: (c) => esc(clockTime(c.getValue())) },
  priority:  { title: "Priority", field: "priority", width: 92, minWidth: 82, cssClass: "cell-mono", formatter: (c) => esc(c.getValue()) },
};

function clockTime(iso) {
  const date = new Date(iso);
  return isNaN(date) ? "" : date.toTimeString().slice(0, 8);
}

function buildTable() {
  table = new Tabulator($("table"), {
    data: [],
    index: "id",
    columns: ALL_COLUMNS.map((col) => COLUMN_DEFS[col.key]),
    layout: "fitColumns",
    height: "100%",
    rowHeight: 24,
    renderVertical: "virtual",
    selectableRows: 1,
    movableColumns: true,
    placeholder: "No requests yet — reload the page or interact with it.",
    columnDefaults: { resizable: true, headerSortTristate: true },
  });

  table.on("tableBuilt", () => {
    tableReady = true;
    applyColumnVisibility();
    // Our own column menu on the header, instead of Tabulator's.
    const header = $("table").querySelector(".tabulator-header");
    header?.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      closeMenus();
      openMenu($("headMenu"), event.clientX, event.clientY);
    });
    render();
  });

  table.on("rowClick", (_event, row) => selectRequest(row.getData().id));
  table.on("rowContext", (event, row) => {
    event.preventDefault();
    closeMenus();
    openRowMenu(event, row.getData());
  });
}

function applyColumnVisibility() {
  for (const col of ALL_COLUMNS) {
    const field = fieldOf(col.key);
    if (store.prefs.columns.includes(col.key)) table.showColumn(field);
    else table.hideColumn(field);
  }
}

function fieldOf(key) {
  return COLUMN_DEFS[key].field;
}

/* -------------------------------------------------------------- filtering */

function parseQuery(text) {
  const include = [], exclude = [], regexes = [];
  for (const term of text.trim().split(/\s+/).filter(Boolean)) {
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

function passesQuery(req, parsed) {
  const url = req.url.toLowerCase();
  if (parsed.exclude.some((term) => url.includes(term))) return false;
  if (!parsed.include.every((term) => url.includes(term))) return false;
  return parsed.regexes.every((re) => re.test(req.url));
}

function passesFilters(req, parsed) {
  if (!passesQuery(req, parsed)) return false;
  if (filterState.methods.length && !filterState.methods.includes(req.method)) return false;
  if (filterState.statuses.length) {
    const bucket = req.status ? Math.floor(req.status / 100) + "xx" : "";
    if (!filterState.statuses.includes(bucket)) return false;
  }
  if (filterState.types.length && !filterState.types.includes(typeGroupOf(req.type))) return false;
  if (store.prefs.opts.hideData && req.url.startsWith("data:")) return false;
  if (store.prefs.opts.thirdParty && site && req.host === hostOf(site)) return false;
  return true;
}

function isHidden(req) {
  if (sessionHidden.has(req.id)) return true;
  return store.rules.some((rule) => ruleApplies(rule, site) && ruleMatches(rule, req));
}

/* ----------------------------------------------------------------- render */

function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    render();
  }, RENDER_DELAY);
}

function render() {
  if (!tableReady) return;
  const parsed = parseQuery(filterState.query);
  const rows = [];
  let hidden = 0;
  let bytes = 0;

  for (const req of requests) {
    if (isHidden(req)) { hidden++; continue; }
    if (!passesFilters(req, parsed)) continue;
    rows.push(req);
    bytes += req.sizeBytes;
  }
  hiddenNow = hidden;

  table.replaceData(rows).then(() => {
    if (selectedId !== null) table.selectRow(selectedId);
  });

  $("statCount").textContent = rows.length;
  $("statBytes").textContent = formatBytes(bytes);

  const ruleCount = store.rules.filter((r) => ruleApplies(r, site)).length;
  const statHidden = $("statHidden");
  statHidden.hidden = hidden === 0;
  statHidden.textContent = `${hidden} hidden by ${ruleCount} rule${ruleCount === 1 ? "" : "s"}`;
  $("hiddenCount").textContent = hidden;
}

/* ---------------------------------------------------------------- capture */

function startCapture() {
  chrome.devtools.network.onRequestFinished.addListener((entry) => {
    if (paused) return;
    requests.push(normalize(entry, nextId++));
    if (requests.length > MAX_REQUESTS) requests.shift();
    scheduleRender();
  });

  chrome.devtools.network.onNavigated.addListener(() => {
    readSite();
    if (!store.prefs.preserveLog) clearAll();
  });
}

function clearAll() {
  requests = [];
  sessionHidden.clear();
  selectedId = null;
  closeDetail();
  render();
}

function readSite() {
  chrome.devtools.inspectedWindow.eval("location.origin", (result, error) => {
    if (!error && typeof result === "string") {
      site = result;
      renderRules();
      render();
    }
  });
}

/* ----------------------------------------------------------- detail pane */

function selectRequest(id) {
  selectedId = id;
  $("detail").hidden = false;
  renderCurrentDetail();
  table.selectRow(id);
}

function renderCurrentDetail() {
  renderDetail($("detailBody"), requests.find((r) => r.id === selectedId), detailTab);
}

const EXPAND_ICON = '<path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9"/>';
const COLLAPSE_ICON = '<path d="M13 3 9.5 6.5m0 0v-3.5m0 3.5H13M3 13l3.5-3.5m0 0v3.5m0-3.5H3"/>';

// The pane's width lives in an inline style (the drag handle writes it), which would
// otherwise beat the stylesheet's full-width rule — so expanding has to set it too.
function setExpanded(expanded) {
  $("split").classList.toggle("full", expanded);
  $("detail").style.flexBasis = expanded ? "100%" : store.prefs.paneWidth + "px";
  $("expLabel").textContent = expanded ? "Collapse" : "Expand";
  $("expIcon").innerHTML = expanded ? COLLAPSE_ICON : EXPAND_ICON;
  store.setPref("expanded", expanded);
  if (tableReady) table.redraw(true);
}

function closeDetail() {
  $("detail").hidden = true;
  setExpanded(false);
  selectedId = null;
  if (table) table.deselectRow();
}

/* ----------------------------------------------------------------- menus */

function openMenu(menu, x, y) {
  menu.classList.add("open");
  menu.style.left = Math.max(6, Math.min(x, window.innerWidth - menu.offsetWidth - 8)) + "px";
  menu.style.top = Math.max(6, Math.min(y, window.innerHeight - menu.offsetHeight - 8)) + "px";
}

// Hangs the popover under its button, nudged back inside the panel if it would
// overflow — the toolbar wraps, so the button can sit anywhere.
function togglePop(event, button, pop) {
  event.stopPropagation();
  const wasOpen = pop.classList.contains("open");
  closeMenus();
  if (wasOpen) return;

  pop.classList.add("open");
  const box = button.getBoundingClientRect();
  const left = Math.min(box.right - pop.offsetWidth, window.innerWidth - pop.offsetWidth - 6);
  pop.style.left = Math.max(6, left) + "px";
  pop.style.top = Math.min(box.bottom + 4, window.innerHeight - pop.offsetHeight - 6) + "px";
}

function closeMenus() {
  $("rowMenu").classList.remove("open");
  $("headMenu").classList.remove("open");
  $("colsMenu").classList.remove("open");
  $("morePop").classList.remove("open");
}

function openRowMenu(event, req) {
  menuRequest = req;
  const method = $("ctxMethod");
  method.textContent = req.method;
  method.className = "m " + req.method;
  $("ctxUrl").textContent = req.host + req.path;
  $("ctxPath").textContent = req.path;
  $("ctxHost").textContent = req.host;

  // The two GraphQL entries only exist for GraphQL requests, so the menu stays
  // exactly as short as it is today for everything else.
  const graphql = isGraphQL(req);
  document.querySelectorAll(".gql-only").forEach((item) => { item.hidden = !graphql; });

  openMenu($("rowMenu"), event.clientX, event.clientY);
}

function runMenuAction(action) {
  const req = menuRequest;
  if (!req) return;
  const isGlobal = $("ctxGlobal").checked;

  switch (action) {
    case "hide-once":
      sessionHidden.add(req.id);
      if (selectedId === req.id) closeDetail();
      break;
    case "hide-path":
      store.addRule("path", req.path, isGlobal, site);
      renderRules();
      break;
    case "hide-domain":
      store.addRule("domain", req.host, isGlobal, site);
      renderRules();
      break;
    case "copy-url":
      copyText(req.url);
      break;
    case "copy-curl":
      copyText(toCurl(req));
      break;
    case "copy-payload": {
      const body = req.entry.request.postData?.text;
      copyText(body ? prettyJson(body) : "");
      break;
    }
    case "copy-response":
      getBody(req).then((body) => copyText(body ? prettyJson(body) : ""));
      break;
    case "copy-query":
      copyText(copyableQuery(req));
      break;
    case "copy-variables":
      copyText(copyableVariables(req));
      break;
    case "filter-domain":
      setQuery(req.host);
      break;
  }
  render();
}

/* ------------------------------------------------------------ hide rules */

function renderRules() {
  const list = $("rulesList");
  const mine = store.rules.filter((r) => r.scope === "site" && r.site === site);
  const global = store.rules.filter((r) => r.scope === "global");

  let html = "";
  if (!mine.length && !global.length) {
    html = `<div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 12s4-7 9-7 9 7 9 7-4 7-9 7-9-7-9-7Z"/></svg>
      <div>Nothing hidden yet.<br />Right-click a request to hide it.</div>
    </div>`;
  } else {
    if (mine.length) html += `<div class="gl">This site · ${esc(hostOf(site))}</div>` + mine.map(ruleRow).join("");
    if (global.length) html += `<div class="gl">Everywhere</div>` + global.map(ruleRow).join("");
  }
  list.innerHTML = html;

  const applicable = store.rules.filter((r) => ruleApplies(r, site)).length;
  $("rulesFoot").textContent =
    `${applicable} rule${applicable === 1 ? " applies" : "s apply"} here · ` +
    `${hiddenNow} request${hiddenNow === 1 ? "" : "s"} hidden right now`;
}

function ruleRow(rule) {
  const count = requests.filter((r) => ruleMatches(rule, r)).length;
  const kind = rule.kind === "domain" ? "domain" : "path";
  return `
    <div class="rule">
      <div class="main">
        <div class="pat">${esc(rule.value)}</div>
        <div class="meta">${kind} · hid ${count} request${count === 1 ? "" : "s"} this session</div>
      </div>
      <span class="bdg ${rule.scope === "global" ? "g" : ""}">${rule.scope === "global" ? "global" : "site"}</span>
      <button class="unh" data-rule="${rule.id}">Un-hide</button>
    </div>`;
}

function hostOf(origin) {
  try { return new URL(origin).host; } catch { return origin || "this site"; }
}

/* --------------------------------------------------------- filter chips */

function buildChips() {
  // "All" is a reset, like Chrome's: on when no specific type is picked.
  $("typeChips").innerHTML =
    `<button class="chip" data-type="all">All</button><div class="vdiv"></div>` +
    TYPE_GROUPS.map((g) => `<button class="chip" data-type="${g.id}">${g.label}</button>`).join("");
  $("methodChips").innerHTML = METHODS.map((m) => `<button class="chip" data-method="${m}">${m}</button>`).join("");
  $("statusChips").innerHTML = STATUSES.map((s) => `<button class="chip" data-status="${s}">${s}</button>`).join("");

  for (const row of [$("typeRow"), $("extraRow")]) {
    row.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-method],[data-status],[data-type]");
      if (!chip) return;

      if (chip.dataset.type === "all") {
        filterState.types = [];
      } else {
        const [key, value] =
          chip.dataset.method ? ["methods", chip.dataset.method] :
          chip.dataset.status ? ["statuses", chip.dataset.status] :
          ["types", chip.dataset.type];
        toggleIn(filterState[key], value);
      }
      syncChips();
      refreshViews();   // keeps the active filter selected, just marks it edited
      render();
    });
  }
}

function toggleIn(list, value) {
  const index = list.indexOf(value);
  if (index === -1) list.push(value);
  else list.splice(index, 1);
}

function syncChips() {
  document.querySelectorAll("[data-method]").forEach((el) => el.classList.toggle("on", filterState.methods.includes(el.dataset.method)));
  document.querySelectorAll("[data-status]").forEach((el) => el.classList.toggle("on", filterState.statuses.includes(el.dataset.status)));
  document.querySelectorAll("[data-type]").forEach((el) =>
    el.classList.toggle("on", el.dataset.type === "all" ? filterState.types.length === 0 : filterState.types.includes(el.dataset.type))
  );
  syncFilterCounts();
}

// Counts next to each row name in More filters, so a hidden row that is still
// filtering doesn't go unnoticed.
function syncFilterCounts() {
  const label = (n) => (n ? `${n} on` : "");
  $("cntMethod").textContent = label(filterState.methods.length);
  $("cntStatus").textContent = label(filterState.statuses.length);
  $("cntType").textContent = label(filterState.types.length);
}

// More filters decides which of the three chip rows are on screen.
function applyRowVisibility() {
  const { method, status, type } = store.prefs.rows;
  $("methodLabel").hidden = !method;
  $("methodChips").hidden = !method;
  $("statusLabel").hidden = !status;
  $("statusChips").hidden = !status;
  $("chipDivider").hidden = !(method && status);
  $("extraRow").hidden = !(method || status);
  $("typeChips").style.display = type ? "" : "none";

  document.querySelectorAll("[data-row]").forEach((input) => {
    input.checked = store.prefs.rows[input.dataset.row];
  });
  document.querySelectorAll("[data-opt]").forEach((input) => {
    input.checked = store.prefs.opts[input.dataset.opt];
  });
  if (tableReady) table.redraw(true);
}

function setQuery(text) {
  filterState.query = text;
  $("query").value = text;
  $("query").closest(".find").classList.toggle("has", text.length > 0);
  refreshViews();
}

/* ---------------------------------------------------------- saved views */

// Current filter state, in the shape a saved filter stores.
function currentFilterState() {
  return {
    query: filterState.query,
    methods: filterState.methods.slice(),
    statuses: filterState.statuses.slice(),
    types: filterState.types.slice(),
  };
}

// True when the active view has been edited since it was applied.
function viewIsDirty() {
  const filter = store.filters.find((f) => f.id === activeViewId);
  if (!filter) return false;
  const now = currentFilterState();
  const same = (a, b) => a.length === b.length && a.every((v) => b.includes(v));
  return !(
    filter.query === now.query &&
    same(filter.methods, now.methods) &&
    same(filter.statuses, now.statuses) &&
    same(filter.types, now.types)
  );
}

let lastDirty = false;
let lastViewClick = { id: null, at: 0 };   // for detecting a double-click on a filter tab

// Only rebuilds the tabs when the edited/clean state actually flips, so typing
// in the filter box doesn't re-render on every keystroke.
function refreshViews() {
  if (viewIsDirty() !== lastDirty) renderViews();
}

function renderViews() {
  const dirty = viewIsDirty();
  lastDirty = dirty;
  const tabs = [
    `<button class="view ${activeViewId === null ? "on" : ""}" data-view="all">All</button>`,
    ...store.filters.map((f) => `
      <button class="view ${activeViewId === f.id ? "on" : ""}" data-view="${f.id}"
              title="${esc(f.name)} — double-click to rename">
        <span class="label">${esc(f.name)}</span>${activeViewId === f.id && dirty ? '<span class="dot">•</span>' : ""}<span class="x" data-del="${f.id}">✕</span>
      </button>`),
    dirty
      ? `<button class="view save" data-view="update" title="Save changes to this filter">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.4 6.2 11.6 13 4.8"/></svg>
          Save
        </button>`
      : "",
    `<button class="view add" data-view="new" title="Save the current filter as a new one">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>
      ${store.filters.length ? "" : "Save this filter"}
    </button>`,
  ];
  $("views").innerHTML = tabs.filter(Boolean).join("");
}

function applyView(id) {
  const filter = store.filters.find((f) => f.id === id);
  if (!filter) return;
  activeViewId = id;
  filterState.methods = filter.methods.slice();
  filterState.statuses = filter.statuses.slice();
  filterState.types = filter.types.slice();
  filterState.query = filter.query;
  $("query").value = filter.query;
  $("query").closest(".find").classList.toggle("has", filter.query.length > 0);
  syncChips();
  renderViews();
  render();
}

function resetView() {
  activeViewId = null;
  filterState.methods = [];
  filterState.statuses = [];
  filterState.types = [];
  setQuery("");
  syncChips();
  renderViews();   // without this the old tab stays highlighted while the data changes
  render();
}

// Swaps a tab for a text box. Used for both "save as new" and "rename".
function inlineInput(target, initial, onCommit) {
  const input = document.createElement("input");
  input.className = "view-input";
  input.placeholder = "Name this filter…";
  input.value = initial;
  target.replaceWith(input);
  input.focus();
  input.select();

  // Enter removes the input, which fires blur — without this guard we would commit twice.
  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    const name = input.value.trim();
    if (save && name) onCommit(name);
    renderViews();
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") finish(true);
    if (event.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

function promptSaveView(button) {
  inlineInput(button, "", (name) => {
    activeViewId = store.addFilter(name, currentFilterState()).id;
  });
}

function promptRenameView(tab, id) {
  const filter = store.filters.find((f) => f.id === id);
  if (!filter) return;
  inlineInput(tab, filter.name, (name) => store.updateFilter(id, { name }));
}

function updateActiveView() {
  if (activeViewId === null) return;
  store.updateFilter(activeViewId, currentFilterState());
  renderViews();
  toast("Filter updated");
}

/* --------------------------------------------------------- column picker */

function renderColumnLists() {
  const html = ALL_COLUMNS.map((col) => `
    <label class="col-row ${col.locked ? "lock" : ""}">
      <input type="checkbox" data-col="${col.key}" ${store.prefs.columns.includes(col.key) ? "checked" : ""} ${col.locked ? "disabled" : ""} />
      <span class="nm">${col.label}</span>${col.locked ? '<span class="hint">always on</span>' : ""}
    </label>`).join("");
  $("colList").innerHTML = html;
  $("headColList").innerHTML = html;
}

function toggleColumn(key, show) {
  const columns = store.prefs.columns.filter((k) => k !== key);
  if (show) columns.push(key);
  store.setPref("columns", ALL_COLUMNS.filter((c) => columns.includes(c.key)).map((c) => c.key));
  applyColumnVisibility();
  renderColumnLists();
}

/* ----------------------------------------------------------------- misc */

function copyText(text) {
  if (!text) { toast("Nothing to copy"); return; }
  navigator.clipboard.writeText(text).then(() => toast("Copied"), () => fallbackCopy(text));
}

function fallbackCopy(text) {
  const area = document.createElement("textarea");
  area.value = text;
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
  toast("Copied");
}

let toastTimer = null;
function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1500);
}

function toggleDrawer(open) {
  $("drawer").classList.toggle("open", open);
  $("scrim").classList.toggle("open", open);
  $("hiddenBtn").classList.toggle("on", open);
  if (open) renderRules();
}

/* ------------------------------------------------------------------ wiring */

function wireToolbar() {
  $("recBtn").addEventListener("click", () => {
    paused = !paused;
    $("recBtn").classList.toggle("paused", paused);
    $("recBtn").title = paused ? "Resume recording" : "Pause recording";
  });

  $("clearBtn").addEventListener("click", clearAll);

  const preserve = $("preserveLog");
  preserve.checked = store.prefs.preserveLog;
  preserve.addEventListener("change", () => store.setPref("preserveLog", preserve.checked));

  const query = $("query");
  query.addEventListener("input", () => {
    setQuery(query.value);
    render();
  });
  $("queryClear").addEventListener("click", () => {
    setQuery("");
    render();
  });

  $("colsBtn").addEventListener("click", (event) => togglePop(event, $("colsBtn"), $("colsMenu")));
  $("moreBtn").addEventListener("click", (event) => togglePop(event, $("moreBtn"), $("morePop")));

  $("morePop").addEventListener("change", (event) => {
    const row = event.target.closest("[data-row]");
    if (row) {
      store.prefs.rows[row.dataset.row] = row.checked;
      store.savePrefs();
      applyRowVisibility();
      return;
    }
    const opt = event.target.closest("[data-opt]");
    if (opt) {
      store.prefs.opts[opt.dataset.opt] = opt.checked;
      store.savePrefs();
      render();
    }
  });
  $("colReset").addEventListener("click", () => {
    store.setPref("columns", DEFAULT_COLUMNS.slice());
    applyColumnVisibility();
    renderColumnLists();
  });

  $("hiddenBtn").addEventListener("click", () => toggleDrawer(!$("drawer").classList.contains("open")));
  $("closeDrawer").addEventListener("click", () => toggleDrawer(false));
  $("scrim").addEventListener("click", () => toggleDrawer(false));
  $("statHidden").addEventListener("click", () => toggleDrawer(true));
  $("unhideAll").addEventListener("click", () => {
    store.clearRules();
    sessionHidden.clear();
    render();
    renderRules();
  });

  $("rulesList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-rule]");
    if (!button) return;
    store.removeRule(button.dataset.rule);
    render();
    renderRules();
  });

  $("views").addEventListener("click", (event) => {
    const del = event.target.closest("[data-del]");
    if (del) {
      event.stopPropagation();
      store.removeFilter(del.dataset.del);
      if (activeViewId === del.dataset.del) resetView();
      else renderViews();
      return;
    }
    const tab = event.target.closest("[data-view]");
    if (!tab) return;
    const id = tab.dataset.view;

    if (id === "all") { resetView(); return; }
    if (id === "new") { promptSaveView(tab); return; }
    if (id === "update") { updateActiveView(); return; }

    // Rename on the second click of a double-click. We can't use the native
    // dblclick event: applying a filter re-renders these tabs, so the two clicks
    // land on different elements and the browser never pairs them.
    const now = Date.now();
    if (lastViewClick.id === id && now - lastViewClick.at < 450) {
      lastViewClick = { id: null, at: 0 };
      const live = $("views").querySelector(`[data-view="${CSS.escape(id)}"]`);
      if (live) promptRenameView(live, id);
      return;
    }
    lastViewClick = { id, at: now };
    applyView(id);
  });
}

function wireDetail() {
  document.querySelectorAll(".tb[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tb[data-tab]").forEach((b) => b.classList.remove("on"));
      button.classList.add("on");
      detailTab = button.dataset.tab;
      renderCurrentDetail();
    });
  });

  wireCopyButtons($("detailBody"), copyText);
  $("closeDetail").addEventListener("click", closeDetail);

  $("expBtn").addEventListener("click", () => setExpanded(!$("split").classList.contains("full")));

  const detail = $("detail");
  detail.style.flexBasis = store.prefs.paneWidth + "px";
  $("grip").addEventListener("mousedown", (event) => {
    event.preventDefault();
    document.body.classList.add("resizing");
    const split = $("split");

    const move = (moveEvent) => {
      const width = split.getBoundingClientRect().right - moveEvent.clientX;
      detail.style.flexBasis = Math.max(260, Math.min(width, split.clientWidth - 160)) + "px";
    };
    const up = () => {
      document.body.classList.remove("resizing");
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      store.setPref("paneWidth", parseInt(detail.style.flexBasis, 10));
      table.redraw(true);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });
}

function wireMenus() {
  $("rowMenu").addEventListener("click", (event) => {
    const item = event.target.closest("[data-act]");
    if (!item) return;
    runMenuAction(item.dataset.act);
    closeMenus();
  });

  document.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-col]");
    if (checkbox) toggleColumn(checkbox.dataset.col, checkbox.checked);
  });

  document.addEventListener("mousedown", (event) => {
    if (event.target.closest(".ctx") || event.target.closest(".wrap")) return;
    closeMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenus();
  });
}

/* ------------------------------------------------------------------- init */

async function init() {
  document.documentElement.dataset.theme =
    chrome.devtools.panels.themeName === "default" ? "light" : "dark";

  await store.load();

  buildTable();
  buildChips();
  renderColumnLists();
  renderViews();
  syncChips();
  applyRowVisibility();
  wireToolbar();
  wireDetail();
  wireMenus();

  readSite();
  startCapture();
  render();
  renderRules();
}

init();
