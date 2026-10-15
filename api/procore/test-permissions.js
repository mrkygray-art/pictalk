// Permission templates, Step 1 (desk + sandbox check): what SiteSnap can READ about who may use which tool.
// GET  /api/procore/test-permissions : a small page (sign in with Procore first) with a Run Check button.
// POST /api/procore/test-permissions : with the signed-in person's own Procore sign-in, only GET calls, nothing
//   changes in Procore. Tries the documented and the likely endpoints for: the project's permission templates
//   and what's inside one (per-tool levels?), each person's template, and who each tool will take as an
//   assignee (Observations, Punch List, Tasks). Reports each call's status, how many came back, the field
//   names, and which project people are missing from each assignee list. Never emails, phones or tokens.
// Run it as an admin, then as a non-admin test person, to see what each can read.
// Sandbox only (PROCORE_API_URL must be Procore's sandbox). Same-origin JSON for the POST.
import { config, HttpError, procoreId, requireSameOriginJson, readBody, sendError, sendJson } from "../_procore.js";
import { listProjects } from "../_projects.js";
import { procoreSend } from "../_procoreWrite.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pace = { gapMs: 450 }; // Procore allows about 25 calls per 10 seconds
const PRIVATE = /mail|phone|fax|address|zip|login$/i;
const nameOf = (x) => x?.name || [x?.first_name, x?.last_name].filter(Boolean).join(" ") || x?.login_information?.name || x?.user?.name || "";

// The shape of an answer, never its private values: field names, a nested-list peek, people's names
function shape(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : null;
  const first = list ? list[0] : json;
  const keys = first && typeof first === "object" ? Object.keys(first).filter((k) => !PRIVATE.test(k)) : [];
  const nested = {};
  for (const k of keys) {
    const v = first[k];
    if (Array.isArray(v) && v.length && typeof v[0] === "object") nested[k] = { count: v.length, keys: Object.keys(v[0]).filter((x) => !PRIVATE.test(x)).slice(0, 15), sample: v.slice(0, 4).map((e) => Object.fromEntries(Object.entries(e).filter(([x, y]) => !PRIVATE.test(x) && (typeof y !== "object" || y === null)).slice(0, 6))) };
    else if (v && typeof v === "object" && !Array.isArray(v)) nested[k] = { keys: Object.keys(v).filter((x) => !PRIVATE.test(x)).slice(0, 15) };
  }
  return { count: list ? list.length : null, keys: keys.slice(0, 40), nested, names: list ? list.slice(0, 60).map(nameOf).filter(Boolean) : [] };
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SiteSnap AI · Permissions check</title>
<style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#000;color:#f5efe6;max-width:640px;margin:0 auto;padding:24px 16px}
button{font:inherit;font-size:20px;font-weight:700;padding:14px 20px;border:0;border-radius:14px;background:#ffb81c;color:#1f1a14;width:100%;margin:8px 0}
select{font:inherit;font-size:17px;width:100%;padding:12px;border-radius:12px;background:#221d18;color:#f5efe6;border:1px solid #3a332b}
.step{background:#221d18;border-radius:12px;padding:10px 14px;margin:8px 0}.ok{color:#30d158}.bad{color:#ff5f57}.maybe{color:#ffc24d}a{color:#ffc24d}small{color:#b8ac9c}</style></head>
<body><h1>Permissions check</h1>
<p>Reads what Procore will tell SiteSnap about permission templates and who each tool (Observations, Punch List, Tasks) will take as an assignee. <b>Read only: nothing changes in Procore.</b> It uses your own Procore sign-in, so run it once as yourself and once signed in as a test person who isn't an admin.</p>
<p id="who"><small>Checking your Procore sign-in…</small></p>
<p><small><b>To run it as someone else</b> (a test person who isn't an admin): open this page in a <b>private / incognito window</b>, tap Sign in with Procore, and log in to Procore with that person's email and password. The check always runs as whoever is signed in to Procore in that window.</small></p>
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
  if(list[0]) fetch('/api/procore/me?companyId='+encodeURIComponent(list[0].companyId)).then(r=>r.json()).then(m=>{ if(m.name) $('#who').innerHTML='Running as <b>'+esc(m.name)+'</b> <small>('+list.length+' project(s))</small>'; }).catch(()=>{});
  for(const p of list){ const o=document.createElement('option'); o.value=p.companyId+'_'+p.projectId; o.textContent=p.name; if(/sandbox test/i.test(p.name)) o.selected=true; $('#p').append(o); }
  $('#run').disabled=!list.length;
});
$('#run').onclick=async()=>{
  $('#run').disabled=true; $('#out').innerHTML='<p>Checking… (about 15 seconds)</p>';
  const [companyId,projectId]=$('#p').value.split('_');
  const r=await fetch('/api/procore/test-permissions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId,projectId})});
  const b=await r.json().catch(()=>({message:'No answer'}));
  if(!r.ok){ $('#out').innerHTML='<p class="bad">'+esc(b.message||'Failed')+'</p>'; $('#run').disabled=false; return; }
  $('#out').innerHTML='<p><b>'+esc(b.who)+'</b></p>'+(b.steps||[]).map(s=>'<div class="step"><b class="'+(s.ok?'ok':s.status===404?'maybe':'bad')+'">'+(s.ok?'✓':'✗')+' '+esc(s.name)+'</b> <small>('+s.status+')</small><br><small>'+esc(s.detail)+'</small></div>').join('')
    +'<p><small>Copy everything on this page (or take screenshots) and send it to Claude. ✗ in yellow (404) just means that endpoint doesn\\'t exist: expected for some of the guesses.</small></p><pre style="white-space:pre-wrap;font-size:12px;color:#b8ac9c">'+esc(JSON.stringify(b.raw,null,1))+'</pre>';
  $('#run').disabled=false;
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

    let last = 0;
    const get = async (path, query = {}) => {
      const wait = last + pace.gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      return procoreSend(req, res, cfg, "GET", path, { companyId, query });
    };
    const steps = [];
    const raw = {};
    const p = projectId;

    const me = await get("/rest/v1.0/me", { company_id: companyId });
    const meId = me.json?.id;

    // The project's people and each one's template (documented: List Project Users)
    const users = await get(`/rest/v1.0/projects/${p}/users`, { per_page: 200 });
    const people = Array.isArray(users.json) ? users.json : [];
    const meOnProject = people.find((u) => String(u.id) === String(meId));
    const withTemplate = people.filter((u) => u.permission_template?.name);
    raw.projectUsers = shape(users.json);
    steps.push({ name: "Project people and their templates", ok: users.ok, status: users.status, detail: users.ok ? `${people.length} people; ${withTemplate.length} have a permission template. ${[...new Set(withTemplate.map((u) => u.permission_template.name))].join(", ")}` : "couldn't read the project's people" });
    const who = `Signed in as ${me.json?.name ?? "?"} (template here: ${meOnProject?.permission_template?.name ?? "none shown"})`;

    // The templates, then what's inside one
    const tpl = await get(`/rest/v1.0/projects/${p}/permission_templates`);
    const templates = Array.isArray(tpl.json) ? tpl.json : [];
    raw.templates = shape(tpl.json);
    steps.push({ name: "List the project's permission templates", ok: tpl.ok, status: tpl.status, detail: tpl.ok ? `${templates.length}: ${templates.map((t) => t.name).join(", ")}` : "not readable with this sign-in" });
    // What each template allows, tool by tool (company endpoint: user_access_levels). Only the tools SiteSnap
    // writes to or reads people from are shown; the full tool list is in raw for the first template.
    const TOOLS = /punch|observation|task|directory|admin/i;
    for (const t of templates) {
      const r = await get(`/rest/v1.0/companies/${companyId}/permission_templates/${t.id}`);
      const levels = r.json?.user_access_levels ?? {};
      if (!raw.allTools && r.ok) raw.allTools = Object.keys(levels);
      const shown = Object.entries(levels).filter(([k]) => TOOLS.test(k)).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
      raw[`levels: ${t.name}`] = Object.fromEntries(Object.entries(levels).filter(([k]) => TOOLS.test(k)));
      steps.push({ name: `What "${t.name}" allows`, ok: r.ok, status: r.status, detail: r.ok ? (shown.join("; ") || "no Punch List / Observations / Tasks / Directory levels in the answer") : "not readable with this sign-in" });
    }
    const ct = await get(`/rest/v1.0/companies/${companyId}/permission_templates`);
    raw.companyTemplates = shape(ct.json);
    steps.push({ name: "List the company's permission templates", ok: ct.ok, status: ct.status, detail: ct.ok ? `${raw.companyTemplates.count ?? "?"} templates` : "no such endpoint, or not allowed" });

    // Who each tool will take: compare with the project's people
    const missingFrom = (json) => {
      const names = new Set(shape(json).names.map((n) => n.toLowerCase()));
      return people.filter((u) => !names.has(nameOf(u).toLowerCase())).map(nameOf);
    };
    const lists = [
      ["Observations: who can be on the distribution (documented)", "/rest/v1.0/observations/potential_distribution_members", { project_id: p }],
      ["Observations: who can be assigned", "/rest/v1.0/observations/assignees", { project_id: p }],
    ];
    for (const [label, path, q] of lists) {
      const r = await get(path, q);
      raw[label] = shape(r.json);
      const missing = r.ok ? missingFrom(r.json) : [];
      steps.push({ name: label, ok: r.ok, status: r.status, detail: r.ok ? `${raw[label].count ?? "?"} people. Not in it: ${missing.length ? missing.join(", ") : "nobody"}` : "no such endpoint, or not allowed" });
    }

    console.log("SiteSnap permissions check", JSON.stringify(steps.map((s) => ({ name: s.name, status: s.status }))));
    sendJson(res, 200, { who, steps, raw });
  } catch (err) {
    sendError(res, err);
  }
}
