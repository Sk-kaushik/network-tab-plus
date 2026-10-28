// Everything that gets remembered between sessions: hide rules, saved filters, preferences.

export const ALL_COLUMNS = [
  { key: "name",      label: "Name",      locked: true },
  { key: "method",    label: "Method" },
  { key: "status",    label: "Status" },
  { key: "type",      label: "Type" },
  { key: "size",      label: "Size" },
  { key: "time",      label: "Time" },
  { key: "host",      label: "Domain" },
  { key: "operation", label: "GraphQL operation" },
  { key: "path",      label: "Path" },
  { key: "url",       label: "Full URL" },
  { key: "initiator", label: "Initiator" },
  { key: "proto",     label: "Protocol" },
  { key: "started",   label: "Started" },
  { key: "priority",  label: "Priority" },
];

export const DEFAULT_COLUMNS = ["name", "method", "status", "type", "size", "time", "host"];

const DEFAULT_PREFS = {
  preserveLog: false,
  columns: DEFAULT_COLUMNS.slice(),
  paneWidth: 400,
  rows: { method: false, status: false, type: true },  // which filter rows are on show
  opts: { hideData: false, thirdParty: false },
};

export const store = {
  rules: [],    // { id, kind: "path" | "domain", value, scope: "site" | "global", site }
  filters: [],  // { id, name, query, methods, statuses, types }
  prefs: { ...DEFAULT_PREFS },

  async load() {
    const data = await chrome.storage.local.get(["rules", "filters", "prefs"]);
    this.rules = data.rules || [];
    this.filters = data.filters || [];
    const saved = data.prefs || {};
    this.prefs = {
      ...DEFAULT_PREFS, ...saved,
      rows: { ...DEFAULT_PREFS.rows, ...(saved.rows || {}) },
      opts: { ...DEFAULT_PREFS.opts, ...(saved.opts || {}) },
    };
  },

  saveRules()   { return chrome.storage.local.set({ rules: this.rules }); },
  saveFilters() { return chrome.storage.local.set({ filters: this.filters }); },
  savePrefs()   { return chrome.storage.local.set({ prefs: this.prefs }); },

  addRule(kind, value, isGlobal, site) {
    const scope = isGlobal ? "global" : "site";
    const already = this.rules.some(
      (r) => r.kind === kind && r.value === value && r.scope === scope && (isGlobal || r.site === site)
    );
    if (already) return false;
    this.rules.push({ id: newId(), kind, value, scope, site: isGlobal ? null : site });
    this.saveRules();
    return true;
  },

  removeRule(id) {
    this.rules = this.rules.filter((r) => r.id !== id);
    this.saveRules();
  },

  clearRules() {
    this.rules = [];
    this.saveRules();
  },

  addFilter(name, state) {
    const filter = { id: newId(), name, ...state };
    this.filters.push(filter);
    this.saveFilters();
    return filter;
  },

  removeFilter(id) {
    this.filters = this.filters.filter((f) => f.id !== id);
    this.saveFilters();
  },

  updateFilter(id, changes) {
    const filter = this.filters.find((f) => f.id === id);
    if (!filter) return;
    Object.assign(filter, changes);
    this.saveFilters();
  },

  setPref(key, value) {
    this.prefs[key] = value;
    this.savePrefs();
  },
};

// A rule applies when it is global, or when it belongs to the site we are on.
export function ruleApplies(rule, site) {
  return rule.scope === "global" || rule.site === site;
}

export function ruleMatches(rule, req) {
  return rule.kind === "domain" ? req.host === rule.value : req.path === rule.value;
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
