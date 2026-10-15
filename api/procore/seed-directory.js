// Test companies and people for the Procore sandbox (Ky's sitesnap_test_users.md, data in api/_seedDirectory.js).
// GET  /api/procore/seed-directory : a small page (sign in with Procore first): pick the project, Check, then Run.
// POST { action: "plan" }      : reads the company directory and says what the cleanup would touch. Nothing changes.
// POST { action: "cleanup" }   : makes the ticked earlier test people and companies inactive (Procore has no delete
//                                for either). The plan is worked out again here, so only "remove" / "ask" rows can
//                                change: never the signed-in person, @procore.com users or Architect TEST Company.
// POST { action: "company", index }         : one test company: create it (or update it), add it to the project.
// POST { action: "person", index, person }  : one of its people: create (or update and reactivate), add to the
//                                project, and give a Project Role the project has (see projectRoleFor).
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
import { procoreSend } from "../_procoreWrite.js";
import { SEED, cleanupPlan, projectRoleFor, removable, userBody, vendorBody } from "../_seedDirectory.js";

const brief = (r) => (r.ok ? `ok (${r.status})` : `Procore answered ${r.status}: ${JSON.stringify(r.json?.errors ?? r.json?.message ?? r.json?.error ?? r.json ?? "").slice(0, 300)}`);
const lower = (s) => String(s ?? "").trim().toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- paced Procore calls ----------

export const pace = { gapMs: 500, spikeWaitMs: 10_500 }; // 20 calls per 10 s at most; tests set both to 0
let lastCall = 0;
async function api(req, res, cfg, method, path, opts) {
  for (let attempt = 0; ; attempt++) {
    const wait = lastCall + pace.gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const r = await procoreSend(req, res, cfg, method, path, opts);
    if (r.status !== 429 || attempt >= 1) return r;
    await sleep(pace.spikeWaitMs);
  }
}

// Every page of a list; null when Procore refuses it (403 / 404), so a missing permission doesn't stop the run
async function pages(req, res, cfg, path, { companyId, query = {} }) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const r = await api(req, res, cfg, "GET", path, { companyId, query: { ...query, page, per_page: 100 } });
    if (r.status === 403 || r.status === 404) return null;
    if (r.status === 401) throw new HttpError(401, "not_connected", "Your Procore sign-in ran out. Sign in with Procore again.");
    if (!r.ok) throw new HttpError(502, "procore_failed", `Procore answered ${r.status} reading ${path.replace(/\d{3,}/g, "…")}. Wait a minute and run it again.`);
    if (!Array.isArray(r.json)) break;
    out.push(...r.json);
    if (r.json.length < 100) break;
  }
  return out;
}

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
<p>Adds 4 test companies (Ironbridge, VoltLine, ClearFlow, Summit) and 16 people to the project you pick: job title, phones, company, and a Project Role for each. Permission templates are left for later. Everything is made up; emails go to your Gmail with +addresses. It goes slowly on purpose (Procore allows about 25 calls per 10 seconds): give it about 5 minutes and keep this page open.</p>
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
    // A step that fails (Procore's rate limit, a timeout): wait a minute and try it once more
    const call=async(body)=>{ try{ return await post(body); }catch(e){ $('#out').innerHTML+='<p><small>'+esc(e.message)+' Waiting a minute, then trying that step again…</small></p>'; await new Promise(r=>setTimeout(r,60000)); return post(body); } };
    show((await call({action:'cleanup',userIds:picked('user'),vendorIds:picked('vendor')})).steps);
    for(let i=0;i<4;i++){ $('#out').innerHTML+='<p><small>Company '+(i+1)+' of 4…</small></p>'; const co=await call({action:'company',index:i}); show(co.steps); for(let p=0;p<4;p++) show((await call({action:'person',index:i,person:p,vendorId:co.vendorId})).steps); }
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

// The test company's vendor record, by name (active, else inactive). The company step hands its id on, because
// Procore's search doesn't find a company created seconds ago; else search, then the whole list.
async function findVendor(req, res, cfg, companyId, name, knownId) {
  if (procoreId(String(knownId ?? ""))) {
    const r = await api(req, res, cfg, "GET", `/rest/v1.0/vendors/${knownId}`, { companyId, query: { company_id: companyId } });
    if (r.ok && lower(r.json?.name) === lower(name)) return r.json;
  }
  const searched = (await pages(req, res, cfg, "/rest/v1.0/vendors", { companyId, query: { company_id: companyId, "filters[search]": name } })) ?? [];
  const hit = searched.find((v) => lower(v.name) === lower(name))
    ?? ((await pages(req, res, cfg, "/rest/v1.0/vendors", { companyId, query: { company_id: companyId } })) ?? []).find((v) => lower(v.name) === lower(name));
  if (hit) return hit;
  const inactive = (await pages(req, res, cfg, `/rest/v1.0/companies/${companyId}/vendors/inactive`, { companyId })) ?? [];
  return inactive.find((v) => lower(v.name) === lower(name)) ?? null;
}

async function addCompany(req, res, cfg, companyId, projectId, seed) {
  const steps = [];
  const found = await findVendor(req, res, cfg, companyId, seed.vendor.name);
  const vr = found
    ? await api(req, res, cfg, "PATCH", `/rest/v1.0/vendors/${found.id}`, { companyId, body: vendorBody(companyId, seed.vendor) })
    : await api(req, res, cfg, "POST", "/rest/v1.0/vendors", { companyId, body: vendorBody(companyId, seed.vendor) });
  const vendorId = vr.ok ? vr.json?.id ?? found?.id : null;
  steps.push({ name: `${found ? "Updated" : "Created"} company: ${seed.vendor.name}`, ok: vr.ok && !!vendorId, detail: `${brief(vr)}${vendorId ? `, id ${vendorId}` : ""}` });
  if (!vendorId) return { steps };
  const onProject = (await pages(req, res, cfg, `/rest/v1.0/projects/${projectId}/vendors`, { companyId })) ?? [];
  if (onProject.some((v) => String(v.id) === String(vendorId))) steps.push({ name: "Company on the project", ok: true, detail: "already there" });
  else {
    const r = await api(req, res, cfg, "POST", `/rest/v1.0/projects/${projectId}/vendors/${vendorId}/actions/add`, { companyId });
    steps.push({ name: "Added company to the project", ok: r.ok, detail: brief(r) });
  }
  return { steps, vendorId: String(vendorId) };
}

async function addPerson(req, res, cfg, companyId, projectId, seed, u, vendorId) {
  const steps = [];
  const step = (name, r, extra = "") => { steps.push({ name, ok: r.ok, detail: `${brief(r)}${extra}` }); return r.ok; };
  const name = `${u.first_name} ${u.last_name}`;
  const vendor = await findVendor(req, res, cfg, companyId, seed.vendor.name, vendorId);
  if (!vendor) return [{ name: `${name}: company`, ok: false, detail: `${seed.vendor.name} isn't in Procore yet, so ${u.first_name} was skipped.` }];

  // The person, by email: in the company list, else the inactive list
  const search = { companyId, query: { "filters[search]": u.email_address } };
  const byEmail = (list) => (list ?? []).find((x) => lower(x.email_address) === lower(u.email_address));
  const existing = byEmail(await pages(req, res, cfg, `/rest/v1.3/companies/${companyId}/users`, search))
    ?? byEmail(await pages(req, res, cfg, `/rest/v1.0/companies/${companyId}/users/inactive`, { companyId }));
  const ur = existing
    ? await api(req, res, cfg, "PATCH", `/rest/v1.3/companies/${companyId}/users/${existing.id}`, { companyId, body: userBody(u, vendor.id, seed.vendor, { update: true }) })
    : await api(req, res, cfg, "POST", `/rest/v1.3/companies/${companyId}/users`, { companyId, body: userBody(u, vendor.id, seed.vendor) });
  const userId = ur.ok ? ur.json?.id ?? existing?.id : null;
  if (!step(`${existing ? "Updated" : "Created"} ${name} (${u.job_title})`, ur) || !userId) return steps;

  // Active in the directory (someone made inactive earlier comes back)
  const person = ((await pages(req, res, cfg, `/rest/v1.0/companies/${companyId}/people`, search)) ?? []).find((p) => String(p.user_id) === String(userId));
  if (person && person.contact?.is_active === false) {
    step(`${name} active again`, await api(req, res, cfg, "POST", `/rest/v2.0/companies/${companyId}/people/bulk_activate`, { companyId, body: { ids: [Number(person.id)] } }));
  }

  const onProject = (await pages(req, res, cfg, `/rest/v1.0/projects/${projectId}/users`, { companyId, query: { "filters[id][]": userId } })) ?? [];
  if (onProject.some((x) => String(x.id) === String(userId))) steps.push({ name: `${name} on the project`, ok: true, detail: "already there" });
  else step(`Added ${name} to the project`, await api(req, res, cfg, "POST", `/rest/v1.0/projects/${projectId}/users/${userId}/actions/add`, { companyId, body: { user: {} } }));

  // Project Role: only a role name the project already has (Procore answers 404 for any other)
  const roles = (await pages(req, res, cfg, "/rest/v1.0/project_roles", { companyId, query: { project_id: projectId } })) ?? [];
  const names = [...new Set(roles.map((r) => r.role).filter(Boolean))];
  const role = projectRoleFor(u.projectRole, names);
  if (!role) {
    steps.push({ name: `${name}: Project Role`, ok: true, detail: `None set: this project has no "${u.projectRole}" role (it has ${names.join(", ") || "none"}). Job title shows instead.` });
  } else if (roles.some((r) => String(r.user_id) === String(userId) && lower(r.role) === lower(role))) {
    steps.push({ name: `${name}: Project Role ${role}`, ok: true, detail: "already set" });
  } else {
    step(`${name}: Project Role ${role}`, await api(req, res, cfg, "POST", "/rest/v1.0/project_roles", {
      companyId, body: { project_id: Number(projectId), project_role: { role, user_id: Number(userId) } },
    }), role !== u.projectRole ? ` (closest to "${u.projectRole}")` : "");
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
    await checkProject(req, res, cfg, companyId, projectId);

    if (body.action === "plan") {
      const { plan: p } = await plan(req, res, cfg, companyId);
      const seed = SEED.map((c) => ({ name: c.vendor.name, vendor: p.vendors.some((v) => v.action === "reuse" && lower(v.name) === lower(c.vendor.name)) ? "already there, will be updated" : "new", people: c.users.map((u) => `${u.first_name} ${u.last_name}`) }));
      return sendJson(res, 200, { ...p, seed });
    }
    const seed = SEED[Number(body.index)];
    const who = seed?.users[Number(body.person)];
    let out;
    if (body.action === "cleanup") out = { steps: await cleanup(req, res, cfg, companyId, body) };
    else if (body.action === "company" && seed) out = await addCompany(req, res, cfg, companyId, projectId, seed);
    else if (body.action === "person" && who) out = { steps: await addPerson(req, res, cfg, companyId, projectId, seed, who, body.vendorId) };
    else throw new HttpError(400, "bad_request", "Unknown step.");
    console.log("SiteSnap seed", body.action, body.index ?? "", body.person ?? "", JSON.stringify(out.steps));
    return sendJson(res, 200, out);
  } catch (err) {
    // Our own messages only (never a token): so a failed run can be read in the Vercel logs
    if (err instanceof HttpError) console.log("SiteSnap seed stopped", err.status, err.code, err.message);
    sendError(res, err);
  }
}
