// Test companies and people for the Procore sandbox (Ky's sitesnap_test_users.md, data in api/_seedDirectory.js).
// GET  /api/procore/seed-directory : a small page (sign in with Procore first): pick the project, Check, then Run.
// POST { action: "plan" }      : reads the company directory (active and inactive) and says what the cleanup
//                                would touch. Nothing changes.
// POST { action: "cleanup" }   : makes the ticked earlier test people and companies inactive (Procore has no delete
//                                for either). The plan is worked out again here, so only "remove" / "ask" rows can
//                                change: never the signed-in person, @procore.com users or Architect TEST Company.
// POST { action: "company", index } : one test company: create it (or update and reactivate it), add it to the
//                                project, then its 4 people (same), each added to the project and given a Project Role.
// One company per call keeps each call short. Uses the signed-in person's own Procore sign-in (a company admin).
// Endpoints (Procore reference, checked 2026-10-14): GET/POST /rest/v1.3/companies/{c}/users, PATCH .../users/{id},
// GET /rest/v1.0/companies/{c}/users/inactive, GET/POST /rest/v1.0/vendors, PATCH /rest/v1.0/vendors/{id},
// GET /rest/v1.0/companies/{c}/vendors/inactive, POST /rest/v1.0/projects/{p}/vendors/{id}/actions/add,
// POST /rest/v1.0/projects/{p}/users/{id}/actions/add, GET/POST /rest/v1.0/project_roles.
// Sandbox only (PROCORE_API_URL must be Procore's sandbox). Same-origin JSON for the POSTs. Never returns a token.
import { config, HttpError, procoreGet, procoreId, requireSameOriginJson, readBody, sendError, sendJson } from "../_procore.js";
import { allPages, listProjects } from "../_projects.js";
import { procoreSend } from "../_procoreWrite.js";
import { SEED, cleanupPlan, removable, userBody, vendorBody } from "../_seedDirectory.js";

const brief = (r) => (r.ok ? `ok (${r.status})` : `Procore answered ${r.status}: ${JSON.stringify(r.json?.errors ?? r.json?.message ?? r.json?.error ?? r.json ?? "").slice(0, 300)}`);
const lower = (s) => String(s ?? "").trim().toLowerCase();

// A list Procore may refuse (inactive lists need Directory admin): empty instead of failing the whole run
async function maybePages(req, res, cfg, path, opts) {
  try {
    return await allPages(req, res, cfg, path, opts);
  } catch (err) {
    if (err?.status === 403 || err?.status === 404) return [];
    throw err;
  }
}

// Every company user and vendor, active and inactive
async function directory(req, res, cfg, companyId) {
  const q = { companyId, query: {} };
  const active = await allPages(req, res, cfg, `/rest/v1.3/companies/${companyId}/users`, q);
  const inactive = (await maybePages(req, res, cfg, `/rest/v1.0/companies/${companyId}/users/inactive`, q)).map((u) => ({ ...u, is_active: false }));
  const vendors = await allPages(req, res, cfg, "/rest/v1.0/vendors", { companyId, query: { company_id: companyId } });
  const inactiveVendors = (await maybePages(req, res, cfg, `/rest/v1.0/companies/${companyId}/vendors/inactive`, q)).map((v) => ({ ...v, is_active: false }));
  const seen = new Set(active.map((u) => String(u.id)));
  const seenV = new Set(vendors.map((v) => String(v.id)));
  return {
    users: [...active, ...inactive.filter((u) => !seen.has(String(u.id)))],
    vendors: [...vendors, ...inactiveVendors.filter((v) => !seenV.has(String(v.id)))],
  };
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SiteSnap AI · Test people</title>
<style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#000;color:#f5efe6;max-width:720px;margin:0 auto;padding:24px 16px}
button{font:inherit;font-size:19px;font-weight:700;padding:14px 20px;border:0;border-radius:14px;background:#ffb81c;color:#1f1a14;width:100%;margin:8px 0}
button:disabled{opacity:.5}select{font:inherit;font-size:17px;width:100%;padding:12px;border-radius:12px;background:#221d18;color:#f5efe6;border:1px solid #3a332b}
.row{display:flex;gap:10px;align-items:flex-start;background:#221d18;border-radius:12px;padding:10px 14px;margin:6px 0}.row input{width:22px;height:22px;margin-top:2px;flex:none}
.ok{color:#30d158}.bad{color:#ff5f57}.tag{font-size:13px;color:#ffc24d}a{color:#ffc24d}small{color:#b8ac9c}h2{margin-top:28px}</style></head>
<body><h1>Test companies and people</h1>
<p>Adds 4 test companies (Ironbridge, VoltLine, ClearFlow, Summit) and 16 people to the project you pick: job title, phones, company, and a Project Role for each. Permission templates are left for later. Everything is made up; emails go to your Gmail with +addresses.</p>
<p>First it makes your <b>earlier test people and companies inactive</b> (Procore has no delete). You see the list and choose before anything changes. Procore's own test records, Architect TEST Company, and you are never touched.</p>
<p id="who"><small>Checking your Procore sign-in…</small></p>
<label for="p">Project</label> <select id="p"></select>
<button id="check" disabled>Check What's There</button>
<div id="plan"></div>
<button id="run" hidden>Make Ticked Ones Inactive and Add Test People</button>
<div id="out"></div>
<script>
const $=(s)=>document.querySelector(s); let ids=null;
const esc=(s)=>String(s??'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const post=async(body)=>{ const r=await fetch('/api/procore/seed-directory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...ids,...body})}); const b=await r.json().catch(()=>({message:'No answer'})); if(!r.ok) throw new Error(b.message||'Failed'); return b; };
fetch('/api/procore/projects').then(async(r)=>{
  if(r.status===401){ $('#who').innerHTML='Not signed in. <a href="/api/procore/login">Sign in with Procore</a>, then come back to this page.'; return; }
  const b=await r.json(); const list=b.projects||[];
  $('#who').innerHTML='<small>Signed in. '+list.length+' project(s).</small>';
  for(const p of list){ const o=document.createElement('option'); o.value=p.companyId+'_'+p.projectId; o.textContent=p.name; if(/sandbox test/i.test(p.name)) o.selected=true; $('#p').append(o); }
  $('#check').disabled=!list.length;
});
const rows=(list,kind)=>list.filter(r=>r.active||r.action==='reuse').map(r=>'<label class="row"><input type="checkbox" data-kind="'+kind+'" value="'+esc(r.id)+'"'+(r.checked?' checked':'')+((r.action==='keep'||r.action==='reuse')?' disabled':'')+'><span><b>'+esc(r.name)+'</b><br><small>'+esc(r.detail)+'</small><br><span class="tag">'+esc(r.reason)+'</span></span></label>').join('')||'<p><small>None.</small></p>';
$('#check').onclick=async()=>{
  const [companyId,projectId]=$('#p').value.split('_'); ids={companyId,projectId};
  $('#check').disabled=true; $('#plan').innerHTML='<p>Reading the directory…</p>'; $('#out').innerHTML='';
  try{
    const b=await post({action:'plan'});
    $('#plan').innerHTML='<h2>Companies</h2><p><small>Ticked = made inactive. Greyed = stays.</small></p>'+rows(b.vendors,'vendor')+'<h2>People</h2>'+rows(b.users,'user')+'<h2>Will add</h2><p>'+b.seed.map(c=>'<b>'+esc(c.name)+'</b> ('+c.vendor+'), '+c.people.length+' people').join('<br>')+'</p>';
    $('#run').hidden=false;
  }catch(e){ $('#plan').innerHTML='<p class="bad">'+esc(e.message)+'</p>'; }
  $('#check').disabled=false;
};
const show=(steps)=>{ $('#out').innerHTML+=steps.map(s=>'<div class="row"><span><b class="'+(s.ok?'ok':'bad')+'">'+(s.ok?'✓':'✗')+' '+esc(s.name)+'</b><br><small>'+esc(s.detail)+'</small></span></div>').join(''); };
$('#run').onclick=async()=>{
  const picked=(k)=>[...document.querySelectorAll('input[data-kind='+k+']:checked:not(:disabled)')].map(i=>i.value);
  $('#run').disabled=true; $('#check').disabled=true; $('#out').innerHTML='<h2>Results</h2>';
  try{
    show((await post({action:'cleanup',userIds:picked('user'),vendorIds:picked('vendor')})).steps);
    for(let i=0;i<4;i++){ $('#out').innerHTML+='<p><small>Company '+(i+1)+' of 4…</small></p>'; show((await post({action:'company',index:i})).steps); }
    $('#out').innerHTML+='<p><b>Done.</b> <small>Take a screenshot of anything with a ✗ and send it to Claude. Then open SiteSnap and refresh the directory.</small></p>';
  }catch(e){ $('#out').innerHTML+='<p class="bad">'+esc(e.message)+'</p>'; }
  $('#run').disabled=false; $('#check').disabled=false;
};
</script></body></html>`;

async function plan(req, res, cfg, companyId) {
  const me = await procoreGet(req, res, cfg, "/rest/v1.0/me", { companyId, query: { company_id: companyId } });
  const dir = await directory(req, res, cfg, companyId);
  return { me, dir, plan: cleanupPlan({ ...dir, meId: me?.id }) };
}

async function cleanup(req, res, cfg, companyId, body) {
  const { dir, plan: p } = await plan(req, res, cfg, companyId);
  const pick = removable(p, body.userIds, body.vendorIds);
  const steps = [];
  for (const row of pick.users) {
    const u = dir.users.find((x) => String(x.id) === String(row.id));
    const r = await procoreSend(req, res, cfg, "PATCH", `/rest/v1.3/companies/${companyId}/users/${row.id}`, { companyId, body: { user: { last_name: u?.last_name || row.name, is_active: false } } });
    steps.push({ name: `Made inactive: ${row.name}`, ok: r.ok, detail: brief(r) });
  }
  for (const row of pick.vendors) {
    const r = await procoreSend(req, res, cfg, "PATCH", `/rest/v1.0/vendors/${row.id}`, { companyId, body: { company_id: Number(companyId), vendor: { name: row.name, is_active: false } } });
    steps.push({ name: `Made inactive: ${row.name}`, ok: r.ok, detail: brief(r) });
  }
  if (!steps.length) steps.push({ name: "Cleanup", ok: true, detail: "Nothing ticked, nothing changed." });
  return steps;
}

async function addCompany(req, res, cfg, companyId, projectId, seed) {
  const steps = [];
  const step = (name, r, extra = "") => { steps.push({ name, ok: r.ok, detail: `${brief(r)}${extra}` }); return r.ok; };
  const { users, vendors } = await directory(req, res, cfg, companyId);

  // The company: update and reactivate it if it's already there, else create it
  const found = vendors.find((v) => lower(v.name) === lower(seed.vendor.name));
  const vr = found
    ? await procoreSend(req, res, cfg, "PATCH", `/rest/v1.0/vendors/${found.id}`, { companyId, body: vendorBody(companyId, seed.vendor) })
    : await procoreSend(req, res, cfg, "POST", "/rest/v1.0/vendors", { companyId, body: vendorBody(companyId, seed.vendor) });
  const vendorId = vr.ok ? vr.json?.id ?? found?.id : null;
  if (!step(`${found ? "Updated" : "Created"} company: ${seed.vendor.name}`, vr, vendorId ? `, id ${vendorId}` : "") || !vendorId) return steps;

  const onProject = await allPages(req, res, cfg, `/rest/v1.0/projects/${projectId}/vendors`, { companyId, query: {} }).catch(() => []);
  if (onProject.some((v) => String(v.id) === String(vendorId))) steps.push({ name: "Company on the project", ok: true, detail: "already there" });
  else step("Added company to the project", await procoreSend(req, res, cfg, "POST", `/rest/v1.0/projects/${projectId}/vendors/${vendorId}/actions/add`, { companyId }));

  const projectUsers = await allPages(req, res, cfg, `/rest/v1.0/projects/${projectId}/users`, { companyId, query: {} }).catch(() => []);
  const roles = await allPages(req, res, cfg, "/rest/v1.0/project_roles", { companyId, query: { project_id: projectId } }).catch(() => []);

  for (const u of seed.users) {
    const name = `${u.first_name} ${u.last_name}`;
    const existing = users.find((x) => lower(x.email_address) === lower(u.email_address));
    const ur = existing
      ? await procoreSend(req, res, cfg, "PATCH", `/rest/v1.3/companies/${companyId}/users/${existing.id}`, { companyId, body: userBody(u, vendorId, seed.vendor, { update: true }) })
      : await procoreSend(req, res, cfg, "POST", `/rest/v1.3/companies/${companyId}/users`, { companyId, body: userBody(u, vendorId, seed.vendor) });
    const userId = ur.ok ? ur.json?.id ?? existing?.id : null;
    if (!step(`${existing ? "Updated" : "Created"} ${name} (${u.job_title})`, ur) || !userId) continue;

    if (projectUsers.some((x) => String(x.id) === String(userId))) steps.push({ name: `${name} on the project`, ok: true, detail: "already there" });
    else step(`Added ${name} to the project`, await procoreSend(req, res, cfg, "POST", `/rest/v1.0/projects/${projectId}/users/${userId}/actions/add`, { companyId, body: { user: {} } }));

    if (roles.some((r) => String(r.user_id) === String(userId) && lower(r.role) === lower(u.projectRole))) {
      steps.push({ name: `${name}: Project Role ${u.projectRole}`, ok: true, detail: "already set" });
    } else {
      step(`${name}: Project Role ${u.projectRole}`, await procoreSend(req, res, cfg, "POST", "/rest/v1.0/project_roles", {
        companyId, body: { project_id: Number(projectId), project_role: { role: u.projectRole, user_id: Number(userId) } },
      }));
    }
  }
  return steps;
}

export default async function handler(req, res) {
  try {
    const cfg = config();
    if (!/sandbox/i.test(cfg.apiUrl)) throw new HttpError(403, "not_sandbox", "This only runs against Procore's sandbox.");
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

    if (body.action === "plan") {
      const { plan: p } = await plan(req, res, cfg, companyId);
      const seed = SEED.map((c) => ({ name: c.vendor.name, vendor: p.vendors.some((v) => v.action === "reuse" && v.name.toLowerCase() === c.vendor.name.toLowerCase()) ? "already there, will be updated" : "new", people: c.users.map((u) => `${u.first_name} ${u.last_name}`) }));
      return sendJson(res, 200, { ...p, seed });
    }
    if (body.action === "cleanup") {
      const steps = await cleanup(req, res, cfg, companyId, body);
      console.log("SiteSnap seed cleanup", JSON.stringify(steps.map((s) => s.ok)));
      return sendJson(res, 200, { steps });
    }
    if (body.action === "company") {
      const seed = SEED[Number(body.index)];
      if (!Number.isInteger(Number(body.index)) || !seed) throw new HttpError(400, "bad_request", "No such test company.");
      const steps = await addCompany(req, res, cfg, companyId, projectId, seed);
      console.log("SiteSnap seed company", body.index, JSON.stringify(steps.map((s) => s.ok)));
      return sendJson(res, 200, { steps });
    }
    throw new HttpError(400, "bad_request", "Unknown action.");
  } catch (err) {
    sendError(res, err);
  }
}
