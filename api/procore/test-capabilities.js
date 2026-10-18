// Report picker spec, section 4 + open question 2 (sandbox check): what Procore says the signed-in person can use.
// GET  /api/procore/test-capabilities : a small page (sign in with Procore first) with a Run Check button.
// POST /api/procore/test-capabilities : GET calls only, with the person's own sign-in. Reports
//   1. GET /rest/v1.0/settings/permissions?project_id= : status, and for every tool in the answer its name,
//      friendly name, available_for_user, can_create and access level (no URLs, no ids beyond the tool's),
//   2. each one-row probe in api/_capabilities.js (status), so both sources can be compared,
//   3. what the app would decide (probeAll).
// Run it as Edward (admin), a Foreman / Superintendent, a Subcontractor - External person, and the guest is blocked
// (sandbox tool pages are). Sandbox only. Same-origin JSON for the POST.
import { config, HttpError, procoreId, readBody, requireSameOriginJson, sendError, sendJson } from "../_procore.js";
import { listProjects } from "../_projects.js";
import { procoreSend } from "../_procoreWrite.js";
import { probeAll, probeRequest, TOOLS } from "../_capabilities.js";

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SiteSnap AI · Tool access check</title>
<style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#000;color:#f5efe6;max-width:640px;margin:0 auto;padding:24px 16px}
button{font:inherit;font-size:20px;font-weight:700;padding:14px 20px;border:0;border-radius:14px;background:#ffb81c;color:#1f1a14;width:100%;margin:8px 0}
select{font:inherit;font-size:17px;width:100%;padding:12px;border-radius:12px;background:#221d18;color:#f5efe6;border:1px solid #3a332b}
.step{background:#221d18;border-radius:12px;padding:10px 14px;margin:8px 0}.ok{color:#30d158}.bad{color:#ff5f57}.maybe{color:#ffc24d}a{color:#ffc24d}small{color:#b8ac9c}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{border-bottom:1px solid #3a332b;padding:4px 6px;text-align:left}</style></head>
<body><h1>Tool access check</h1>
<p>Asks Procore which tools you can use on a project, two ways, so SiteSnap can hide what you can't do. <b>Read only: nothing changes in Procore.</b> Run it as yourself, then in a private window as a Foreman and as a Subcontractor - External person.</p>
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
  $('#run').disabled=true; $('#out').innerHTML='<p>Checking… (about 10 seconds)</p>';
  const [companyId,projectId]=$('#p').value.split('_');
  const r=await fetch('/api/procore/test-capabilities',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId,projectId})});
  const b=await r.json().catch(()=>({message:'No answer'}));
  if(!r.ok){ $('#out').innerHTML='<p class="bad">'+esc(b.message||'Failed')+'</p>'; $('#run').disabled=false; return; }
  const cls=(s)=>s==='available'?'ok':s==='denied'?'bad':'maybe';
  let h='<p><b>'+esc(b.who)+'</b></p>';
  h+='<div class="step"><b>1. Permission list</b> <small>(settings/permissions: '+b.manifest.status+')</small><br>';
  h+=b.manifest.tools.length?'<table><tr><th>name</th><th>shown as</th><th>can use</th><th>can create</th><th>level</th></tr>'+b.manifest.tools.map(t=>'<tr><td>'+esc(t.name)+'</td><td>'+esc(t.friendly)+'</td><td>'+esc(t.available)+'</td><td>'+esc(t.canCreate)+'</td><td>'+esc(t.level)+'</td></tr>').join('')+'</table>':'<small>No tools in the answer. Keys: '+esc(b.manifest.keys.join(', '))+'</small>';
  h+='</div><div class="step"><b>2. One-row reads</b><br>'+b.probes.map(p=>'<span class="'+(p.status<300&&p.status>=200?'ok':p.status===403||p.status===401?'bad':'maybe')+'">'+esc(p.tool)+' '+p.status+'</span> <small>'+esc(p.path)+'</small>').join('<br>')+'</div>';
  h+='<div class="step"><b>3. What SiteSnap decides</b><br>'+Object.entries(b.decided).map(([k,v])=>'<span class="'+cls(v.state)+'">'+esc(k)+': '+esc(v.state)+'</span> <small>create: '+esc(v.canCreate)+' · '+esc(v.source)+(v.level?' · '+esc(v.level):'')+'</small>').join('<br>')+'</div>';
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
    const today = new Date().toISOString().slice(0, 10);

    const me = await send("/rest/v1.0/me", { company_id: companyId });
    const m = await send("/rest/v1.0/settings/permissions", { project_id: projectId });
    const list = Array.isArray(m.json?.tools) ? m.json.tools : Array.isArray(m.json) ? m.json : [];
    const manifest = {
      status: m.status,
      keys: m.json && typeof m.json === "object" ? Object.keys(m.json).slice(0, 20) : [],
      tools: list.map((t) => ({ name: t?.name ?? "", friendly: t?.friendly_name ?? "", available: t?.available_for_user ?? null, canCreate: t?.can_create ?? null, level: t?.user_access_level?.name ?? t?.user_access_level?.id ?? null })),
    };
    const probes = [];
    for (const tool of TOOLS) {
      const [path, query] = probeRequest(tool, { projectId, today });
      const r = await send(path, query);
      probes.push({ tool, path, status: r.status });
    }
    const decided = (await probeAll(send, { projectId, today })).tools;
    sendJson(res, 200, { who: `Signed in as ${me.json?.name ?? "?"}`, manifest, probes, decided });
  } catch (err) {
    sendError(res, err);
  }
}
