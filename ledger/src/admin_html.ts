export const ADMIN_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Agentify Ledger Admin</title>
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
    max-width: 1100px;
    margin-inline: auto;
    line-height: 1.4;
  }
  h1 { margin: 0 0 0.5rem; font-weight: 500; letter-spacing: 0.02em; }
  h2 { margin: 2rem 0 0.5rem; font-weight: 500; font-size: 1.1rem; border-bottom: 1px solid var(--line); padding-bottom: 0.3rem; }
  .sub { color: var(--muted); font-size: 0.85rem; margin-bottom: 1.5rem; }

  form { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; margin: 0.5rem 0 1rem; }
  input, button {
    font-family: inherit; font-size: 0.9rem;
    padding: 0.45rem 0.7rem; border: 1px solid var(--line); background: #fff; color: var(--fg);
  }
  input { min-width: 12rem; }
  input[type=number] { min-width: 7rem; }
  button { cursor: pointer; border-color: var(--fg); }
  button:hover { background: var(--fg); color: #fff; }
  button.back { margin-bottom: 1rem; }

  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--line); }
  th { font-weight: 500; color: var(--muted); }
  tr.clickable { cursor: pointer; }
  tr.clickable:hover { background: var(--hl); }
  td.num { font-variant-numeric: tabular-nums; text-align: right; }
  td.id { color: var(--muted); font-size: 0.8rem; }
  .pill { display: inline-block; padding: 0.1rem 0.5rem; border: 1px solid var(--line); border-radius: 2px; font-size: 0.75rem; }
  .pill.charge { color: var(--bad); border-color: var(--bad); }
  .pill.credit, .pill.signup { color: var(--good); border-color: var(--good); }
  .pill.admin_adjust { color: var(--accent); border-color: var(--accent); }

  .hidden { display: none !important; }
  .col2 { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; align-items: start; }
  @media (max-width: 800px) { .col2 { grid-template-columns: 1fr; } }
  .balance-big { font-size: 2.5rem; font-variant-numeric: tabular-nums; }

  .toast { position: fixed; bottom: 1rem; right: 1rem; padding: 0.7rem 1rem; background: var(--fg); color: #fff; font-size: 0.85rem; opacity: 0; transition: opacity 0.2s; pointer-events: none; }
  .toast.show { opacity: 1; }
  .toast.bad { background: var(--bad); }
</style>
</head>
<body>
  <h1>Agentify Ledger Admin</h1>
  <div class="sub">D1 · users / activity / contributions / stats</div>

  <div id="list-view">
    <h2>Create user</h2>
    <form id="create-form">
      <input id="create-id" placeholder="user_id (optional, auto if blank)">
      <input id="create-name" placeholder="display name (optional)">
      <button type="submit">Create + 100-credit grant</button>
    </form>

    <h2>Users</h2>
    <table>
      <thead><tr><th>ID</th><th>Name</th><th class="num">Balance</th><th>Created</th></tr></thead>
      <tbody id="users-tbody"><tr><td colspan="4" style="color:var(--muted)">loading…</td></tr></tbody>
    </table>
  </div>

  <div id="detail-view" class="hidden">
    <button class="back" id="back-btn" type="button">← Back to users</button>

    <h1 id="detail-title">User</h1>
    <div class="balance-big" id="detail-balance">—</div>
    <div class="sub" id="detail-id"></div>

    <div class="col2">
      <div>
        <h2>Edit</h2>
        <form id="edit-form">
          <input id="edit-name" placeholder="name">
          <input id="edit-balance" type="number" min="0" placeholder="balance">
          <button type="submit">Save</button>
        </form>

        <h2>Charge</h2>
        <form id="charge-form">
          <input id="charge-amount" type="number" min="0" placeholder="amount" required>
          <input id="charge-reason" placeholder="reason">
          <button type="submit">Charge</button>
        </form>

        <h2>Credit</h2>
        <form id="credit-form">
          <input id="credit-amount" type="number" min="0" placeholder="amount" required>
          <input id="credit-url" placeholder="url" required>
          <button type="submit">Credit</button>
        </form>

        <h2>Contributions</h2>
        <table>
          <thead><tr><th>URL</th><th class="num">Earned</th><th class="num">Hits</th></tr></thead>
          <tbody id="contrib-tbody"><tr><td colspan="3" style="color:var(--muted)">none</td></tr></tbody>
        </table>
      </div>

      <div>
        <h2>Activity (latest 200)</h2>
        <table>
          <thead><tr><th>When</th><th>Type</th><th class="num">Amount</th><th class="num">Balance</th><th>Detail</th></tr></thead>
          <tbody id="activity-tbody"><tr><td colspan="5" style="color:var(--muted)">none</td></tr></tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

<script>
const $ = (id) => document.getElementById(id);
const fmtTime = (ms) => new Date(ms).toLocaleString();
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let currentUserId = null;

function toast(msg, bad = false) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("bad", bad);
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2000);
}

async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ("HTTP " + r.status));
  return data;
}

function showList() {
  $("list-view").classList.remove("hidden");
  $("detail-view").classList.add("hidden");
  currentUserId = null;
  window.scrollTo(0, 0);
}

function showDetailContainer() {
  $("list-view").classList.add("hidden");
  $("detail-view").classList.remove("hidden");
  window.scrollTo(0, 0);
}

async function loadUsers() {
  const { users } = await api("GET", "/admin/users");
  const tbody = $("users-tbody");
  if (!users.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--muted)">no users yet</td></tr>';
    return;
  }
  tbody.innerHTML = users.map(u => \`
    <tr class="clickable" data-id="\${escapeHtml(u.id)}">
      <td class="id">\${escapeHtml(u.id)}</td>
      <td>\${escapeHtml(u.name || "—")}</td>
      <td class="num">\${u.balance}</td>
      <td>\${fmtTime(u.created_at)}</td>
    </tr>
  \`).join("");
  for (const tr of tbody.querySelectorAll("tr.clickable")) {
    tr.addEventListener("click", () => navigateToUser(tr.dataset.id));
  }
}

function navigateToUser(id) {
  history.pushState({ view: "user", id }, "", "/admin?user=" + encodeURIComponent(id));
  openUser(id);
}

async function openUser(id) {
  currentUserId = id;
  showDetailContainer();
  try {
    const { user, activity, contributions } = await api("GET", "/admin/users/" + encodeURIComponent(id));
    $("detail-title").textContent = user.name || user.id;
    $("detail-balance").textContent = user.balance;
    $("detail-id").textContent = user.id;
    $("edit-name").value = user.name || "";
    $("edit-balance").value = user.balance;

    $("activity-tbody").innerHTML = activity.length ? activity.map(a => \`
      <tr>
        <td>\${fmtTime(a.created_at)}</td>
        <td><span class="pill \${a.type}">\${a.type}</span></td>
        <td class="num">\${a.type === "charge" ? "−" : "+"}\${Math.abs(a.amount)}</td>
        <td class="num">\${a.balance_after}</td>
        <td>\${escapeHtml(a.reason || a.url || "")}</td>
      </tr>
    \`).join("") : '<tr><td colspan="5" style="color:var(--muted)">none</td></tr>';

    $("contrib-tbody").innerHTML = contributions.length ? contributions.map(c => \`
      <tr>
        <td>\${escapeHtml(c.url)}</td>
        <td class="num">\${c.earned}</td>
        <td class="num">\${c.hit_count}</td>
      </tr>
    \`).join("") : '<tr><td colspan="3" style="color:var(--muted)">none</td></tr>';
  } catch (err) {
    toast(err.message, true);
  }
}

function goBack() {
  // If we came from the list, history.back() returns there cleanly.
  // Otherwise (deep link / refresh), replace URL and show the list.
  if (history.state?.view === "user" && history.length > 1) {
    history.back();
  } else {
    history.replaceState({ view: "list" }, "", "/admin");
    showList();
  }
}

window.addEventListener("popstate", () => {
  const params = new URLSearchParams(location.search);
  const userId = params.get("user");
  if (userId) {
    openUser(userId);
  } else {
    showList();
  }
});

$("back-btn").addEventListener("click", goBack);

$("create-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const { user } = await api("POST", "/admin/users", {
      id: $("create-id").value.trim() || undefined,
      name: $("create-name").value.trim() || undefined,
    });
    $("create-id").value = "";
    $("create-name").value = "";
    toast("Created " + user.id);
    await loadUsers();
  } catch (err) { toast(err.message, true); }
});

$("edit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUserId) return;
  const body = {};
  const name = $("edit-name").value;
  const balance = $("edit-balance").value;
  if (name !== "") body.name = name;
  if (balance !== "") body.balance = Number(balance);
  try {
    await api("PATCH", "/admin/users/" + encodeURIComponent(currentUserId), body);
    toast("Saved");
    await openUser(currentUserId);
    await loadUsers();
  } catch (err) { toast(err.message, true); }
});

$("charge-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUserId) return;
  try {
    const r = await api("POST", "/admin/users/" + encodeURIComponent(currentUserId) + "/charge", {
      amount: Number($("charge-amount").value),
      reason: $("charge-reason").value || undefined,
    });
    $("charge-amount").value = ""; $("charge-reason").value = "";
    toast("Charged. New balance: " + r.new_balance);
    await openUser(currentUserId);
    await loadUsers();
  } catch (err) { toast(err.message, true); }
});

$("credit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUserId) return;
  try {
    const r = await api("POST", "/admin/users/" + encodeURIComponent(currentUserId) + "/credit", {
      amount: Number($("credit-amount").value),
      url: $("credit-url").value,
    });
    $("credit-amount").value = ""; $("credit-url").value = "";
    toast("Credited. New balance: " + r.new_balance);
    await openUser(currentUserId);
    await loadUsers();
  } catch (err) { toast(err.message, true); }
});

// Initial routing: load user list, and if URL has ?user=X open that view.
loadUsers();
const initialUser = new URLSearchParams(location.search).get("user");
if (initialUser) {
  openUser(initialUser);
} else {
  history.replaceState({ view: "list" }, "", location.pathname);
}
</script>
</body>
</html>`;
