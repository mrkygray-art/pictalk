// My items (report picker spec, section 6) sandbox check: are the Procore field names in api/_myItems.js right?
// GET  /api/procore/test-my-items : a small page (sign in with Procore first) with a Run Check button.
// POST /api/procore/test-my-items : GET calls only, with the person's own sign-in. Reports, for Observations and
//   Punch Items: how many came back with and without the "mine" filter, the field names on the first row, what
//   the assignee fields look like (ids and names only), how many SiteSnap counts as mine, and the field names and
//   attachment fields on one item read in full. No emails, phones or tokens. Sandbox only.
import { config, HttpError, procoreId, readBody, requireSameOriginJson, sendError, sendJson } from "../_procore.js";
import { listProjects } from "../_projects.js";
import { procoreSend } from "../_procoreWrite.js";
import { assignedToMe, itemDetail, listQuery, PATHS } from "../_myItems.js";

const PRIVATE = /mail|phone|fax|address|zip|login$/i;
const keysOf = (o) => (o && typeof o === "object" ? Object.keys(o).filter((k) => !PRIVATE.test(k)) : []);
const people = (v) => [].concat(v ?? []).map((p) => (p && typeof p === "object" ? { id: p.id ?? p.login_information_id ?? null, name: p.name ?? null, keys: keysOf(p).slice(0, 12) } : p));

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SiteSnap AI · My items check</title>
<style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#000;color:#f5efe6;max-width:640px;margin:0 auto;padding:24px 16px}
button{font:inherit;font-size:20px;font-weight:700;padding:14px 20px;border:0;border-radius:14px;background:#ffb81c;color:#1f1a14;width:100%;margin:8px 0}
select{font:inherit;font-size:17px;width:100%;padding:12px;border-radius:12px;background:#221d18;color:#f5efe6;border:1px solid #3a332b}
.step{background:#221d18;border-radius:12px;padding:10px 14px;margin:8px 0}a{color:#ffc24d}small{color:#b8ac9c}pre{white-space:pre-wrap;font-size:12px;color:#b8ac9c}</style></head>
<body><h1>My items check</h1>
<p>Reads your Observations and Punch Items to check the field names SiteSnap uses for "assigned to me", due dates and photos. <b>Read only: nothing changes in Procore.</b> Run it as someone who has items assigned to them.</p>
<p id="who"><small>Checking your Procore sign-in…</small></p>
<label for="p">Project</label> <select id="p"></select>
<button id="run" disabled>Run Check</button>
<div id="out"></div>
<script>
const $=(s)=>document.querySelector(s);
const esc=(s)=>String(s??'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
fetch('/api/procore/projects').then(async(r)=>{
  if(r.status===401){ $('#who').innerHTML='Not signed in. <a href="/api/procore/login">Sign in with Procore</a>, then come back to this page.'; return; }
  const b=await r.json(); const list=b.projects||[];
  $('#who').innerHTML='<small>Signed in. '+list.length+' project(s).</small>';
  for(const p of list){ const o=document.createElement('option'); o.value=p.companyId+'_'+p.projectId; o.textContent=p.name; $('#p').append(o); }
  $('#run').disabled=!list.length;
});
$('#run').onclick=async()=>{
  $('#run').disabled=true; $('#out').innerHTML='<p>Checking…</p>';
  const [companyId,projectId]=$('#p').value.split('_');
  const r=await fetch('/api/procore/test-my-items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId,projectId})});
  const b=await r.json().catch(()=>({message:'No answer'}));
  if(!r.ok){ $('#out').innerHTML='<p style="color:#ff5f57">'+esc(b.message||'Failed')+'</p>'; $('#run').disabled=false; return; }
  let h='<p><b>'+esc(b.who)+'</b></p>';
  for(const t of b.tools){ h+='<div class="step"><b>'+esc(t.name)+'</b><br><small>'+esc(t.summary)+'</small><pre>'+esc(JSON.stringify(t.detail,null,1))+'</pre></div>'; }
  h+='<p><small>Copy everything on this page (or take screenshots) and send it to Claude.</small></p>';
  $('#out').innerHTML=h; $('#run').disabled=false;
};
</script></body></html>`;

export default async function handler(req, res) {
  try {
    const cfg = config();
    if (!/sandbox/i.test(cfg.apiUrl)) throw new HttpError(403, "not_sandbox", "This check only runs against Procore's sandbox.");
    if (req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      return res.end(PAGE);
    }
    if (req.method !== "POST") throw new HttpError(405, "bad_request", "Use POST.");
    requireSameOriginJson(req);
    const body = await readBody(req);
    const companyId = procoreId(String(body.companyId ?? ""));
    const projectId = procoreId(String(body.projectId ?? ""));
    if (!companyId || !projectId) throw new HttpError(400, "missing_ids", "Pick a project.");
    const { projects } = await listProjects(req, res, cfg);
    if (!projects.some((p) => p.companyId === companyId && p.projectId === projectId)) throw new HttpError(403, "no_access", "You're not on that project in Procore.");
    const send = (path, query) => procoreSend(req, res, cfg, "GET", path, { companyId, query });
    const me = await send("/rest/v1.0/me", { company_id: companyId });
    const myId = String(me.json?.id ?? "");

    const tools = [];
    for (const [type, path] of [["observation", PATHS.observations], ["punch_item", PATHS.punch]]) {
      const filtered = await send(path, listQuery(type, { projectId, myId, page: 1 }));
      const plain = await send(path, { project_id: projectId, per_page: 100 });
      const rows = Array.isArray(filtered.json) ? filtered.json : [];
      const all = Array.isArray(plain.json) ? plain.json : [];
      const mine = all.filter((x) => assignedToMe(type, x, myId));
      const first = mine[0] ?? all[0];
      const detail = { firstRowKeys: keysOf(first), statusFields: first ? { status: first.status ?? null, workflow_status: first.workflow_status ?? null, due_date: first.due_date ?? null } : null };
      if (type === "observation") Object.assign(detail, { assignee: people(first?.assignee), assignees: people(first?.assignees), created_by: people(first?.created_by) });
      else Object.assign(detail, { assignees: people(first?.assignees), assignments: (first?.assignments ?? []).slice(0, 3).map((a) => ({ keys: keysOf(a), login_information_id: a?.login_information_id ?? null, assignee: people(a?.assignee ?? a?.login_information) })), ball_in_court: people(first?.ball_in_court), punch_item_manager: people(first?.punch_item_manager) });
      if (first) {
        const one = await send(`${path}/${first.id}`, { project_id: projectId });
        detail.fullReadStatus = one.status;
        detail.fullReadKeys = keysOf(one.json);
        detail.attachments = (one.json?.attachments ?? []).slice(0, 3).map((a) => ({ keys: keysOf(a), name: a?.name ?? a?.filename ?? null, host: (() => { try { return new URL(a?.url).hostname; } catch { return null; } })() }));
        detail.photosSiteSnapFinds = itemDetail(type, one.json ?? {}).photos.length;
      }
      tools.push({
        name: type === "observation" ? "Observations" : "Punch Items",
        summary: `With SiteSnap's filter: ${filtered.status}, ${rows.length} rows (${rows.filter((x) => assignedToMe(type, x, myId)).length} assigned to you). Without: ${plain.status}, ${all.length} rows, ${mine.length} assigned to you.`,
        detail,
      });
    }
    sendJson(res, 200, { who: `Signed in as ${me.json?.name ?? "?"} (id ${myId})`, tools });
  } catch (err) {
    sendError(res, err);
  }
}
