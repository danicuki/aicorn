export const CONTRIBUTIONS_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Aicorn · Contributions</title>
<style>
  :root {
    --fg: #111;
    --muted: #888;
    --line: #e5e5e5;
    --hl: #f7f7f7;
    --accent: #0066ff;
  }
  * { box-sizing: border-box; }
  body {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: var(--fg);
    margin: 0;
    padding: 2rem;
    max-width: 1100px;
    margin-inline: auto;
    line-height: 1.4;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  h1 { margin: 0 0 0.5rem; font-weight: 500; letter-spacing: 0.02em; }
  .sub { color: var(--muted); font-size: 0.85rem; margin-bottom: 1.5rem; }
  .back { font-size: 0.85rem; margin-bottom: 1rem; display: inline-block; }

  form { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin: 0.5rem 0 1.5rem; }
  input, button {
    font-family: inherit; font-size: 0.9rem;
    padding: 0.45rem 0.7rem; border: 1px solid var(--line); background: #fff; color: var(--fg);
  }
  input { min-width: 14rem; }
  button { cursor: pointer; border-color: var(--fg); }
  button:hover { background: var(--fg); color: #fff; }
  button.ghost { border-color: var(--line); color: var(--muted); font-size: 0.8rem; padding: 0.35rem 0.6rem; }
  button.ghost:hover { background: var(--hl); color: var(--fg); }

  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { font-weight: 500; color: var(--muted); }
  td.num { font-variant-numeric: tabular-nums; text-align: right; }
  td.muted { color: var(--muted); }
  td.url { word-break: break-all; max-width: 28rem; }
  .meta { color: var(--muted); font-size: 0.8rem; margin: 0.5rem 0 1rem; }
</style>
</head>
<body>
  <a href="/admin" class="back">← Back to admin</a>
  <h1>Contributions</h1>
  <div class="sub">Browse and search the contributions table. Earned & hit counts grow as readers hit each URL; extraction_cost is the original price the contributor paid to extract.</div>

  <form id="filter-form">
    <input id="filter-user" placeholder="filter by user name (LIKE %…%)">
    <input id="filter-url" placeholder="filter by URL (LIKE %…%)">
    <button type="submit">Search</button>
    <button type="button" class="ghost" id="clear-btn">clear</button>
  </form>

  <div class="meta" id="result-meta"></div>
  <table>
    <thead><tr>
      <th>User</th>
      <th>URL</th>
      <th class="num">Earned</th>
      <th class="num">Hits</th>
      <th class="num">Extraction cost</th>
    </tr></thead>
    <tbody id="rows"><tr><td colspan="5" class="muted">loading…</td></tr></tbody>
  </table>

<script>
const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

async function loadContribs() {
  const userName = $("filter-user").value.trim();
  const urlFilter = $("filter-url").value.trim();
  const params = new URLSearchParams();
  if (userName) params.set("user_name", userName);
  if (urlFilter) params.set("url", urlFilter);

  // Sync filters to URL so refresh / sharing preserves the search.
  const newSearch = params.toString();
  history.replaceState(null, "", "/admin/contributions" + (newSearch ? "?" + newSearch : ""));

  $("rows").innerHTML = '<tr><td colspan="5" class="muted">loading…</td></tr>';

  try {
    const r = await fetch("/admin/contributions/list" + (newSearch ? "?" + newSearch : ""));
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || ("HTTP " + r.status));
    const list = data.contributions || [];

    $("result-meta").textContent = list.length === 0
      ? "no matches"
      : list.length + " row" + (list.length === 1 ? "" : "s") + " (capped at 200)";

    if (!list.length) {
      $("rows").innerHTML = '<tr><td colspan="5" class="muted">no matches</td></tr>';
      return;
    }

    $("rows").innerHTML = list.map(c => {
      const userLink = '<a href="/admin?user=' + encodeURIComponent(c.user_id) + '">'
        + escapeHtml(c.user_name || c.user_id) + '</a>';
      const cost = (c.extraction_cost === null || c.extraction_cost === undefined)
        ? '<span class="muted">—</span>'
        : c.extraction_cost;
      return '<tr>'
        + '<td>' + userLink + '</td>'
        + '<td class="url">' + escapeHtml(c.url) + '</td>'
        + '<td class="num">' + c.earned + '</td>'
        + '<td class="num">' + c.hit_count + '</td>'
        + '<td class="num">' + cost + '</td>'
        + '</tr>';
    }).join("");
  } catch (err) {
    $("rows").innerHTML = '<tr><td colspan="5" class="muted">error: ' + escapeHtml(err.message) + '</td></tr>';
  }
}

$("filter-form").addEventListener("submit", (e) => { e.preventDefault(); loadContribs(); });
$("clear-btn").addEventListener("click", () => {
  $("filter-user").value = ""; $("filter-url").value = ""; loadContribs();
});

// Hydrate from URL on initial load (so deep-linked filters work).
const initial = new URLSearchParams(location.search);
if (initial.get("user_name")) $("filter-user").value = initial.get("user_name");
if (initial.get("url")) $("filter-url").value = initial.get("url");
loadContribs();
</script>
</body>
</html>`;
