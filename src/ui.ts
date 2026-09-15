export function renderUI(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>The Internal Brain — TenTen</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background:#0d1117; color:#e6edf3; margin:0; padding:24px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:#8b949e; font-size:12px; margin-bottom:20px; }
  .card { background:#161b22; border:1px solid #30363d; border-radius:8px; padding:16px; margin-bottom:16px; }
  .row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  button { background:#1f6feb; color:#fff; border:none; border-radius:6px; padding:6px 12px; cursor:pointer; font:inherit; font-size:13px; }
  button.ghost { background:#21262d; color:#e6edf3; border:1px solid #30363d; }
  button.danger { background:#da3633; }
  input[type=text], textarea { background:#0d1117; border:1px solid #30363d; border-radius:6px; color:#e6edf3; padding:8px; font:inherit; flex:1; }
  .user-pill { padding:6px 12px; border-radius:999px; border:1px solid #30363d; cursor:pointer; font-size:13px; }
  .user-pill.active { border-color:#1f6feb; background:#1f6feb22; }
  .answer { white-space:pre-wrap; font-size:14px; line-height:1.6; }
  .cite { color:#58a6ff; font-weight:600; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid #21262d; vertical-align:top; }
  th { color:#8b949e; font-weight:600; }
  .ok { color:#3fb950; font-weight:600; } .bad { color:#f85149; font-weight:600; }
  .muted { color:#8b949e; }
  .tag { display:inline-block; padding:1px 6px; border-radius:4px; font-size:11px; margin-right:4px; }
  .tag.allowed { background:#23863622; color:#3fb950; border:1px solid #23863644; }
  .tag.denied { background:#da363322; color:#f85149; border:1px solid #da363344; }
  .hash { color:#8b949e; font-size:10px; word-break:break-all; max-width:220px; }
  #verify-out, #msg { font-size:13px; margin-top:8px; }
</style>
</head>
<body>
  <h1>The Internal Brain <span class="muted">— TenTen-Tencent</span></h1>
  <div class="sub">Permission-aware RAG over Confluence · hash-chained audit trail · live permission revocation</div>

  <div class="card">
    <div class="row">
      <span class="muted" style="font-size:13px">Log in as:</span>
      <span class="user-pill active" data-user="admin@acme.co">Alex Admin (SecOps)</span>
      <span class="user-pill" data-user="junior@acme.co">Jade Junior (Backend)</span>
    </div>
  </div>

  <div class="card">
    <div class="row">
      <input type="text" id="q" placeholder='Ask… e.g. "What was the root cause of the payment outage and what follow-up tickets were created?"' style="min-width:60%" />
      <button id="ask">Ask</button>
    </div>
    <div id="msg" class="muted"></div>
    <div id="answer" class="answer" style="display:none; margin-top:12px"></div>
    <div id="retrieval" style="display:none; margin-top:10px"></div>
  </div>

  <div class="card">
    <div class="row" style="justify-content:space-between">
      <strong style="font-size:13px">Audit trail</strong>
      <div class="row">
        <button class="ghost" id="verify">Verify chain integrity</button>
        <button class="danger" id="tamper">Tamper with last entry (demo)</button>
        <button class="ghost" id="revoke">Revoke junior ← security page</button>
      </div>
    </div>
    <div id="verify-out"></div>
    <table id="audit"><thead><tr><th>seq</th><th>who</th><th>query</th><th>allowed</th><th>denied</th><th>chain hash</th></tr></thead><tbody></tbody></table>
  </div>

<script>
let user = "admin@acme.co";
document.querySelectorAll(".user-pill").forEach(p => p.onclick = () => {
  document.querySelectorAll(".user-pill").forEach(x => x.classList.remove("active"));
  p.classList.add("active"); user = p.dataset.user;
});

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

async function api(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

async function ask() {
  const q = $("q").value.trim(); if (!q) return;
  $("msg").textContent = "⚠ Workers AI — each ask costs a little; free tier is limited. Don't spam.";
  $("answer").style.display = "none"; $("retrieval").style.display = "none";
  const out = await api("/api/ask", { user_email: user, query: q });
  $("msg").textContent = "";
  const a = $("answer");
  a.style.display = "block";
  var srcs = out.citations.map(c => "<span class=\"cite\">[" + c.ref + "]</span> <a href=\"#\" style=\"color:#58a6ff\">" + esc(c.title) + "</a>").join("<br>");
  a.innerHTML = esc(out.answer) + (out.citations.length ? "<br><br><span class='muted'>Sources:</span><br>" + srcs : "");
  const r = $("retrieval"); r.style.display = "block";
  r.innerHTML = "<span class='muted'>Retrieval window:</span> " +
    out.allowed.map(p => "<span class=\"tag allowed\">" + esc(p.title) + "</span>").join("") +
    (out.denied_count ? "<span class=\"tag denied\">" + out.denied_count + " filtered (no permission)</span>" : "");
  await loadAudit();
}

async function loadAudit() {
  const out = await api("/api/audit", {});
  const tbody = $("audit").querySelector("tbody");
  tbody.innerHTML = out.entries.slice(0, 12).map(e => {
    const byId = id => out.users.find(u => u.id === id)?.email ?? "?";
    const denied = JSON.parse(e.denied).length;
    return "<tr><td>" + e.seq + "</td><td>" + esc(byId(e.actor_id)) + "</td><td>" + esc(e.query.slice(0, 60)) +
      "</td><td>" + JSON.parse(e.allowed).length + "</td><td>" + (denied ? "<span class=\"bad\">" + denied + "</span>" : "0") +
      "</td><td><span class='hash'>" + e.chain_hash.slice(0, 24) + "…</span></td></tr>";
  }).join("");
}

$("ask").onclick = ask;
$("q").addEventListener("keydown", e => { if (e.key === "Enter") ask(); });

$("verify").onclick = async () => {
  const out = await api("/api/audit/verify", {});
  $("verify-out").innerHTML = out.ok
    ? "<span class=\"ok\">✔ chain intact — " + out.checked + " entries verified</span>"
    : "<span class=\"bad\">✘ TAMPER DETECTED — " + out.errors.join("; ") + "</span>";
};

$("tamper").onclick = async () => {
  const out = await api("/api/audit/tamper", {});
  $("verify-out").innerHTML = "<span class=\"muted\">Tampered seq " + out.seq + " — now press “Verify chain integrity”</span>";
};

$("revoke").onclick = async () => {
  const out = await api("/api/revoke", { user_email: "junior@acme.co", page_id: 4 });
  $("verify-out").innerHTML = "<span class=\"muted\">Revoked junior → “" + out.title + "”. Next ask as junior drops it.</span>";
};

(async () => { await loadAudit(); })();
</script>
</body>
</html>`;
}