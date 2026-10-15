// Test companies and people for the Procore sandbox (Ky's sitesnap_test_users.md: 4 companies, 16 people; data in
// api/_seedDirectory.js).
// GET  /api/procore/seed-directory : a small page (sign in with Procore first): pick the project, Check, then Run.
// POST { action: "plan" }      : reads the company directory and says what the cleanup would touch. Nothing changes.
// POST { action: "cleanup" }   : makes the ticked earlier test people and companies inactive (Procore has no delete
//                                for either). The plan is worked out again here, so only "remove" / "ask" rows can
//                                change: never the signed-in person, @procore.com users or Architect TEST Company.
// POST { action: "company", index }         : one test company: create it (or update it), add it to the project.
// POST { action: "person", index, person }  : one of its people: create (or update and reactivate), add to the
//                                project, and (PMs only) give the Project Manager Project Role.
// POST { action: "templates", index }      : sets each of that company's people's permission template on the project
//                                (PATCH /rest/v1.0/projects/{p}/permission_template_assignments; see permissionTemplateFor).
// POST { action: "verify" }                 : reads the directory back and checks each test person: company, email,
//                                tag, on the project, Project Role; duplicates; totals. Nothing changes.
// Small steps, and every Procore call is paced: Procore allows about 25 calls per 10 seconds ("spike limit",
// developers.procore.com/documentation/rate-limiting); a 429 waits out the window and tries once more.
// Endpoints (Procore reference, checked 2026-10-14): GET/POST /rest/v1.3/companies/{c}/users, PATCH .../users/{id},
// GET /rest/v1.0/companies/{c}/users/inactive, GET /rest/v1.0/companies/{c}/people (user_id, contact.is_active),
// POST /rest/v2.0/companies/{c}/people/bulk_deactivate | bulk_activate {ids} (person ids; editing a user's is_active
// answers 200 but leaves them in the directory), GET/POST /rest/v1.0/vendors, PATCH /rest/v1.0/vendors/{id},
// GET /rest/v1.0/companies/{c}/vendors/inactive, POST /rest/v1.0/projects/{p}/vendors/{id}/actions/add,
// POST /rest/v1.0/projects/{p}/users/{id}/actions/add, GET/POST /rest/v1.0/project_roles.
// Sandbox only (PROCORE_API_URL must be Procore's sandbox). Same-origin JSON for the POSTs. Never returns a token.
import { config, HttpError, procoreId, requireSameOriginJson, readBody, sendError, sendJson } from "../_procore.js";
import { SEED, TAG, cleanupPlan, isSeedEmail, permissionTemplateFor, removable } from "../_seedDirectory.js";
import { addCompany, addPerson, api, brief, lower, pages, projectTemplates, setTemplate } from "../_seedSteps.js";

export { pace } from "../_seedSteps.js";

// The signed-in person can open this project (one call instead of listing every project)
async function checkProject(req, res, cfg, companyId, projectId) {
  const r = await api(req, res, cfg, "GET", `/rest/v1.0/projects/${projectId}`, { companyId, query: { company_id: companyId } });
  if (r.status === 401) throw new HttpError(401, "not_connected", "Sign in with Procore again.");
  if (!r.ok) throw new HttpError(403, "no_access", `You can't open that project in Procore (${r.status}).`);
}

// Every company user and vendor. Active = active in the company directory (people list, contact.is_active);
// personId is what (de)activation takes.
async function directory(req, res, cfg, companyId) {
  const q = { companyId };
  const listed = (await pages(req, res, cfg, `/rest/v1.3/companies/${companyId}/users`, q)) ?? [];
  const inactive = (await pages(req, res, cfg, `/rest/v1.0/companies/${companyId}/users/inactive`, q)) ?? [];
  const people = await pages(req, res, cfg, `/rest/v1.0/companies/${companyId}/people`, q);
  const personOf = new Map((people ?? []).filter((p) => p.user_id != null).map((p) => [String(p.user_id), p]));
  const inactiveIds = new Set(inactive.map((u) => String(u.id)));
  const seen = new Set();
  const users = [...listed, ...inactive].filter((u) => !seen.has(String(u.id)) && seen.add(String(u.id))).map((u) => {
    const p = personOf.get(String(u.id));
    const active = inactiveIds.has(String(u.id)) ? false : p ? p.contact?.is_active !== false : people ? false : u.is_active !== false;
    return { ...u, is_active: active, personId: p?.id ?? null };
  });
  const vendors = (await pages(req, res, cfg, "/rest/v1.0/vendors", { companyId, query: { company_id: companyId } })) ?? [];
  const inactiveVendors = ((await pages(req, res, cfg, `/rest/v1.0/companies/${companyId}/vendors/inactive`, q)) ?? []).map((v) => ({ ...v, is_active: false }));
  const seenV = new Set(vendors.map((v) => String(v.id)));
  return { users, vendors: [...vendors, ...inactiveVendors.filter((v) => !seenV.has(String(v.id)))] };
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SiteSnap AI · Test people</title>
<style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#000;color:#f5efe6;max-width:720px;margin:0 auto;padding:24px 16px}
button{font:inherit;font-size:19px;font-weight:700;padding:14px 20px;border:0;border-radius:14px;background:#ffb81c;color:#1f1a14;width:100%;margin:8px 0}
button:disabled{opacity:.5}select{font:inherit;font-size:17px;width:100%;padding:12px;border-radius:12px;background:#221d18;color:#f5efe6;border:1px solid #3a332b}
.row{display:flex;gap:10px;align-items:flex-start;background:#221d18;border-radius:12px;padding:10px 14px;margin:6px 0}.row input{width:22px;height:22px;margin-top:2px;flex:none}
.ok{color:#30d158}.bad{color:#ff5f57}.tag{font-size:13px;color:#ffc24d}a{color:#ffc24d}small{color:#b8ac9c}h2{margin-top:28px}</style></head>
<body><h1>Test companies and people</h1>
<p>Adds test companies and people to the project you pick: job title, phones, company, and tag. Project Managers get the Project Manager role; supervisors and workers get none (their job title shows). Permission templates follow Ky's matching: Ironbridge (the GC) is Internal (Project Manager, or Foreman / Superintendent); everyone at the other companies is Subcontractor - External. Running it again updates the same records, never duplicates. Everything is made up; emails go to your Gmail with +addresses. It goes slowly on purpose (Procore allows about 25 calls per 10 seconds): give it about 5 minutes and keep this page open.</p>
<p>First it makes your <b>earlier test people inactive</b> (Procore has no delete), then adds the 16 test people, then makes the earlier test companies inactive once their people are gone. You see the list and choose before anything changes. Procore's own test records, Architect TEST Company, and you are never touched.</p>
<p id="who"><small>Checking your Procore sign-in…</small></p>
<label for="p">Project</label> <select id="p"></select>
<button id="check" disabled>Check What's There</button>
<div id="plan"></div>
<button id="run" hidden>Make Ticked Ones Inactive and Add Test People</button>
<button id="templates" hidden>Set Permission Templates (16 people)</button>
<button id="verify" hidden>Verify</button>
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
    $('#run').hidden=false; $('#templates').hidden=false; $('#verify').hidden=false; window.seedList=b.seed;
  }catch(e){ $('#plan').innerHTML='<p class="bad">'+esc(e.message)+'</p>'; }
  $('#check').disabled=false;
};
const show=(steps)=>{ $('#out').innerHTML+=steps.map(s=>'<div class="row"><span><b class="'+(s.ok?'ok':'bad')+'">'+(s.ok?'✓':'✗')+' '+esc(s.name)+'</b><br><small>'+esc(s.detail)+'</small></span></div>').join(''); };
$('#verify').onclick=async()=>{
  $('#verify').disabled=true; $('#out').innerHTML='<h2>Verify</h2><p><small>Reading the directory…</small></p>';
  try{ show((await post({action:'verify'})).steps); }catch(e){ $('#out').innerHTML+='<p class="bad">'+esc(e.message)+'</p>'; }
  $('#verify').disabled=false;
};
$('#templates').onclick=async()=>{
  $('#templates').disabled=true; $('#out').innerHTML='<h2>Permission templates</h2>';
  try{
    for(const c of (window.seedList||[]).filter(c=>c.size)){ $('#out').innerHTML+='<p><small>'+esc(c.name)+'…</small></p>'; show((await post({action:'templates',index:c.index})).steps); }
    $('#out').innerHTML+='<h2>Verify</h2>'; show((await post({action:'verify'})).steps);
  }catch(e){ $('#out').innerHTML+='<p class="bad">'+esc(e.message)+' Wait a minute and press the button again; finished people are skipped.</p>'; }
  $('#templates').disabled=false;
};
$('#run').onclick=async()=>{
  const picked=(k)=>[...document.querySelectorAll('input[data-kind='+k+']:checked:not(:disabled)')].map(i=>i.value);
  $('#run').disabled=true; $('#check').disabled=true; $('#out').innerHTML='<h2>Results</h2>';
  try{
    // A step that fails (Procore's rate limit, a timeout): wait a minute and try it once more
    const call=async(body)=>{ try{ return await post(body); }catch(e){ $('#out').innerHTML+='<p><small>'+esc(e.message)+' Waiting a minute, then trying that step again…</small></p>'; await new Promise(r=>setTimeout(r,60000)); return post(body); } };
    const vendorIds=picked('vendor');
    show((await call({action:'cleanup',userIds:picked('user'),vendorIds:[]})).steps);
    const list=window.seedList||[];
    for(const [n,c] of list.entries()){ $('#out').innerHTML+='<p><small>Company '+(n+1)+' of '+list.length+': '+esc(c.name)+'…</small></p>'; const co=await call({action:'company',index:c.index}); show(co.steps); for(let p=0;p<c.size;p++) show((await call({action:'person',index:c.index,person:p,vendorId:co.vendorId})).steps); }
    // Companies last, once their people are inactive or moved to the new test companies (Ky's sheet: people first)
    if(vendorIds.length){ $('#out').innerHTML+='<h2>Earlier companies</h2>'; show((await call({action:'cleanup',userIds:[],vendorIds})).steps); }
    $('#out').innerHTML+='<h2>Verify</h2>'; show((await call({action:'verify'})).steps);
    $('#out').innerHTML+='<p><b>Done.</b> <small>Take a screenshot of anything with a ✗ and send it to Claude. Then open SiteSnap and refresh the directory.</small></p>';
  }catch(e){ $('#out').innerHTML+='<p class="bad">'+esc(e.message)+'</p>'; }
  $('#run').disabled=false; $('#check').disabled=false;
};
</script></body></html>`;

async function plan(req, res, cfg, companyId) {
  const me = await api(req, res, cfg, "GET", "/rest/v1.0/me", { companyId, query: { company_id: companyId } });
  if (!me.ok) throw new HttpError(401, "not_connected", "Sign in with Procore again.");
  const dir = await directory(req, res, cfg, companyId);
  return { dir, plan: cleanupPlan({ ...dir, meId: me.json?.id }) };
}

async function cleanup(req, res, cfg, companyId, body) {
  const { dir, plan: p } = await plan(req, res, cfg, companyId);
  const pick = removable(p, body.userIds, body.vendorIds);
  const steps = [];
  const users = pick.users.map((row) => ({ row, user: dir.users.find((x) => String(x.id) === String(row.id)) }));
  const withPerson = users.filter((x) => x.user?.personId != null);
  if (withPerson.length) {
    const r = await api(req, res, cfg, "POST", `/rest/v2.0/companies/${companyId}/people/bulk_deactivate`, { companyId, body: { ids: withPerson.map((x) => Number(x.user.personId)) } });
    for (const { row } of withPerson) steps.push({ name: `Made inactive: ${row.name}`, ok: r.ok, detail: brief(r) });
  }
  for (const { row } of users.filter((x) => x.user?.personId == null)) {
    steps.push({ name: `Made inactive: ${row.name}`, ok: false, detail: "Procore's people list doesn't have this person, so they can't be made inactive here. Do it in Procore's Directory." });
  }
  for (const row of pick.vendors) {
    const r = await api(req, res, cfg, "PATCH", `/rest/v1.0/vendors/${row.id}`, { companyId, body: { company_id: Number(companyId), vendor: { name: row.name, is_active: false } } });
    steps.push({ name: `Made inactive: ${row.name}`, ok: r.ok, detail: brief(r) });
  }
  if (!steps.length) steps.push({ name: "Cleanup", ok: true, detail: "Nothing ticked, nothing changed." });
  return steps;
}

// Every person of one test company: their permission template on the project
async function templatesFor(req, res, cfg, companyId, projectId, company) {
  if (!company.users.length) return [{ name: `${company.vendor.name}`, ok: true, detail: "no people" }];
  const templates = await projectTemplates(req, res, cfg, companyId, projectId);
  const users = (await pages(req, res, cfg, `/rest/v1.3/companies/${companyId}/users`, { companyId })) ?? [];
  const onProject = (await pages(req, res, cfg, `/rest/v1.0/projects/${projectId}/users`, { companyId })) ?? [];
  const steps = [];
  for (const u of company.users) {
    const x = users.find((y) => lower(y.email_address) === lower(u.email_address));
    if (!x) { steps.push({ name: `${u.first_name} ${u.last_name}: permission template`, ok: false, detail: "not in the directory; run Add Test People first" }); continue; }
    steps.push(await setTemplate(req, res, cfg, companyId, projectId, templates, permissionTemplateFor(company, u), u, x.id, onProject.find((y) => String(y.id) === String(x.id))?.permission_template));
  }
  return steps;
}

// Read everything back: each person once, in the right company, exact email, tag, on the project,
// Project Role only for PMs, the permission template from permissionTemplateFor; no duplicate emails; totals for the whole directory.
async function verify(req, res, cfg, companyId, projectId) {
  const steps = [];
  const { users, vendors } = await directory(req, res, cfg, companyId);
  const active = users.filter((u) => u.is_active);
  const projectUsers = (await pages(req, res, cfg, `/rest/v1.0/projects/${projectId}/users`, { companyId })) ?? [];
  const onProject = new Set(projectUsers.map((u) => String(u.id)));
  const templateOf = (id) => projectUsers.find((u) => String(u.id) === String(id))?.permission_template;
  const roles = (await pages(req, res, cfg, "/rest/v1.0/project_roles", { companyId, query: { project_id: projectId } })) ?? [];
  const rolesOf = (id) => roles.filter((r) => String(r.user_id) === String(id)).map((r) => r.role);
  for (const c of SEED) {
    const vendor = vendors.find((v) => lower(v.name) === lower(c.vendor.name));
    const problems = [];
    if (!vendor) problems.push("company not found");
    else if (vendor.is_active === false) problems.push("company is inactive");
    for (const u of c.users) {
      const name = `${u.first_name} ${u.last_name}`;
      const hits = users.filter((x) => lower(x.email_address) === lower(u.email_address));
      const x = hits[0];
      if (!x) { problems.push(`${name}: not found`); continue; }
      if (hits.length > 1) problems.push(`${name}: ${hits.length} records with this email`);
      if (x.email_address !== u.email_address) problems.push(`${name}: email is ${x.email_address}`);
      if (!x.is_active) problems.push(`${name}: inactive`);
      if (vendor && String(x.vendor?.id) !== String(vendor.id)) problems.push(`${name}: company is ${x.vendor?.name ?? "none"}`);
      if (x.job_title !== undefined && x.job_title !== u.job_title) problems.push(`${name}: job title is ${x.job_title || "blank"}`);
      if (x.notes !== undefined && x.notes !== `${TAG}. Role type: ${u.roleType}.`) problems.push(`${name}: tag is "${x.notes ?? ""}"`);
      if (!onProject.has(String(x.id))) problems.push(`${name}: not on the project`);
      const has = rolesOf(x.id);
      if (u.projectRole && !has.some((r) => lower(r) === lower(u.projectRole))) problems.push(`${name}: no ${u.projectRole} role`);
      if (!u.projectRole && has.length) problems.push(`${name}: has role ${has.join(", ")}`);
      const tpl = templateOf(x.id)?.name;
      if (onProject.has(String(x.id)) && lower(tpl) !== lower(permissionTemplateFor(c, u))) problems.push(`${name}: template is ${tpl || "not set"}, expected ${permissionTemplateFor(c, u)}`);
    }
    steps.push({ name: `${c.vendor.name}: ${c.users.length} people`, ok: !problems.length, detail: problems.length ? problems.join("; ") : "all found: right company, email, tag, on the project, roles and permission templates as expected" });
  }
  const emails = active.map((u) => lower(u.email_address)).filter(Boolean);
  const dupes = [...new Set(emails.filter((e, i) => emails.indexOf(e) !== i))];
  steps.push({ name: "No duplicate emails", ok: !dupes.length, detail: dupes.length ? dupes.join(", ") : "none" });
  const mine = SEED.flatMap((c) => c.users);
  const count = (t) => mine.filter((u) => u.roleType === t).length;
  const test = active.filter((u) => isSeedEmail(u.email_address)).length;
  const procore = active.filter((u) => lower(u.email_address).endsWith("@procore.com")).length;
  steps.push({ name: "Totals", ok: true, detail: `Test people: ${count("PM")} PM, ${count("GC")} GC, ${count("Worker")} Worker. Active in the company directory: ${active.length} people (${test} SiteSnap test people, ${procore} Procore test accounts, ${active.length - test - procore} others).` });
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
    await checkProject(req, res, cfg, companyId, projectId);

    if (body.action === "plan") {
      const { plan: p } = await plan(req, res, cfg, companyId);
      const seed = SEED.map((c, index) => ({ index, size: c.users.length, name: c.vendor.name, vendor: p.vendors.some((v) => v.action === "reuse" && lower(v.name) === lower(c.vendor.name)) ? "already there, will be updated" : "new", people: c.users.map((u) => `${u.first_name} ${u.last_name}`) }));
      return sendJson(res, 200, { ...p, seed });
    }
    const seed = SEED[Number(body.index)];
    const who = seed?.users[Number(body.person)];
    let out;
    if (body.action === "cleanup") out = { steps: await cleanup(req, res, cfg, companyId, body) };
    else if (body.action === "verify") out = { steps: await verify(req, res, cfg, companyId, projectId) };
    else if (body.action === "templates" && seed) out = { steps: await templatesFor(req, res, cfg, companyId, projectId, seed) };
    else if (body.action === "company" && seed) out = await addCompany(req, res, cfg, companyId, projectId, seed);
    else if (body.action === "person" && who) out = { steps: await addPerson(req, res, cfg, companyId, projectId, seed, who, body.vendorId, permissionTemplateFor) };
    else throw new HttpError(400, "bad_request", "Unknown step.");
    console.log("SiteSnap seed", body.action, body.index ?? "", body.person ?? "", JSON.stringify(out.steps));
    return sendJson(res, 200, out);
  } catch (err) {
    // Our own messages only (never a token): so a failed run can be read in the Vercel logs
    if (err instanceof HttpError) console.log("SiteSnap seed stopped", err.status, err.code, err.message);
    sendError(res, err);
  }
}
