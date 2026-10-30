// Captures server-sent event messages as they arrive.
//
// DevTools won't give them to us: getContent never calls back while a stream is
// open, and the HAR entry carries only a byte count. So we wrap fetch and
// EventSource in the page itself and keep a copy of what it receives.
//
// This is the one place the panel is not a passive observer. It replaces two
// page globals, so it only sees streams the page starts after that.

const MAX_TEXT = 512 * 1024;   // per stream, so a firehose can't fill the page's heap

// Runs in the page's own world. The page keeps the messages; the panel reads
// summaries, and the full text only for the row you are looking at.
const INJECT = `(() => {
  if (window.__ntPlusStream) return "already";

  const runs = [];   // { key, method, url, at, text, done }
  window.__ntPlusStream = {
    list: () => runs.map((r, i) => ({ i, key: r.key, at: r.at, done: r.done, size: r.text.length })),
    text: (i) => (runs[i] ? runs[i].text : ""),
  };

  const open = (url, method) => {
    const run = { key: method + " " + url, method, url, at: Date.now(), text: "", done: false };
    runs.push(run);
    return run;
  };

  // Reads our half of a tee'd body. The page reads the other half, which is
  // what keeps data flowing — if it abandons its half, ours simply stops.
  const follow = (body, run) => {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (run.text.length < ${MAX_TEXT}) run.text += decoder.decode(value, { stream: true });
        }
      } catch {}
      run.done = true;
    })();
  };

  const realFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await realFetch.apply(this, args);
    try {
      if (!res.body) return res;
      if (!(res.headers.get("content-type") || "").includes("text/event-stream")) return res;

      const raw = typeof args[0] === "string" ? args[0] : args[0].url;
      const method = ((args[1] && args[1].method) || (args[0] && args[0].method) || "GET").toUpperCase();
      const [mine, theirs] = res.body.tee();
      follow(mine, open(new URL(raw, location.href).href, method));
      return new Response(theirs, { status: res.status, statusText: res.statusText, headers: res.headers });
    } catch {
      return res;
    }
  };

  const RealES = window.EventSource;
  if (RealES) {
    const Wrapped = function (url, init) {
      const es = new RealES(url, init);
      const run = open(new URL(url, location.href).href, "GET");
      es.addEventListener("message", (e) => {
        if (run.text.length < ${MAX_TEXT}) run.text += "data: " + e.data + "\\n\\n";
      });
      es.addEventListener("error", () => { run.done = true; });
      return es;
    };
    Wrapped.prototype = RealES.prototype;
    Object.assign(Wrapped, RealES);
    window.EventSource = Wrapped;
  }

  return "installed";
})()`;

/* ----------------------------------------------------- the panel's copy */

// Mirrors the page's run list. Index into the page's array, so text can be
// fetched on demand for just the row being shown.
let runs = [];

export function armCapture(done) {
  chrome.devtools.inspectedWindow.eval(INJECT, (result, error) => {
    // about:blank and a page mid-navigation both refuse; a later arm gets it.
    if (done) done(result, error);
  });
}

// Cheap: sizes and timestamps only, never the message text.
export function pollStreams(onChange) {
  chrome.devtools.inspectedWindow.eval(
    "window.__ntPlusStream ? JSON.stringify(window.__ntPlusStream.list()) : null",
    (json) => {
      if (!json) return;
      let next;
      try { next = JSON.parse(json); } catch { return; }

      const changed = next.length !== runs.length ||
        next.some((run, i) => run.size !== runs[i]?.size || run.done !== runs[i]?.done);
      runs = next;
      if (changed && onChange) onChange();
    }
  );
}

export function hasStream(req) {
  return pickRun(req) !== null;
}

// Fetches the text for one row, which is the only place it is ever pulled.
export function readStream(req, show) {
  const run = pickRun(req);
  if (run === null) { show(""); return; }
  chrome.devtools.inspectedWindow.eval(
    `window.__ntPlusStream ? window.__ntPlusStream.text(${run.i}) : ""`,
    (text) => show(typeof text === "string" ? text : "")
  );
}

// Matched on method and url, then on whichever run started closest to the row —
// a page that polls one endpoint has several.
function pickRun(req) {
  const key = `${req.method} ${req.url}`;
  const mine = runs.filter((run) => run.key === key);
  if (!mine.length) return null;

  const started = Date.parse(req.started);
  if (isNaN(started)) return mine[mine.length - 1];

  let best = mine[0];
  for (const run of mine) {
    if (Math.abs(run.at - started) < Math.abs(best.at - started)) best = run;
  }
  return best;
}

export function clearStreams() {
  runs = [];
}
