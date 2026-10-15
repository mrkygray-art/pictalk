// Demo staging (Ky's sitesnap-demo-seed-and-reset.md): fills the three demo projects in Procore's sandbox with
// the scenarios in api/_demoScenarios.js, in small batches, and shows where each one stands, built for a phone
// screenshot. Private: not linked anywhere, noindex, and every request is checked on the server:
//   Procore's sandbox only, DEMO_MODE=true (else 404), signed in with Procore, and a Procore admin (only admins
//   can read a company permission template's details; the same test api/procore/access.js relies on).
// Settings (Vercel env): DEMO_MODE=true, DEMO_PROJECT_IDS=HP:<id>,WG:<id>,LV:<id> (the allowlist: nothing
// outside these projects is ever touched), optional IMPORT_BATCH_SIZE (3) and IMPORT_DELAY_MS (500).
// GET  /api/procore/demo-staging : the page.
// POST { action: "state" }                          : every scenario's row (saved to SiteSnap's copy first).
// POST { action: "createprojects" }                 : setup: makes the three demo projects in Procore (POST
//                                                    /rest/v1.0/projects {company_id, project: {name}}); one that
//                                                    already exists by name is reused. Answers the DEMO_PROJECT_IDS line.
// POST { action: "people", code, company[, person, vendorId] } : one demo company / person on that project.
// POST { action: "import", mode: next | selected | failed, ids? } : at most IMPORT_BATCH_SIZE, one at a time;
//                                                    a 429 stops the batch. Each scenario resumes where it stopped.
// POST { action: "reimport", id }                   : removes its old record (reset rules), then imports it.
// POST { action: "mark", id, procoreId }            : Ky made it by hand in Procore: record that id.
// POST { action: "reset", code, dryRun }            : one project: delete (else close + rename) tagged records,
//                                                    clear their SiteSnap threads, rows back to "not imported".
// POST { action: "deletecheck", code }              : creates a test Observation and Punch Item, closes, edits
//                                                    and deletes them, and says what Procore allowed.
// Same-origin JSON for the POSTs. Never returns a token.
import { createHash } from "node:crypto";
import { config, HttpError, procoreGet, procoreId, readBody, readCookies, requireSameOriginJson, SESSION_COOKIE, sendError, sendJson } from "../_procore.js";
import { listProjects } from "../_projects.js";
import { addCompany, addPerson, api, pace } from "../_seedSteps.js";
import {
  PROJECTS, SCENARIOS, batchSize, copyForClaude, delayMs, demoMode, demoProjects, directorySeed, plannedShape,
  scenarioById, stepsFor,
} from "../_demoScenarios.js";
import { allRows, deleteCheck, importScenario, projectContext, removeOne, resetProject, store, writeThread } from "../_demoImport.js";
import { isPlaceholder } from "../_demoPhotos.js";
import { recordUrl } from "../_records.js";

// ---------- who may use it ----------

// A brand-new project has no permission templates yet, so try the company's projects until one lists some
async function isAdmin(req, res, cfg, companyId, projectIds) {
  for (const projectId of projectIds.slice(0, 6)) {
    const list = await api(req, res, cfg, "GET", `/rest/v1.0/projects/${projectId}/permission_templates`, { companyId });
    const first = Array.isArray(list.json) ? list.json[0] : null;
    if (!list.ok || !first?.id) continue;
    const one = await api(req, res, cfg, "GET", `/rest/v1.0/companies/${companyId}/permission_templates/${first.id}`, { companyId });
    return one.ok;
  }
  return false;
}

// The check costs about five Procore calls (companies, projects, two template reads, me), so a warm server
// remembers it for a few minutes per sign-in: a page pressing button after button stays under Procore's limit.
const GUARD_MS = 5 * 60 * 1000;
const guardCache = new Map();
const guardKey = (req) => createHash("sha256").update(`${readCookies(req)[SESSION_COOKIE] ?? ""}|${process.env.DEMO_PROJECT_IDS ?? ""}`).digest("hex");
export const forgetGuards = () => guardCache.clear();

async function guard(req, res, cfg) {
  const key = guardKey(req);
  const hit = guardCache.get(key);
  if (hit && Date.now() - hit.at < GUARD_MS) return hit.g;
  const g = await checkGuard(req, res, cfg);
  guardCache.set(key, { g, at: Date.now() });
  return g;
}

async function checkGuard(req, res, cfg) {
  const { projects } = await listProjects(req, res, cfg);
  const ids = demoProjects();
  const demo = ids ? Object.fromEntries(Object.entries(ids).map(([code, id]) => {
    const p = projects.find((x) => x.projectId === id);
    return [code, p ? { code, companyId: p.companyId, projectId: id, name: p.name } : { code, projectId: id, missing: true }];
  })) : null;
  const anchor = (demo && Object.values(demo).find((p) => !p.missing)) ?? projects[0];
  if (!anchor) throw new HttpError(403, "no_projects", "Your Procore account has no projects here.");
  const tryIds = [anchor.projectId, ...projects.filter((p) => p.companyId === anchor.companyId && p.projectId !== anchor.projectId).map((p) => p.projectId)];
  if (!(await isAdmin(req, res, cfg, anchor.companyId, tryIds))) throw new HttpError(403, "not_admin", "Only Procore admins can use this page.");
  const me = await procoreGet(req, res, cfg, "/rest/v1.0/me", { companyId: anchor.companyId, query: { company_id: anchor.companyId } });
  return { projects, demo, ids, me: { id: me?.id, name: me?.name || "Ky" } };
}

// The allowlisted demo project for a code, or a plain refusal
function need(g, code) {
  if (!g.demo) throw new HttpError(409, "not_configured", "Set DEMO_PROJECT_IDS in Vercel first (see Setup).");
  const p = g.demo[String(code ?? "").toUpperCase()];
  if (!p) throw new HttpError(400, "bad_request", "Unknown demo project.");
  if (p.missing) throw new HttpError(403, "no_access", `You can't open ${p.code} (project ${p.projectId}) in Procore.`);
  return p;
}

// ---------- the page's data ----------

async function state(g) {
  const st = await store();
  const rows = await allRows(st, g.ids);
  const meta = await st.meta();
  const count = (k) => rows.filter((r) => r.import_status === k).length;
  const imported = {};
  for (const code of Object.keys(PROJECTS)) {
    const mine = rows.filter((r) => r.project_code === code && r.import_status === "imported").map((r) => scenarioById(r.id));
    imported[code] = { open: mine.filter((s) => s.planned !== "closed").length, overdue: mine.filter((s) => s.planned === "overdue").length, closed: mine.filter((s) => s.planned === "closed").length };
  }
  return {
    configured: !!g.demo, demo: g.demo, me: g.me,
    choices: g.demo ? null : g.projects.map((p) => ({ projectId: p.projectId, name: p.name })),
    projects: PROJECTS, batchSize: batchSize(),
    scenarios: SCENARIOS.map((s) => ({ id: s.id, project: s.project, title: s.title, recordType: s.recordType, planned: s.planned, due: s.due, steps: stepsFor(s), placeholder: !!isPlaceholder[s.id] })),
    rows: rows.map((r) => ({ id: r.id, import_status: r.import_status, procore_id: r.procore_id ?? null, url: r.url ?? null, steps_completed: r.steps_completed ?? [], last_error: r.last_error ?? null, last_attempt_at: r.last_attempt_at ?? null, manual: !!r.manual })),
    summary: { total: rows.length, imported: count("imported"), not_imported: count("not_imported"), partial: count("partial"), failed: count("failed") },
    shape: { planned: plannedShape(), imported },
    lastImportAt: meta.lastImportAt ?? null,
    deleteCheck: meta.deleteCheck ? { observationDelete: meta.deleteCheck.observationDelete, punchDelete: meta.deleteCheck.punchDelete, at: meta.deleteCheck.at } : null,
    copyText: copyForClaude(rows, { lastRun: meta.lastImportAt ?? null }),
  };
}

// Setup: the three demo projects, by name, in the signed-in admin's company (made only when missing)
async function createProjects(req, res, cfg, g) {
  const companyId = (g.demo && Object.values(g.demo).find((p) => !p.missing)?.companyId) ?? g.projects[0]?.companyId;
  const steps = [];
  const ids = {};
  for (const [code, p] of Object.entries(PROJECTS)) {
    const found = g.projects.find((x) => x.companyId === companyId && x.name.trim().toLowerCase() === p.name.toLowerCase());
    if (found) { ids[code] = found.projectId; steps.push({ name: `${code}: ${p.name}`, ok: true, detail: `already there (project ${found.projectId})` }); continue; }
    const r = await api(req, res, cfg, "POST", "/rest/v1.0/projects", { companyId, body: { company_id: Number(companyId), project: { name: p.name, active: true } } });
    if (r.ok && r.json?.id) ids[code] = String(r.json.id);
    steps.push({ name: `${code}: ${p.name}`, ok: r.ok && !!r.json?.id, detail: r.ok ? `created (project ${r.json?.id})` : `Procore answered ${r.status}: ${JSON.stringify(r.json?.errors ?? r.json?.message ?? r.json?.error ?? "").slice(0, 300)}` });
  }
  const line = ids.HP && ids.WG && ids.LV ? `HP:${ids.HP},WG:${ids.WG},LV:${ids.LV}` : null;
  console.log("SiteSnap demo create projects", JSON.stringify(steps));
  return { steps, line };
}

async function importBatch(req, res, cfg, g, body) {
  const st = await store();
  const rows = await allRows(st, g.ids);
  const wanted = new Set((Array.isArray(body.ids) ? body.ids : []).map(String));
  let pick = body.mode === "selected" ? rows.filter((r) => wanted.has(r.id) && r.import_status !== "imported")
    : body.mode === "failed" ? rows.filter((r) => r.import_status === "failed" || r.import_status === "partial")
      : rows.filter((r) => r.import_status !== "imported");
  pick = pick.slice(0, batchSize());
  const contexts = {};
  const results = [];
  let rateLimited = false;
  for (const [i, row] of pick.entries()) {
    const s = scenarioById(row.id);
    try {
      const p = need(g, s.project);
      contexts[s.project] ??= await projectContext(req, res, cfg, { companyId: p.companyId, projectId: p.projectId, me: g.me });
      const out = await importScenario(contexts[s.project], s, row);
      results.push({ id: s.id, status: out.row.import_status, error: out.row.last_error });
      if (out.rateLimited) rateLimited = true;
    } catch (err) {
      if (err instanceof HttpError && err.status === 429) rateLimited = true;
      else if (err instanceof HttpError && [401].includes(err.status)) throw err;
      else {
        const msg = err instanceof HttpError ? err.message : "Something went wrong on the server (see the Vercel logs).";
        if (!(err instanceof HttpError)) console.error("SiteSnap demo import failed", s.id, err?.name ?? "Error", String(err?.message ?? "").slice(0, 200));
        await st.saveRow(s.id, { ...row, last_error: `Step 1 of ${stepsFor(s).length} failed (start): ${msg}`, last_attempt_at: Date.now() });
        results.push({ id: s.id, status: "failed", error: msg });
        continue;
      }
    }
    if (rateLimited) {
      // Stop here: the rest of the batch is told to wait, nothing else is sent to Procore
      for (const rest of pick.slice(i + (results.some((r) => r.id === s.id) ? 1 : 0))) {
        await st.saveRow(rest.id, { ...rest, last_error: "429 rate limited, retry later", last_attempt_at: Date.now() });
        results.push({ id: rest.id, status: "waiting", error: "429 rate limited, retry later" });
      }
      break;
    }
  }
  await st.saveMeta({ lastImportAt: Date.now() });
  console.log("SiteSnap demo import", body.mode ?? "next", JSON.stringify(results.map((r) => ({ id: r.id, status: r.status }))));
  return { results, rateLimited, picked: pick.length };
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>SiteSnap AI · Demo staging</title>
<style>*{box-sizing:border-box}body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#000;color:#f5efe6;max-width:720px;margin:0 auto;padding:16px;font-size:17px;overflow-x:hidden}
h1{font-size:26px;margin:4px 0 8px}h2{font-size:21px;margin:22px 0 6px}a{color:#ffc24d}small,.muted{color:#b8ac9c}
button{font:inherit;font-weight:700;padding:13px 16px;border:0;border-radius:14px;background:#ffb81c;color:#1f1a14;width:100%;margin:6px 0}
button.ghost{background:#2c261f;color:#f5efe6;border:1px solid #4a4036}button.small{width:auto;padding:8px 12px;font-size:15px;margin:6px 6px 0 0}button.danger{background:#ff5f57;color:#1a0d0c}
button:disabled{opacity:.5}select,input[type=text]{font:inherit;width:100%;padding:11px;border-radius:12px;background:#221d18;color:#f5efe6;border:1px solid #3a332b;margin:4px 0}
.sum{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:10px 0}.sum div{background:#221d18;border-radius:12px;padding:8px 4px;text-align:center}.sum b{display:block;font-size:30px;line-height:1.1}.sum span{font-size:13px}
.card{background:#221d18;border-radius:12px;padding:10px 12px;margin:8px 0;overflow-wrap:anywhere}.top{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.top input{width:24px;height:24px;flex:none}
.id{font-weight:800;font-size:19px}.pill{font-size:14px;font-weight:800;padding:3px 9px;border-radius:999px;color:#14110d}
.s-imported{background:#30d158}.s-not_imported{background:#8e8e93}.s-failed{background:#ff5f57}.s-partial{background:#ffb81c}.s-waiting{background:#8e8e93}
.ttl{font-size:18px;font-weight:600;margin:4px 0 2px}.err{color:#ff8a84;font-size:15px;margin-top:4px}.ok{color:#30d158}.bad{color:#ff5f57}
table{width:100%;border-collapse:collapse;font-size:15px}td,th{padding:4px;text-align:center;border-bottom:1px solid #3a332b}th:first-child,td:first-child{text-align:left}
details{background:#15120f;border-radius:12px;padding:8px 12px;margin:10px 0}summary{font-weight:700;cursor:pointer;padding:4px 0}
label.tog{display:flex;gap:10px;align-items:center;font-weight:700;margin:8px 0}label.tog input{width:24px;height:24px}pre{white-space:pre-wrap;font-size:13px;color:#d8ccbb}</style></head>
<body><h1>Demo staging</h1>
<p id="who" class="muted">Checking your Procore sign-in…</p>
<div id="app" hidden>
<div class="sum"><div><b id="n-total">0</b><span>Total</span></div><div style="color:#30d158"><b id="n-imported">0</b><span>Imported</span></div><div style="color:#c7c7cc"><b id="n-not">0</b><span>Not imported</span></div><div style="color:#ff5f57"><b id="n-failed">0</b><span>Failed / partial</span></div></div>
<p class="muted" id="lastrun"></p>
<div id="setup"></div>
<div id="controls">
<button id="next">Import Next Batch</button>
<button id="sel" class="ghost">Import Selected</button>
<button id="retry" class="ghost">Retry Failed</button>
<button id="copy" class="ghost">Copy for Claude</button>
<label class="tog"><input type="checkbox" id="only"> Show only not imported</label><small>(for the screenshot; Mark Imported and Re-import show when it's off)</small>
</div>
<p id="busy" class="muted" aria-live="polite"></p>
<div id="list"></div>
<h2>Dashboard shape</h2><div id="shape"></div>
<details id="more"><summary>Setup and reset</summary>
<p><b>1. Demo people.</b> Adds the demo companies and people to each project's Directory, with permission templates (once per project; running it again updates, never duplicates).</p><div id="people"></div>
<p><b>2. Delete check.</b> Creates a test Observation and Punch Item in Harbor Point, closes them, edits them, and deletes them. Reset uses what Procore allows.</p><button id="delcheck" class="ghost">Run Delete Check</button><div id="delout"></div>
<p><b>3. Reset.</b> Only records tagged [SS-DEMO] in the three demo projects. Records Procore won't delete are closed and renamed [SS-DEMO][ARCHIVED].</p>
<button id="dry" class="ghost">Preview Reset (changes nothing)</button><button id="reset" class="danger">Reset Demo</button><div id="resetout"></div>
</details>
</div>
<script>
const $=(s)=>document.querySelector(s); let S=null;
const esc=(s)=>String(s??'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const LABEL={imported:'Imported',not_imported:'Not imported',failed:'Failed',partial:'Partial',waiting:'Waiting'};
const PLAN={open:'Open',overdue:'Overdue',closed:'Closed'};
const post=async(body)=>{ const r=await fetch('/api/procore/demo-staging',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const b=await r.json().catch(()=>({message:'No answer from the server'})); if(!r.ok){ const e=new Error(b.message||'Failed'); e.status=r.status; throw e; } return b; };
// Procore said slow down (429): wait a minute, then try that step once more
const post2=async(body,note)=>{ try{ return await post(body); }catch(e){ if(!/429|slow down|rate/i.test(e.message)) throw e; if(note) note('Procore said slow down. Waiting a minute, then trying that step again…'); await new Promise(r=>setTimeout(r,60000)); return post(body); } };
const when=(t)=>t?new Date(t).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'never';
const busy=(t)=>{ $('#busy').textContent=t||''; document.querySelectorAll('button').forEach(b=>b.disabled=!!t); };
function render(){
  const m=S.summary; $('#n-total').textContent=m.total; $('#n-imported').textContent=m.imported; $('#n-not').textContent=m.not_imported; $('#n-failed').textContent=m.failed+m.partial;
  $('#lastrun').textContent='Last import run: '+when(S.lastImportAt)+' · batch size '+S.batchSize;
  const only=$('#only').checked; const rowOf=Object.fromEntries(S.rows.map(r=>[r.id,r]));
  let html='';
  for(const code of ['HP','WG','LV']){
    const p=S.projects[code]; const list=S.scenarios.filter(s=>s.project===code).filter(s=>!only||rowOf[s.id].import_status!=='imported');
    html+='<h2>'+code+' · '+esc(p.name)+'</h2><p class="muted" style="margin:0">'+esc(p.stage)+(S.demo&&S.demo[code]?' · Procore project '+esc(S.demo[code].projectId)+(S.demo[code].missing?' <span class="bad">(you can\\'t open it)</span>':''):'')+'</p>';
    if(!list.length) html+='<p class="muted">All imported.</p>';
    for(const s of list){ const r=rowOf[s.id]; const st=r.import_status;
      html+='<div class="card"><div class="top"><input type="checkbox" data-id="'+s.id+'"'+(st==='imported'?' disabled':'')+' aria-label="Select '+s.id+'"><span class="id">'+s.id+'</span><span class="pill s-'+st+'">'+LABEL[st]+'</span></div>'
        +'<div class="ttl">'+esc(s.title)+'</div><small>'+(s.recordType==='punch_item'?'Punch Item':'Observation')+' · planned '+PLAN[s.planned]+' · due '+(s.due===0?'today':s.due>0?'in '+s.due+' day'+(s.due>1?'s':''):(-s.due)+' day'+(s.due<-1?'s':'')+' ago')+'</small>'
        +'<div><small>Procore ID: '+(r.procore_id?(r.url?'<a href="'+esc(r.url)+'" target="_blank" rel="noopener">'+esc(r.procore_id)+'</a>':esc(r.procore_id)):'—')+(r.manual?' (marked by hand)':'')+' · steps '+r.steps_completed.length+'/'+s.steps.length+(s.placeholder?' · placeholder photo':'')+'</small></div>'
        +(r.last_error?'<div class="err">'+esc(r.last_error)+'</div>':'')
        +(only?'':'<button class="small ghost" data-mark="'+s.id+'">Mark Imported…</button>'+(r.procore_id?'<button class="small ghost" data-re="'+s.id+'">Re-import</button>':''))+'</div>'; }
  }
  $('#list').innerHTML=html;
  const sh=S.shape; $('#shape').innerHTML='<table><tr><th>Project</th><th>Open</th><th>Overdue</th><th>Closed</th></tr>'+['HP','WG','LV'].map(c=>'<tr><td>'+c+'</td>'+['open','overdue','closed'].map(k=>'<td class="'+(sh.imported[c][k]===sh.planned[c][k]?'ok':'')+'">'+sh.imported[c][k]+' / '+sh.planned[c][k]+'</td>').join('')+'</tr>').join('')+'</table><small>In Procore (imported) / planned. Overdue counts within Open.</small>';
  if(S.deleteCheck) $('#delout').innerHTML='<p><small>Last check '+when(S.deleteCheck.at)+': Observation delete '+(S.deleteCheck.observationDelete?'<span class="ok">allowed</span>':'<span class="bad">not allowed</span>')+', Punch Item delete '+(S.deleteCheck.punchDelete?'<span class="ok">allowed</span>':'<span class="bad">not allowed</span>')+'.</small></p>';
  renderSetup(); renderPeople();
}
function renderSetup(){
  if(S.configured){ $('#setup').innerHTML=''; return; }
  const opts=S.choices.map(p=>'<option value="'+esc(p.projectId)+'">'+esc(p.name)+' ('+esc(p.projectId)+')</option>').join('');
  $('#setup').innerHTML='<div class="card"><b>Setup: the three demo projects</b><p><small>Press Create Demo Projects (or pick them below if they already exist). Then copy the value under the boxes into Vercel as DEMO_PROJECT_IDS (Config, Production) and redeploy. Nothing outside these three projects is ever touched.</small></p>'
    +'<button id="mkproj">Create Demo Projects in Procore</button><div id="mkout"></div>'
    +['HP','WG','LV'].map(c=>'<label>'+c+' · '+esc(S.projects[c].name)+'<select data-code="'+c+'"><option value="">Pick…</option>'+opts+'</select></label>').join('')
    +'<p><small>Value for DEMO_PROJECT_IDS:</small></p><pre id="envline" style="font-size:17px;color:#ffc24d"></pre><button id="copyline" class="ghost">Copy the Value</button></div>';
  const line=()=>{ const v=[...document.querySelectorAll('#setup select')].map(x=>x.dataset.code+':'+(x.value||'?')).join(','); $('#envline').textContent=v; return v; };
  document.querySelectorAll('#setup select').forEach(sel=>{ const want=S.projects[sel.dataset.code].name.toLowerCase(); const hit=S.choices.find(p=>p.name.trim().toLowerCase()===want); if(hit) sel.value=hit.projectId; sel.onchange=line; });
  line();
  $('#copyline').onclick=async()=>{ const v=line(); if(v.includes('?')) return alert('Pick all three projects first.'); try{ await navigator.clipboard.writeText(v); $('#copyline').textContent='Copied'; }catch(e){ prompt('Copy this:',v); } };
  $('#mkproj').onclick=async()=>{ busy('Creating the demo projects in Procore…'); try{ const b=await post({action:'createprojects'}); S=await post({action:'state'}); render(); $('#mkout').innerHTML=b.steps.map(s=>'<div class="card"><b class="'+(s.ok?'ok':'bad')+'">'+(s.ok?'✓':'✗')+' '+esc(s.name)+'</b><br><small>'+esc(s.detail)+'</small></div>').join(''); }catch(e){ alert(e.message); } busy(''); };
  $('#controls').hidden=true;
}
function renderPeople(){ $('#people').innerHTML=S.configured?['HP','WG','LV'].map(c=>'<button class="ghost" data-people="'+c+'">Add Demo People to '+c+'</button>').join('')+'<div id="peopleout"></div>':'<p class="muted">After setup.</p>'; }
async function load(){ try{ S=await post({action:'state'}); $('#who').innerHTML='<small>Signed in as '+esc(S.me.name)+' (Procore admin).</small>'; $('#app').hidden=false; render(); }
  catch(e){ $('#who').innerHTML=e.status===401?'Not signed in. <a href="/api/procore/login">Sign in with Procore</a>, then come back to this page.':'<span class="bad">'+esc(e.message)+'</span>'; } }
async function runImport(body,label){
  busy(label+'… one at a time, keep this page open.');
  try{ const b=await post({action:'import',...body}); S=await post({action:'state'}); render();
    $('#busy').textContent=b.picked?(b.rateLimited?'Procore said slow down (429). Wait a minute, then press Retry Failed.':'Batch done: '+b.results.map(r=>r.id+' '+(LABEL[r.status]||r.status)).join(', ')+'.'):'Nothing to import.'; return b; }
  catch(e){ $('#busy').textContent=''; alert(e.message); return null; } finally{ document.querySelectorAll('button').forEach(b=>b.disabled=false); }
}
$('#next').onclick=()=>runImport({mode:'next'},'Importing the next batch');
$('#retry').onclick=()=>runImport({mode:'failed'},'Retrying failed and partial ones');
$('#sel').onclick=()=>{ const ids=[...document.querySelectorAll('#list input[data-id]:checked')].map(i=>i.dataset.id); if(!ids.length) return alert('Tick the ones to import first.'); if(ids.length>S.batchSize) alert('Importing the first '+S.batchSize+' of the '+ids.length+' ticked. Press Import Selected again for the rest.'); runImport({mode:'selected',ids},'Importing the selected ones'); };
$('#only').onchange=()=>render();
$('#copy').onclick=async()=>{ try{ await navigator.clipboard.writeText(S.copyText); $('#busy').textContent='Copied. Paste it to Claude.'; }catch(e){ prompt('Copy this:',S.copyText); } };
document.addEventListener('click',async(ev)=>{
  const t=ev.target;
  if(t.dataset.mark){ const v=prompt('Procore ID of the record you made by hand for '+t.dataset.mark+':'); if(!v) return; busy('Checking it in Procore…'); try{ await post({action:'mark',id:t.dataset.mark,procoreId:v.trim()}); S=await post({action:'state'}); render(); busy(''); }catch(e){ busy(''); alert(e.message); } }
  if(t.dataset.re){ if(!confirm('Remove the old Procore record for '+t.dataset.re+' (delete, or close and rename) and import it again?')) return; busy('Re-importing '+t.dataset.re+'…'); try{ await post({action:'reimport',id:t.dataset.re}); S=await post({action:'state'}); render(); busy(''); }catch(e){ busy(''); alert(e.message); } }
  if(t.dataset.people){ const code=t.dataset.people; const out=$('#peopleout'); out.innerHTML='<h2>'+code+' people</h2>'; busy('Adding demo people to '+code+'… (a few minutes; keep this page open)');
    const show=(steps)=>{ out.innerHTML+=steps.map(s=>'<div class="card"><b class="'+(s.ok?'ok':'bad')+'">'+(s.ok?'✓':'✗')+' '+esc(s.name)+'</b><br><small>'+esc(s.detail)+'</small></div>').join(''); };
    const note=(t)=>{ out.innerHTML+='<p><small>'+esc(t)+'</small></p>'; };
    try{ const list=(await post2({action:'people',code},note)).companies;
      for(const [i,c] of list.entries()){ const co=await post2({action:'people',code,company:i},note); show(co.steps); for(let p=0;p<c.people;p++) show((await post2({action:'people',code,company:i,person:p,vendorId:co.vendorId},note)).steps); }
      out.innerHTML+='<p><b>Done.</b> <small>Screenshot anything with a ✗ and send it to Claude.</small></p>';
    }catch(e){ out.innerHTML+='<p class="bad">'+esc(e.message)+' Wait a minute and press it again; finished people are just updated.</p>'; } busy(''); }
});
$('#delcheck').onclick=async()=>{ busy('Running the delete check… (about 20 seconds)'); try{ const b=await post({action:'deletecheck',code:'HP'}); $('#delout').innerHTML=b.steps.map(s=>'<div class="card"><b class="'+(s.ok?'ok':'bad')+'">'+(s.ok?'✓':'✗')+' '+esc(s.name)+'</b><br><small>'+esc(s.detail)+'</small></div>').join('')+'<p><small>Screenshot this and send it to Claude.</small></p>'; }catch(e){ $('#delout').innerHTML='<p class="bad">'+esc(e.message)+'</p>'; } busy(''); };
const resetLine=(c,b)=>'<div class="card"><b>'+c+'</b><br><small>'+(b.dryRun?'Would remove '+b.records.length+' record(s): '+b.records.map(r=>esc(r.name)+' ('+(r.recordType==='punch_item'?'Punch Item':'Observation')+' '+r.id+')').join('; ')+'. SiteSnap threads: '+b.threads+'.':'Deleted '+b.deleted.length+', archived '+b.archived.length+', failed '+b.failed.length+', skipped '+b.skipped.length+', SiteSnap threads cleared '+b.threads+'.'+(b.archived.length?' Archived only: '+b.archived.map(r=>esc(r.name)).join('; ')+'.':'')+(b.failed.length?' Failed: '+b.failed.map(r=>esc(r.name)+' ('+esc(r.why)+')').join('; ')+'.':'')+(b.rateLimited?' Stopped: Procore said slow down (429).':''))+(b.skipped.length?' Left alone: '+b.skipped.map(r=>esc(r.name)+' ('+esc(r.why)+')').join('; ')+'.':'')+'</small></div>';
$('#dry').onclick=async()=>{ $('#resetout').innerHTML=''; busy('Looking for demo records…'); try{ for(const c of ['HP','WG','LV']) $('#resetout').innerHTML+=resetLine(c,await post({action:'reset',code:c,dryRun:true})); }catch(e){ $('#resetout').innerHTML+='<p class="bad">'+esc(e.message)+'</p>'; } busy(''); };
$('#reset').onclick=async()=>{
  if(!confirm('This removes all demo observations and punch items in the 3 demo projects and re-creates the starting set. Continue?')) return;
  $('#resetout').innerHTML=''; busy('Resetting…');
  try{ for(const c of ['HP','WG','LV']){ busy('Resetting '+c+'…'); const b=await post({action:'reset',code:c,dryRun:false}); $('#resetout').innerHTML+=resetLine(c,b); if(b.rateLimited||b.failed.length) throw new Error('Reset stopped at '+c+'. Wait a minute and press Reset Demo again.'); }
    S=await post({action:'state'}); render();
    // Re-create the starting set, one batch at a time, stopping at the first problem
    for(let n=1;S.summary.imported<S.summary.total&&n<=10;n++){ const b=await runImport({mode:'next'},'Re-creating the starting set (batch '+n+')'); if(!b||b.rateLimited||b.results.some(r=>r.status!=='imported')) break; }
  }catch(e){ $('#resetout').innerHTML+='<p class="bad">'+esc(e.message)+'</p>'; }
  busy(''); if(S) render();
};
load();
</script></body></html>`;

export default async function handler(req, res) {
  try {
    const cfg = config();
    if (!/sandbox/i.test(cfg.apiUrl) || !demoMode()) throw new HttpError(404, "not_found", "Not found.");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    if (req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      return res.end(PAGE);
    }
    if (req.method !== "POST") throw new HttpError(405, "bad_request", "Use POST.");
    requireSameOriginJson(req);
    const body = await readBody(req);
    if (pace.gapMs > 0) pace.gapMs = delayMs();
    const g = await guard(req, res, cfg);

    if (body.action === "state") return sendJson(res, 200, await state(g));
    if (body.action === "createprojects") { const out = await createProjects(req, res, cfg, g); forgetGuards(); return sendJson(res, 200, out); }
    if (body.action === "import") return sendJson(res, 200, await importBatch(req, res, cfg, g, body));

    if (body.action === "people") {
      const p = need(g, body.code);
      const seed = directorySeed(p.code);
      if (body.company == null) return sendJson(res, 200, { companies: seed.map((c) => ({ name: c.vendor.name, people: c.users.length })) });
      const c = seed[Number(body.company)];
      if (!c) throw new HttpError(400, "bad_request", "Unknown company.");
      if (body.person == null) return sendJson(res, 200, await addCompany(req, res, cfg, p.companyId, p.projectId, c));
      const u = c.users[Number(body.person)];
      if (!u) throw new HttpError(400, "bad_request", "Unknown person.");
      const steps = await addPerson(req, res, cfg, p.companyId, p.projectId, c, u, body.vendorId, (_seed, x) => x.templates);
      console.log("SiteSnap demo people", p.code, JSON.stringify(steps));
      return sendJson(res, 200, { steps });
    }

    if (body.action === "reset") {
      const p = need(g, body.code);
      const out = await resetProject(req, res, cfg, { companyId: p.companyId, projectId: p.projectId, code: p.code, dryRun: body.dryRun !== false });
      if (!out.dryRun) console.log("SiteSnap demo reset", p.code, JSON.stringify({ deleted: out.deleted.length, archived: out.archived.map((r) => r.id), failed: out.failed.map((r) => r.id), threads: out.threads }));
      return sendJson(res, 200, out);
    }

    if (body.action === "deletecheck") {
      const p = need(g, body.code ?? "HP");
      const out = await deleteCheck(req, res, cfg, { companyId: p.companyId, projectId: p.projectId });
      console.log("SiteSnap demo delete check", JSON.stringify(out.summary));
      return sendJson(res, 200, out);
    }

    const s = scenarioById(String(body.id ?? ""));
    if (!s) throw new HttpError(400, "bad_request", "Unknown scenario.");
    const p = need(g, s.project);
    const st = await store();
    const row = (await allRows(st, g.ids)).find((r) => r.id === s.id);

    if (body.action === "reimport") {
      await removeOne(req, res, cfg, { companyId: p.companyId, projectId: p.projectId, row });
      const fresh = { id: s.id, import_status: "not_imported", procore_id: null, steps_completed: [], last_error: null, last_attempt_at: null };
      await st.saveRow(s.id, fresh);
      const ctx = await projectContext(req, res, cfg, { companyId: p.companyId, projectId: p.projectId, me: g.me });
      const out = await importScenario(ctx, s, fresh);
      return sendJson(res, 200, { status: out.row.import_status, error: out.row.last_error });
    }

    if (body.action === "mark") {
      const id = procoreId(String(body.procoreId ?? ""));
      if (!id) throw new HttpError(400, "bad_request", "That isn't a Procore ID (numbers only).");
      const path = s.recordType === "observation" ? "/rest/v1.0/observations/items" : "/rest/v1.1/punch_items";
      const r = await api(req, res, cfg, "GET", `${path}/${id}`, { companyId: p.companyId, query: { project_id: p.projectId } });
      if (!r.ok) throw new HttpError(404, "not_found", `Procore has no ${s.recordType === "observation" ? "Observation" : "Punch Item"} ${id} in ${PROJECTS[s.project].name} (answered ${r.status}).`);
      const number = String((s.recordType === "observation" ? r.json?.number : r.json?.position) ?? "") || null;
      // SiteSnap's thread too, so the app matches (best effort: the row is marked either way)
      let threadOk = false;
      try {
        const ctx = await projectContext(req, res, cfg, { companyId: p.companyId, projectId: p.projectId, me: g.me });
        await writeThread(ctx, s, { procoreId: id, number });
        threadOk = true;
      } catch (err) { console.log("SiteSnap demo mark: thread not written", s.id, err?.message ?? err?.name); }
      const steps = stepsFor(s).filter((x) => x !== "thread" || threadOk);
      await st.saveRow(s.id, { ...row, record_type: s.recordType, project_code: s.project, project_id: p.projectId, procore_id: id, number, url: recordUrl(cfg.apiUrl, p.projectId, s.recordType, id), steps_completed: steps, last_error: threadOk ? null : "Marked by hand; the SiteSnap thread wasn't written (press Retry Failed).", last_attempt_at: Date.now(), manual: true });
      return sendJson(res, 200, { ok: true });
    }
    throw new HttpError(400, "bad_request", "Unknown step.");
  } catch (err) {
    if (err instanceof HttpError && err.status !== 404) console.log("SiteSnap demo staging stopped", err.status, err.code, err.message);
    sendError(res, err);
  }
}
