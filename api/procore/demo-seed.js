// Sandbox demo seed (Ky's procore-sandbox-demo-seed.md, 2026-10-18): fills three [DEMO] projects in Procore's
// sandbox with the cast, records, daily logs, inspections, photos and SiteSnap messages in api/_demoSeedData.js,
// alongside the demo staging set (api/procore/demo-staging.js), not instead of it. Notes: docs/DEMO_SEED.md.
// Private: not linked anywhere, noindex, and every request is checked on the server: Procore's sandbox only,
// DEMO_MODE=true (else 404), signed in with Procore, and a Procore admin. It only ever writes to the three projects
// named in PROJECTS (found by exact name) and deletes only what its own seed map recorded.
// The spec asked for Node scripts with a stored token; SiteSnap has none (everyone writes with their own sign-in),
// so the scripts are this page: each task is one request, the page runs them in order, and the seed map is in
// Firestore (sitesnapDemoSeed/...), not seed-map.json.
// GET  /api/procore/demo-seed (also /admin/demo-seed) : the page.
// POST { action: "state" }            : every task's row, counts, the tools still off, and Copy for Claude.
// POST { action: "next", skip[] }     : runs the first task not done (skipping ids already tried this run).
// POST { action: "run", id }          : runs one task (resumes it).
// POST { action: "undo", id }         : removes one task's data (records only while still tagged [DEMO]).
// POST { action: "redo", id }         : undo, then run.
// POST { action: "restore" }          : every seeded Observation / Punch Item back to its starting status.
// POST { action: "invite", key }      : Procore's invite email for one person (each is a real email).
import { createHash } from "node:crypto";
import { config, HttpError, procoreGet, readBody, readCookies, requireSameOriginJson, SESSION_COOKIE, sendError, sendJson } from "../_procore.js";
import { listProjects } from "../_projects.js";
import { pace } from "../_seedSteps.js";
import { demoMode } from "../_demoScenarios.js";
import { isAdmin } from "./demo-staging.js";
import {
  CODES, GROUPS, PEOPLE, PROJECTS, RECORDS, emailBase, fullName, myItemsPlan, nameOf, personByKey, taskById, tasks,
} from "../_demoSeedData.js";
import { allRows, context, invite, restoreStatuses, runTask, store, undoPlan, undoTask, UNDOABLE } from "../_demoSeedRun.js";

// ---------- who may use it (same check as demo staging, remembered a few minutes per sign-in) ----------

const GUARD_MS = 5 * 60 * 1000;
const guardCache = new Map();
export const forgetSeedGuards = () => guardCache.clear();

async function guard(req, res, cfg) {
  const key = createHash("sha256").update(`seed|${readCookies(req)[SESSION_COOKIE] ?? ""}`).digest("hex");
  const hit = guardCache.get(key);
  if (hit && Date.now() - hit.at < GUARD_MS) return hit.g;
  const { projects } = await listProjects(req, res, cfg);
  const meta = await (await store()).meta();
  const anchor = projects.find((p) => p.companyId === String(meta.companyId ?? "")) ?? projects[0];
  if (!anchor) throw new HttpError(403, "no_projects", "Your Procore account has no projects here.");
  const tryIds = projects.filter((p) => p.companyId === anchor.companyId).map((p) => p.projectId);
  if (!(await isAdmin(req, res, cfg, anchor.companyId, tryIds))) throw new HttpError(403, "not_admin", "Only Procore admins can use this page.");
  const me = await procoreGet(req, res, cfg, "/rest/v1.0/me", { companyId: anchor.companyId, query: { company_id: anchor.companyId } });
  const g = { companyId: anchor.companyId, projects: projects.filter((p) => p.companyId === anchor.companyId), me: { id: me?.id, name: me?.name || "Ky" } };
  if (!meta.companyId) await (await store()).saveMeta({ companyId: anchor.companyId });
  guardCache.set(key, { g, at: Date.now() });
  return g;
}

async function ctxFor(req, res, cfg, g) {
  const rows = Object.fromEntries((await allRows(await store())).map((t) => [t.id, t.row]));
  const projects = Object.fromEntries(CODES.map((c) => [c, g.projects.find((p) => p.name.trim().toLowerCase() === PROJECTS[c].name.toLowerCase())?.projectId ?? null]));
  return context(req, res, cfg, { companyId: g.companyId, me: g.me, rows, projects });
}

// ---------- the page's data ----------

export function copyForClaude(list, meta) {
  const lines = [`SiteSnap demo seed · ${new Date().toISOString()} · last run ${meta.lastRunAt ? new Date(meta.lastRunAt).toISOString() : "never"}`];
  const count = (s) => list.filter((t) => t.row.status === s).length;
  for (const c of CODES) { const r = list.find((t) => t.id === `project:${c}`)?.row; lines.push(`${PROJECTS[c].name}: project ${r?.made?.projectId ?? "not made yet"}${r?.made?.toolsOff?.length ? ` · TOOLS OFF: ${r.made.toolsOff.join(", ")}` : r?.made?.toolsOff ? " · all tools on" : ""}`); }
  lines.push(`Done ${count("done")}, partial ${count("partial")}, failed ${count("failed")}, not started ${count("not_started")} (of ${list.length})`);
  for (const t of list.filter((x) => x.row.status !== "done" || x.row.notes?.length)) {
    if (t.row.status === "not_started") continue;
    lines.push(`- ${t.id} [${t.row.status}]${t.row.error ? ` ${t.row.error}` : ""}${t.row.notes?.length ? ` | ${t.row.notes.join(" | ")}` : ""}`);
  }
  return lines.join("\n").slice(0, 20000);
}

async function state(g) {
  const st = await store();
  const list = await allRows(st);
  const meta = await st.meta();
  const byStatus = (s) => list.filter((t) => t.row.status === s).length;
  const projectIds = Object.fromEntries(CODES.map((c) => [c, list.find((t) => t.id === `project:${c}`)?.row.made?.projectId ?? null]));
  return {
    me: g.me, companyId: g.companyId, emailReady: !!emailBase(),
    projects: Object.fromEntries(CODES.map((c) => [c, { ...PROJECTS[c], projectId: projectIds[c], toolsOff: list.find((t) => t.id === `project:${c}`)?.row.made?.toolsOff ?? null }])),
    groups: GROUPS.map(([name, kinds]) => ({ name, ids: list.filter((t) => kinds.includes(t.kind)).map((t) => t.id) })),
    tasks: list.map((t) => ({
      id: t.id, kind: t.kind, label: t.label, project: t.project ?? null, status: t.row.status, notes: t.row.notes ?? [], error: t.row.error ?? null, at: t.row.at ?? null,
      url: t.row.made?.url ?? null, procoreId: t.row.made?.procoreId ?? t.row.made?.listId ?? t.row.made?.imageId ?? t.row.made?.projectId ?? null, undo: UNDOABLE.includes(t.kind) ? undoPlan(t, t.row) : null,
    })),
    summary: { total: list.length, done: byStatus("done"), partial: byStatus("partial"), failed: byStatus("failed"), not_started: byStatus("not_started") },
    people: PEOPLE.map((p) => ({ key: p.key, name: fullName(p), spec: p.spec, title: p.job_title, projects: p.projects, invite: meta.invites?.[p.key] ?? null })),
    renamed: [
      ...PEOPLE.filter((p) => p.spec !== fullName(p)).map((p) => [p.spec, fullName(p)]),
      ["Pacific Rim Development", "Tidewater Development"], ["Summit Drywall & Finishes", "Ridgeline Drywall & Finishes"],
      ...CODES.filter((c) => PROJECTS[c].spec !== PROJECTS[c].name.replace("[DEMO] ", "")).map((c) => [PROJECTS[c].spec, PROJECTS[c].name.replace("[DEMO] ", "")]),
    ],
    myItems: Object.entries(myItemsPlan()).map(([k, ids]) => ({ name: nameOf(k), ids })),
    counts: { records: RECORDS.length, people: PEOPLE.length },
    copyText: copyForClaude(list, meta),
  };
}

// The first task not done, in order, that wasn't already tried this run
async function next(req, res, cfg, g, body) {
  const skip = new Set(Array.isArray(body.skip) ? body.skip.map(String) : []);
  const ctx = await ctxFor(req, res, cfg, g);
  // Tools off in a project: check again (they may be on now); still off = stop, everything else would be refused
  // (only once all three projects exist, so the tools can be turned on in one go)
  const off = {};
  const allMade = CODES.every((c) => ctx.rows[`project:${c}`]?.made?.projectId);
  for (const code of allMade ? CODES : []) {
    if (!ctx.rows[`project:${code}`]?.made?.toolsOff?.length) continue;
    const again = await runTask(ctx, `project:${code}`);
    if (again.rateLimited) return { id: `project:${code}`, label: `Project ${PROJECTS[code].name}`, status: again.row.status, rateLimited: true };
    if (again.row.made?.toolsOff?.length) off[code] = again.row.made.toolsOff;
  }
  if (Object.keys(off).length) return { blocked: true, toolsOff: Object.fromEntries(Object.entries(off).map(([c, list]) => [PROJECTS[c].name, list])) };
  const t = tasks().find((x) => ctx.rows[x.id]?.status !== "done" && !skip.has(x.id));
  if (!t) return { finished: true };
  const out = await runTask(ctx, t.id);
  await (await store()).saveMeta({ lastRunAt: Date.now() });
  console.log("SiteSnap demo seed", t.id, out.row.status, out.row.error ?? "");
  return { id: t.id, label: t.label, status: out.row.status, error: out.row.error, notes: out.row.notes, rateLimited: out.rateLimited };
}

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>SiteSnap AI · Demo seed</title>
<style>*{box-sizing:border-box}body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#000;color:#f5efe6;max-width:720px;margin:0 auto;padding:16px;font-size:17px;overflow-x:hidden}
h1{font-size:26px;margin:4px 0 8px}h2{font-size:21px;margin:22px 0 6px}a{color:#ffc24d}small,.muted{color:#b8ac9c}
button{font:inherit;font-weight:700;padding:13px 16px;border:0;border-radius:14px;background:#ffb81c;color:#1f1a14;width:100%;margin:6px 0}
button.ghost{background:#2c261f;color:#f5efe6;border:1px solid #4a4036}button.small{width:auto;padding:8px 12px;font-size:15px;margin:6px 6px 0 0}button.danger{background:#ff5f57;color:#1a0d0c}button:disabled{opacity:.5}
.sum{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:10px 0}.sum div{background:#221d18;border-radius:12px;padding:8px 4px;text-align:center}.sum b{display:block;font-size:30px;line-height:1.1}.sum span{font-size:13px}
.card{background:#221d18;border-radius:12px;padding:10px 12px;margin:8px 0;overflow-wrap:anywhere}.top{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pill{font-size:14px;font-weight:800;padding:3px 9px;border-radius:999px;color:#14110d}.s-done{background:#30d158}.s-not_started{background:#8e8e93}.s-failed{background:#ff5f57}.s-partial{background:#ffb81c}
.ttl{font-size:17px;font-weight:600}.err{color:#ff8a84;font-size:15px;margin-top:4px}.note{color:#d8ccbb;font-size:14px;margin-top:2px}.ok{color:#30d158}.bad{color:#ff5f57}.warn{border:2px solid #ffb81c}
details{background:#15120f;border-radius:12px;padding:8px 12px;margin:10px 0}summary{font-weight:700;cursor:pointer;padding:4px 0}
table{width:100%;border-collapse:collapse;font-size:15px}td,th{padding:4px;text-align:left;border-bottom:1px solid #3a332b;vertical-align:top}pre{white-space:pre-wrap;font-size:13px;color:#d8ccbb}
#log{max-height:220px;overflow:auto;font-size:14px;background:#15120f;border-radius:12px;padding:8px 10px}#log:empty{display:none}</style></head>
<body><h1>Demo seed</h1>
<p id="who" class="muted">Checking your Procore sign-in…</p>
<div id="app" hidden>
<p class="muted">Three [DEMO] projects with 5 companies, 22 people plus you, 12 Observations, 14 Punch Items, 21 Daily Log days, 3 inspections, 12 photos and 10 SiteSnap messages. Lives next to the Demo staging set; nothing outside the three [DEMO] projects is changed.</p>
<div class="sum"><div><b id="n-total">0</b><span>Tasks</span></div><div style="color:#30d158"><b id="n-done">0</b><span>Done</span></div><div style="color:#c7c7cc"><b id="n-left">0</b><span>Not started</span></div><div style="color:#ff5f57"><b id="n-bad">0</b><span>Problems</span></div></div>
<div id="alerts"></div>
<button id="all">Seed Everything</button>
<button id="copy" class="ghost">Copy for Claude</button>
<p id="busy" class="muted" aria-live="polite"></p><div id="log"></div>
<div id="list"></div>
<h2>Between demos</h2>
<p class="muted">Puts every seeded Observation and Punch Item back to its starting status (for example OBS-04 back to Initiated, PI-12 back to Ready for Review). Records you made live during a demo stay; delete them in Procore if you like.</p>
<button id="restore" class="ghost">Restore Starting Statuses</button><div id="restoreout"></div>
<details><summary>Names changed from the spec</summary><p class="muted">These clashed with people or projects already in the sandbox (SiteSnap finds people by name).</p><div id="names"></div></details>
<details><summary>Who has what in My items</summary><div id="myitems"></div></details>
<details><summary>Procore invites (real emails)</summary><p class="muted">Sends Procore's invite email to each person, so you can sign in as them (for example Victor, the foreman). They all go to plus-addresses of your own inbox. One email per person.</p><button id="invite" class="ghost">Send 22 Invites</button><div id="inviteout"></div></details>
<details><summary>Reset seeded data</summary><p class="muted">Removes only what this page made and recorded: messages, inspections, photos, Daily Log entries, Observations and Punch Items (a record whose title no longer starts with [DEMO] is left alone). Projects, companies, people, albums and templates stay, so Seed Everything rebuilds quickly.</p>
<button id="dry" class="ghost">Preview Reset (changes nothing)</button><button id="reset" class="danger">Reset Seeded Data</button><div id="resetout"></div></details>
</div>
<script>
const $=(s)=>document.querySelector(s); let S=null;
const esc=(s)=>String(s??'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const LABEL={done:'Done',not_started:'Not started',failed:'Failed',partial:'Partial'};
const post=async(body)=>{ const r=await fetch('/api/procore/demo-seed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}); const b=await r.json().catch(()=>({message:'No answer from the server'})); if(!r.ok){ const e=new Error(b.message||'Failed'); e.status=r.status; throw e; } return b; };
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const busy=(t)=>{ $('#busy').textContent=t||''; document.querySelectorAll('button').forEach(b=>b.disabled=!!t); };
const log=(t,cls)=>{ $('#log').innerHTML+='<div class="'+(cls||'')+'">'+esc(t)+'</div>'; $('#log').scrollTop=1e9; };
function render(){
  const m=S.summary; $('#n-total').textContent=m.total; $('#n-done').textContent=m.done; $('#n-left').textContent=m.not_started; $('#n-bad').textContent=m.failed+m.partial;
  let a='';
  if(!S.emailReady) a+='<div class="card warn"><b>Emails not set.</b> <small>People get plus-addresses of DEMO_SEED_EMAIL (or the first of DEMO_ADMIN_EMAILS). Set one in Vercel and redeploy before seeding people.</small></div>';
  const off=Object.entries(S.projects).filter(([,p])=>p.toolsOff&&p.toolsOff.length);
  if(off.length) a+='<div class="card warn"><b>Turn these tools on in Procore</b> <small>(each project: Admin → Active Tools), then press Seed Everything again:</small>'+off.map(([c,p])=>'<div><small><b>'+esc(p.name)+'</b>: '+esc(p.toolsOff.join(', '))+'</small></div>').join('')+'</div>';
  $('#alerts').innerHTML=a;
  const T=Object.fromEntries(S.tasks.map(t=>[t.id,t]));
  let html='';
  for(const g of S.groups){ const list=g.ids.map(id=>T[id]); const done=list.filter(t=>t.status==='done').length;
    html+='<details'+(list.some(t=>t.status==='failed'||t.status==='partial')?' open':'')+'><summary>'+esc(g.name)+' · '+done+' / '+list.length+'</summary>';
    for(const t of list){ html+='<div class="card"><div class="top"><span class="pill s-'+t.status+'">'+LABEL[t.status]+'</span><span class="ttl">'+esc(t.label)+'</span></div>'
      +(t.url?'<small><a href="'+esc(t.url)+'" target="_blank" rel="noopener">Open in Procore</a></small>':'')
      +(t.error?'<div class="err">'+esc(t.error)+'</div>':'')+t.notes.map(n=>'<div class="note">'+esc(n)+'</div>').join('')
      +'<button class="small ghost" data-run="'+t.id+'">'+(t.status==='done'?'Run Again':'Run')+'</button>'+(t.undo&&t.undo.length?'<button class="small ghost" data-redo="'+t.id+'">Redo</button>':'')+'</div>'; }
    html+='</details>'; }
  $('#list').innerHTML=html;
  $('#names').innerHTML='<table><tr><th>Spec</th><th>Used</th></tr>'+S.renamed.map(([a,b])=>'<tr><td>'+esc(a)+'</td><td>'+esc(b)+'</td></tr>').join('')+'</table>';
  $('#myitems').innerHTML='<table>'+S.myItems.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.ids.join(', '))+'</td></tr>').join('')+'</table>';
  $('#inviteout').innerHTML=S.people.filter(p=>p.invite).map(p=>'<div class="note">'+(p.invite.ok?'✓ ':'✗ ')+esc(p.name)+': '+esc(p.invite.detail)+'</div>').join('');
}
async function refresh(){ S=await post({action:'state'}); render(); }
async function load(){ try{ await refresh(); $('#who').innerHTML='<small>Signed in as '+esc(S.me.name)+' (Procore admin).</small>'; $('#app').hidden=false; }
  catch(e){ $('#who').innerHTML=e.status===401?'Not signed in. <a href="/api/procore/login?back=demo-seed">Sign in with Procore</a>.':'<span class="bad">'+esc(e.message)+'</span>'; } }
// Runs every task not done yet, one per request; a 429 waits a minute and tries again; stops after 6 problems in a row
$('#all').onclick=async()=>{ $('#log').innerHTML=''; const skip=[]; let bad=0, n=0;
  busy('Seeding… keep this page open (about 10 to 20 minutes the first time).');
  try{ for(;;){ const b=await post({action:'next',skip});
      if(b.finished){ log('All done.','ok'); break; }
      if(b.blocked){ log('Stopped: turn these tools on in Procore first (each project: Admin → Active Tools), then press Seed Everything again.','bad'); for(const [name,list] of Object.entries(b.toolsOff)) log(name+': '+list.join(', '),'bad'); break; }
      n++; $('#busy').textContent='Seeding… task '+n+': '+b.label;
      if(b.rateLimited){ log('Procore said slow down. Waiting a minute…'); await sleep(60000); continue; }
      log((b.status==='done'?'✓ ':b.status==='partial'?'◐ ':'✗ ')+b.label+(b.error?' · '+b.error:''), b.status==='done'?'':b.status==='partial'?'':'bad');
      if(b.status!=='done'){ skip.push(b.id); bad++; } else bad=0;
      if(bad>=6){ log('Stopped after 6 problems in a row. Check the red ones below, fix, and press Seed Everything again.','bad'); break; } }
  }catch(e){ log(e.message,'bad'); }
  busy(''); await refresh(); };
$('#copy').onclick=async()=>{ try{ await navigator.clipboard.writeText(S.copyText); $('#busy').textContent='Copied. Paste it to Claude.'; }catch(e){ prompt('Copy this:',S.copyText); } };
document.addEventListener('click',async(ev)=>{ const t=ev.target;
  if(t.dataset.run){ busy('Running…'); try{ const b=await post({action:'run',id:t.dataset.run}); if(b.rateLimited) alert('Procore said slow down. Wait a minute and press it again.'); }catch(e){ alert(e.message); } busy(''); await refresh(); }
  if(t.dataset.redo){ if(!confirm('Remove what this task made in Procore and make it again?')) return; busy('Redoing…'); try{ await post({action:'redo',id:t.dataset.redo}); }catch(e){ alert(e.message); } busy(''); await refresh(); }
});
$('#restore').onclick=async()=>{ busy('Restoring starting statuses… (about a minute)'); try{ const b=await post({action:'restore'}); $('#restoreout').innerHTML=b.results.map(r=>'<div class="note">'+(r.ok?'✓ ':'✗ ')+esc(r.id)+' '+esc(r.detail)+'</div>').join('')||'<p class="muted">Nothing seeded yet.</p>'; }catch(e){ $('#restoreout').innerHTML='<p class="bad">'+esc(e.message)+'</p>'; } busy(''); };
$('#invite').onclick=async()=>{ if(!confirm('Send Procore invite emails to all 22 people (plus-addresses of your inbox)?')) return; busy('Sending invites…');
  for(const p of S.people){ try{ const b=await post({action:'invite',key:p.key}); log((b.ok?'✓ ':'✗ ')+p.name+': '+b.detail, b.ok?'':'bad'); }catch(e){ log(p.name+': '+e.message,'bad'); if(e.status===429){ await sleep(60000); } } }
  busy(''); await refresh(); };
const undoable=()=>S.tasks.filter(t=>t.undo&&t.undo.length).reverse();
$('#dry').onclick=()=>{ const list=undoable(); $('#resetout').innerHTML=list.length?'<p><small>Would remove '+list.reduce((n,t)=>n+t.undo.length,0)+' item(s):</small></p>'+list.map(t=>'<div class="note">'+esc(t.label)+': '+esc(t.undo.join('; '))+'</div>').join(''):'<p class="muted">Nothing to remove.</p>'; };
$('#reset').onclick=async()=>{ const list=undoable(); if(!list.length) return alert('Nothing to remove.'); if(!confirm('Remove '+list.length+' seeded item group(s) from the three [DEMO] projects?')) return;
  $('#resetout').innerHTML=''; $('#log').innerHTML=''; busy('Resetting…');
  for(const t of list){ try{ const b=await post({action:'undo',id:t.id}); log((b.kept.length?'◐ ':'✓ ')+t.label+(b.kept.length?' · kept: '+b.kept.join('; '):'')); }catch(e){ log(t.label+': '+e.message,'bad'); if(e.status===429){ await sleep(60000); } } }
  busy(''); await refresh(); log('Reset done. Press Seed Everything to rebuild.','ok'); };
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
    if (pace.gapMs > 0) pace.gapMs = 500;
    const g = await guard(req, res, cfg);

    if (body.action === "state") return sendJson(res, 200, await state(g));
    if (body.action === "next") return sendJson(res, 200, await next(req, res, cfg, g, body));
    if (body.action === "restore") return sendJson(res, 200, { results: await restoreStatuses(await ctxFor(req, res, cfg, g)) });
    if (body.action === "invite") {
      const p = personByKey(String(body.key ?? ""));
      if (!p) throw new HttpError(400, "bad_request", "Unknown person.");
      const out = await invite(await ctxFor(req, res, cfg, g), p.key);
      const st = await store();
      await st.saveMeta({ invites: { ...((await st.meta()).invites ?? {}), [p.key]: { ...out, at: Date.now() } } });
      return sendJson(res, 200, out);
    }
    const t = taskById(String(body.id ?? ""));
    if (!t) throw new HttpError(400, "bad_request", "Unknown task.");
    const ctx = await ctxFor(req, res, cfg, g);
    if (body.action === "run") { const out = await runTask(ctx, t.id); return sendJson(res, 200, { status: out.row.status, error: out.row.error, rateLimited: out.rateLimited }); }
    if (body.action === "undo" || body.action === "redo") {
      if (!UNDOABLE.includes(t.kind)) throw new HttpError(400, "bad_request", "Setup tasks aren't undone (projects, companies, people, albums and templates stay).");
      const out = await undoTask(ctx, t);
      console.log("SiteSnap demo seed undo", t.id, JSON.stringify(out));
      if (body.action === "undo") return sendJson(res, 200, out);
      if (out.kept.length) throw new HttpError(409, "not_removed", `Not redone: ${out.kept.join("; ")}`);
      const again = await runTask(ctx, t.id);
      return sendJson(res, 200, { status: again.row.status, error: again.row.error });
    }
    throw new HttpError(400, "bad_request", "Unknown step.");
  } catch (err) {
    if (err instanceof HttpError && err.status !== 404) console.log("SiteSnap demo seed stopped", err.status, err.code, err.message);
    sendError(res, err);
  }
}
