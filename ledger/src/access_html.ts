export const ACCESS_TESTER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Agentify · Access Tester</title>
<style>
  :root {
    --fg: #111;
    --muted: #888;
    --line: #e5e5e5;
    --hl: #f7f7f7;
    --accent: #0066ff;
    --bad: #c00;
    --good: #080;
  }
  * { box-sizing: border-box; }
  body {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--fg);
    margin: 0;
    padding: 2rem;
    max-width: 900px;
    margin-inline: auto;
    line-height: 1.4;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  h1 { margin: 0 0 0.5rem; font-weight: 500; letter-spacing: 0.02em; }
  h2 { margin: 2rem 0 0.5rem; font-weight: 500; font-size: 1.1rem; border-bottom: 1px solid var(--line); padding-bottom: 0.3rem; }
  .sub { color: var(--muted); font-size: 0.85rem; margin-bottom: 1.5rem; }
  .back { font-size: 0.85rem; margin-bottom: 1rem; display: inline-block; }

  form { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin: 0.5rem 0 1rem; }
  input, button {
    font-family: inherit; font-size: 0.9rem;
    padding: 0.45rem 0.7rem; border: 1px solid var(--line); background: #fff; color: var(--fg);
  }
  input { min-width: 12rem; }
  input[type=number] { min-width: 9rem; }
  button { cursor: pointer; border-color: var(--fg); }
  button:hover { background: var(--fg); color: #fff; }
  button.ghost { border-color: var(--line); color: var(--muted); font-size: 0.8rem; padding: 0.3rem 0.6rem; }
  button.ghost:hover { background: var(--hl); color: var(--fg); }

  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-weight: 500; color: var(--muted); }
  td.num { font-variant-numeric: tabular-nums; text-align: right; }
  td.muted { color: var(--muted); }

  .pill { display: inline-block; padding: 0.1rem 0.5rem; border: 1px solid var(--line); border-radius: 2px; font-size: 0.7rem; }
  .pill.new { color: var(--good); border-color: var(--good); }
  .pill.hit { color: var(--accent); border-color: var(--accent); }
  .pill.miss { color: var(--bad); border-color: var(--bad); }
  .pos { color: var(--good); }
  .neg { color: var(--bad); }

  .hidden { display: none !important; }
  #result { margin: 0.5rem 0 1.5rem; padding: 1rem 1.2rem; border-left: 3px solid var(--accent); background: var(--hl); font-size: 0.95rem; line-height: 1.7; }
  #result.error { border-color: var(--bad); color: var(--bad); }
  #result .row { display: flex; gap: 0.8rem; align-items: baseline; }
  #result .label { color: var(--muted); min-width: 6rem; font-size: 0.85rem; }
  #result .val { font-size: 1rem; }
  #result .big { font-size: 1.4rem; font-variant-numeric: tabular-nums; }

  .toolbar { display: flex; justify-content: space-between; align-items: center; margin-top: 2rem; }
  .toolbar h2 { margin: 0; border: none; padding: 0; }

  .toast { position: fixed; bottom: 1rem; right: 1rem; padding: 0.7rem 1rem; background: var(--fg); color: #fff; font-size: 0.85rem; opacity: 0; transition: opacity 0.2s; pointer-events: none; }
  .toast.show { opacity: 1; }
  .toast.bad { background: var(--bad); }
</style>
</head>
<body>
  <a href="/admin" class="back">← Back to admin</a>
  <h1>Access Tester</h1>
  <div class="sub">POST /ledger/access — agent access simulator. User is auto-created if user_name doesn't exist.</div>

  <form id="form">
    <input id="user_name" placeholder="user_name" required>
    <input id="accessed_url" placeholder="accessed_url" required>
    <input id="extraction_cost" type="number" min="0" placeholder="extraction_cost (optional)">
    <button type="submit">Send</button>
  </form>

  <div id="result" class="hidden"></div>

  <div class="toolbar">
    <h2>Recent requests (this browser)</h2>
    <button class="ghost" id="clear-history" type="button">clear</button>
  </div>
  <table>
    <thead><tr><th>When</th><th>User</th><th>URL</th><th class="num">Cost</th><th>Outcome</th></tr></thead>
    <tbody id="history-tbody"><tr><td colspan="5" class="muted">none yet</td></tr></tbody>
  </table>

  <div class="toast" id="toast"></div>

<script>
const $ = (id) => document.getElementById(id);
const HISTORY_KEY = "agentify_access_history";
const HISTORY_MAX = 50;
const fmtTime = (ms) => new Date(ms).toLocaleTimeString();
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function toast(msg, bad = false) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("bad", bad);
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2000);
}

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; }
}

function saveHistory(h) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, HISTORY_MAX)));
}

function renderHistory() {
  const h = loadHistory();
  const tbody = $("history-tbody");
  if (!h.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">none yet</td></tr>';
    return;
  }
  tbody.innerHTML = h.map(e => {
    let outcome;
    if (e.error) {
      outcome = '<span class="neg">' + escapeHtml(e.error) + '</span>';
    } else if (e.providing_user) {
      outcome = '<span class="pill hit">hit</span> '
        + '<span class="neg">−' + e.requesting_user.spent + '</span> · '
        + '<span class="pos">+' + e.providing_user.earned + '</span> to ' + escapeHtml(e.providing_user.name);
    } else {
      outcome = '<span class="pill miss">miss</span> '
        + '<span class="neg">−' + e.requesting_user.spent + '</span> · registered';
    }
    const userCell = escapeHtml(e.user_name) + (e.user_created ? ' <span class="pill new">new</span>' : '');
    return '<tr>'
      + '<td>' + fmtTime(e.t) + '</td>'
      + '<td>' + userCell + '</td>'
      + '<td>' + escapeHtml(e.accessed_url) + '</td>'
      + '<td class="num">' + (e.extraction_cost ?? '—') + '</td>'
      + '<td>' + outcome + '</td>'
      + '</tr>';
  }).join('');
}

function renderResult(req, data, isError) {
  const result = $("result");
  result.classList.remove("hidden", "error");
  if (isError) {
    result.classList.add("error");
    result.innerHTML = '<div class="row"><span class="label">error</span><span class="val">' + escapeHtml(data.error || "unknown") + '</span></div>'
      + (data.message ? '<div class="row"><span class="label"></span><span class="val sub">' + escapeHtml(data.message) + '</span></div>' : '')
      + (data.balance !== undefined ? '<div class="row"><span class="label">balance</span><span class="val big">' + data.balance + '</span></div>' : '');
    return;
  }
  const requesterLine = '<strong>' + escapeHtml(data.requesting_user.name) + '</strong>'
    + (data.user_created ? ' <span class="pill new">just created</span>' : '')
    + ' <span class="neg big">−' + data.requesting_user.spent + '</span>';
  const providerLine = data.providing_user
    ? '<strong>' + escapeHtml(data.providing_user.name) + '</strong> <span class="pos big">+' + data.providing_user.earned + '</span>'
    : '<span class="sub" style="color:var(--muted)">none — registered as contributor</span>';
  result.innerHTML =
    '<div class="row"><span class="label">requester</span><span class="val">' + requesterLine + '</span></div>'
    + '<div class="row"><span class="label">provider</span><span class="val">' + providerLine + '</span></div>';
}

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const user_name = $("user_name").value.trim();
  const accessed_url = $("accessed_url").value.trim();
  const costRaw = $("extraction_cost").value;
  const body = { user_name, accessed_url };
  if (costRaw !== "") body.extraction_cost = Number(costRaw);

  const entry = { t: Date.now(), user_name, accessed_url, extraction_cost: costRaw !== "" ? Number(costRaw) : null };
  try {
    const r = await fetch("/ledger/access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) {
      renderResult(body, data, true);
      entry.error = data.error || ("HTTP " + r.status);
    } else {
      renderResult(body, data, false);
      Object.assign(entry, data);
    }
  } catch (err) {
    renderResult(body, { error: err.message }, true);
    entry.error = err.message;
  }

  const h = loadHistory();
  h.unshift(entry);
  saveHistory(h);
  renderHistory();
});

$("clear-history").addEventListener("click", () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
  toast("history cleared");
});

renderHistory();
</script>
</body>
</html>`;
