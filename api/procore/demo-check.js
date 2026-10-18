// /admin/demo-check (redirects here): full-loop demo Step 0, the read-only audit (SITESNAP_FULL_LOOP_DEMO_SPEC.md
// v4, section 3). For each demo project (DEMO_PROJECT_IDS), checks the PM account (DEMO_ACTOR_PM) and, for
// Option B, the second Foreman/Sub user (DEMO_ACTOR_ASSIGNEE, or a name typed on the page): Directory, permission
// template levels, statuses, assignee list, trades, sample data. Plus, once: which account holds this sign-in, and
// whether Procore offers Observation webhooks. Rules in api/_demoCheck.js.
//   GET  the page        POST  run it (same-origin JSON)
// GET calls only, with Ky's own sign-in: nothing changes in Procore or in SiteSnap. Sandbox only, owner only
// (DEMO_ADMIN_EMAILS), never in a guest demo session. Never returns an email, a phone or a token.
import { config, demoCookie, HttpError, procoreGet, queryOf, readBody, requireSameOriginJson, sendError, sendJson } from "../_procore.js";
import { procoreSend } from "../_procoreWrite.js";
import { listProjects } from "../_projects.js";
import { demoSettings } from "../_demo.js";
import { evaluateProject, levelNum, statusValues, worst, PASS, PARTIAL, FAIL } from "../_demoCheck.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Procore allows about 25 calls per 10 seconds; a 429 waits for its reset and tries again (tests shorten it)
export const pace = { gapMs: 600, retries: 3, minWaitMs: 2000, maxWaitMs: 12000 };

const lower = (s) => String(s ?? "").trim().toLowerCase();
const listOf = (json) => (Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : []);
const total = (r) => (r.ok ? Number(r.headers?.total ?? listOf(r.json).length) : null);

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>SiteSnap AI · Demo check</title>
<style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#000;color:#f5efe6;max-width:760px;margin:0 auto;padding:24px 16px}
button{font:inherit;font-size:20px;font-weight:700;padding:14px 20px;border:0;border-radius:14px;background:#ffb81c;color:#1f1a14;width:100%;margin:8px 0}
input{font:inherit;font-size:17px;width:100%;box-sizing:border-box;padding:12px;border-radius:12px;background:#221d18;color:#f5efe6;border:1px solid #3a332b}
.card{background:#221d18;border-radius:12px;padding:12px 14px;margin:12px 0;overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:14px}
td,th{text-align:left;padding:6px 6px;border-top:1px solid #3a332b;vertical-align:top}.PASS{color:#30d158;font-weight:700}.PARTIAL{color:#ffc24d;font-weight:700}.FAIL{color:#ff5f57;font-weight:700}
a{color:#ffc24d}small{color:#b8ac9c}</style></head>
<body><h1>Full-loop demo check</h1>
<p>Step 0 of the full-loop demo spec. For each demo project it checks the PM account, its permission template, the trades, and (Option B) the second user. <b>Read only: nothing changes in Procore or in SiteSnap.</b></p>
<p id="who"><small>Checking your Procore sign-in…</small></p>
<label for="sub"><small>Option B only: the second Foreman/Sub user's name or email (leave empty for Option A, or to use DEMO_ACTOR_ASSIGNEE)</small></label>
<input id="sub" autocomplete="off">
<button id="run">Run Demo Check</button>
<div id="out"></div>
<script>
const $=(s)=>document.querySelector(s);
const esc=(s)=>String(s??'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const signIn='<a href="/api/procore/login?back=demo-check">Sign in with Procore</a>';
const other='<a href="/api/procore/login?back=demo-check&fresh=1">use a different Procore account</a>';
const said={denied:'Procore sign-in was cancelled. ',error:'Procore sign-in didn\\'t finish. '}[new URLSearchParams(location.search).get('signin')]||'';
$('#run').disabled=true;
fetch('/api/procore/demo-check?status=1').then(r=>r.json()).then(s=>{
  if(!s.signedIn){ $('#who').innerHTML='<span class="FAIL">'+said+'Not signed in.</span> '+signIn+' (it brings you back here).'; return; }
  if(s.demo){ $('#who').innerHTML='<span class="FAIL">This browser is in the guest demo.</span> '+signIn+' as yourself to replace it.'; return; }
  if(!s.owner){ $('#who').innerHTML='<span class="FAIL">Signed in as '+esc(s.name)+', but that Procore login ('+esc(s.login)+') isn\\'t in DEMO_ADMIN_EMAILS.</span> Put exactly that in DEMO_ADMIN_EMAILS in Vercel and redeploy, or '+other+'.'; return; }
  $('#who').innerHTML='<span class="PASS">Signed in as '+esc(s.name)+'.</span> <small>Not you? '+other+'.</small>';
  $('#run').disabled=false;
}).catch(()=>{ $('#who').innerHTML='<span class="FAIL">Couldn\\'t check your sign-in.</span> '+signIn+'.'; });
const table=(rows)=>'<table><tr><th>Check</th><th>Result</th><th>Details</th></tr>'+rows.map(r=>'<tr><td>'+esc(r.check)+'</td><td class="'+r.result+'">'+r.result+'</td><td>'+esc(r.detail)+'</td></tr>').join('')+'</table>';
$('#run').onclick=async()=>{
  $('#run').disabled=true; $('#out').innerHTML='<p>Checking… (about 30 seconds)</p>';
  const r=await fetch('/api/procore/demo-check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({assignee:$('#sub').value})});
  const b=await r.json().catch(()=>({message:'No answer'}));
  $('#run').disabled=false;
  if(!r.ok){ $('#out').innerHTML='<p class="FAIL">'+esc(b.message||'Failed')+'</p>'; return; }
  let text='SiteSnap full-loop demo check · '+b.at+'\\n';
  const line=(r)=>'- '+r.result+' · '+r.check+': '+r.detail+'\\n';
  text+='\\nOverall\\n'+b.global.map(line).join('');
  let html='<div class="card"><h2>Overall</h2>'+table(b.global)+'</div>';
  for(const p of b.projects){ html+='<div class="card"><h2>'+esc(p.name)+' <span class="'+p.result+'">'+p.result+'</span></h2><small>Project '+esc(p.projectId)+'</small>'+table(p.rows)+'</div>'; text+='\\n'+p.name+' ('+p.projectId+'): '+p.result+'\\n'+p.rows.map(line).join(''); }
  html+='<button id="copy">Copy for Claude</button>';
  $('#out').innerHTML=html;
  $('#copy').onclick=()=>navigator.clipboard.writeText(text).then(()=>{$('#copy').textContent='Copied';});
};
</script></body></html>`;

// Ky, signed in with his own Procore account (DEMO_ADMIN_EMAILS); never a guest demo session
async function requireOwner(req, res, cfg, s) {
  if (demoCookie(req, cfg.sessionSecret)) throw new HttpError(403, "demo_read_only", "This page isn't part of the demo.");
  if (!s.admins.length) throw new HttpError(403, "not_configured", "Set DEMO_ADMIN_EMAILS in Vercel first.");
  const me = await procoreGet(req, res, cfg, "/rest/v1.0/me");
  if (!s.admins.includes(lower(me?.login))) throw new HttpError(403, "not_owner", "Only the app's owner can use this page.");
  return me;
}

// For the page, when it opens: signed in? the guest demo? the owner? The login is shown only to the person
// signed in with it (like /admin/demo-authorize), so they can see what DEMO_ADMIN_EMAILS must say.
async function signInStatus(req, res, cfg) {
  if (demoCookie(req, cfg.sessionSecret)) return { signedIn: true, demo: true };
  let me;
  try {
    me = await procoreGet(req, res, cfg, "/rest/v1.0/me");
  } catch (err) {
    if (err instanceof HttpError && err.status === 401) return { signedIn: false };
    throw err;
  }
  const login = lower(me?.login);
  return { signedIn: true, demo: false, name: String(me?.name ?? "").trim() || login.split("@")[0] || "you", login, owner: demoSettings().admins.includes(login) };
}

export default async function handler(req, res) {
  try {
    const cfg = config();
    if (!/sandbox/i.test(cfg.apiUrl)) throw new HttpError(403, "not_sandbox", "This check only runs against Procore's sandbox.");
    if (req.method === "GET" && queryOf(req).get("status") === "1") return sendJson(res, 200, await signInStatus(req, res, cfg));
    if (req.method === "GET") {
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      return res.end(PAGE);
    }
    if (req.method !== "POST") throw new HttpError(405, "bad_request", "Use GET or POST.");
    requireSameOriginJson(req);
    const body = await readBody(req);
    const s = demoSettings();
    const me = await requireOwner(req, res, cfg, s);
    if (!s.projectIds.length) throw new HttpError(400, "not_configured", "DEMO_PROJECT_IDS has no project ids.");
    const pm = String(process.env.DEMO_ACTOR_PM ?? "").trim();
    const assignee = String(body.assignee ?? "").trim().slice(0, 120) || String(process.env.DEMO_ACTOR_ASSIGNEE ?? "").trim();
    const pmWho = pm || String(me?.login ?? "");

    const global = [];
    const g = (check, result, detail) => global.push({ check, result, detail });
    // Open question 3: whose authorization does SiteSnap act with
    if (!pm) g("DEMO_ACTOR_PM set", PARTIAL, "Not set in Vercel; checked the signed-in account instead. Set DEMO_ACTOR_PM to the PM account's Procore login.");
    else g("Signed-in account is DEMO_ACTOR_PM", lower(me?.login) === lower(pm) ? PASS : FAIL, lower(me?.login) === lower(pm) ? `Yes: SiteSnap acts as ${me?.name ?? "the PM"} with this sign-in.` : `No: signed in as ${me?.name ?? "someone else"}. Sign out and sign in with the DEMO_ACTOR_PM account.`);
    g("Option", PASS, assignee ? "B: the second user's rows are checked in each project." : "A (PM only): no second user checked. Type a name above to check Option B.");

    const { projects } = await listProjects(req, res, cfg);
    let last = 0;
    let limited = false; // a call Procore still refused with 429 after waiting (reset per project)
    const get = async (path, companyId, query = {}) => {
      for (let attempt = 0; ; attempt++) {
        const wait = last + pace.gapMs - Date.now();
        if (wait > 0) await sleep(wait);
        last = Date.now();
        const r = await procoreSend(req, res, cfg, "GET", path, { companyId, query });
        if (r.status !== 429) return r;
        if (attempt >= pace.retries) { limited = true; return r; }
        // Wait until Procore's window resets (X-Rate-Limit-Reset, epoch seconds), 2 to 12 s
        const reset = Number(r.headers?.["x-rate-limit-reset"]) * 1000 - Date.now();
        await sleep(Math.min(pace.maxWaitMs, Math.max(pace.minWaitMs, Number.isFinite(reset) ? reset : 0)));
      }
    };
    const busy = { check: "Procore's rate limit", result: PARTIAL, detail: "Procore said \"too many requests\" even after waiting, so this project wasn't checked. Run the check again in a minute." };

    const levelCache = {}; // per company: { [templateId]: levels }
    const out = [];
    let hooksChecked = false;
    for (const id of s.projectIds) {
      const p = projects.find((x) => x.projectId === id);
      if (!p) { out.push({ projectId: id, name: `Project ${id}`, result: FAIL, rows: evaluateProject({ project: { projectId: id, open: false } }) }); continue; }
      const c = p.companyId;
      limited = false;
      const users = await get(`/rest/v1.0/projects/${id}/users`, c, { per_page: 300 });
      const people = listOf(users.json);
      // Template levels for the people being checked (only a Procore admin can read them)
      const levels = (levelCache[c] ??= {});
      const pick = [pmWho, assignee].filter(Boolean).map((w) => people.find((u) => [lower(u.email_address), lower(u.login), lower(u.name)].includes(lower(w))));
      for (const u of pick) {
        const tid = u?.permission_template?.id;
        if (tid == null || String(tid) in levels) continue;
        const r = await get(`/rest/v1.0/companies/${c}/permission_templates/${tid}`, c);
        const l = r.ok ? r.json?.user_access_levels ?? {} : {};
        levels[String(tid)] = { observations: levelNum(l.observations), images: levelNum(l.images ?? l.photos), directory: levelNum(l.directory) };
      }
      const asg = await get("/rest/v1.0/observations/assignees", c, { project_id: id });
      const assignees = asg.ok ? new Set(listOf(asg.json).map((u) => String(u.id ?? u.user_id))) : null;
      const st = await get(`/rest/v1.0/projects/${id}/observations/items/statuses`, c);
      const vendors = await get(`/rest/v1.0/projects/${id}/vendors`, c, { view: "extended", per_page: 300 });
      const obs = await get("/rest/v1.0/observations/items", c, { project_id: id, per_page: 1 });
      const photos = await get("/rest/v1.0/images", c, { project_id: id, per_page: 1 });
      const rows = evaluateProject({
        project: { projectId: id, name: p.name, open: true },
        people: users.ok ? people : [], levels, assignees,
        statuses: st.ok ? statusValues(st.json) : null,
        vendors: vendors.ok ? listOf(vendors.json) : [],
        obsTotal: total(obs), photoTotal: total(photos), pm: pmWho, assignee,
      });
      // A 429 that outlasted the retries makes rows look like real gaps ("not in the Directory"): say so instead
      if (limited) { out.push({ projectId: id, name: p.name, result: PARTIAL, rows: [busy] }); continue; }
      if (!users.ok) rows.unshift({ check: "Project Directory readable", result: FAIL, detail: `Procore answered ${users.status} to the project's people.` });
      out.push({ projectId: id, name: p.name, result: worst(rows), rows });

      // Open question 6, once: does Procore offer Observation webhooks here (read only: lists, never creates)
      if (!hooksChecked && !limited) {
        hooksChecked = true;
        limited = false;
        const resources = await get("/rest/v1.0/webhooks/resources", c, { project_id: id });
        const names = listOf(resources.json).map((x) => (typeof x === "string" ? x : x?.name ?? x?.resource_name ?? "")).map(String).filter(Boolean);
        const has = names.some((n) => /observation item/i.test(n));
        g("Observation webhooks offered", resources.ok ? (has ? PASS : PARTIAL) : PARTIAL, resources.ok ? (has ? `Yes (${names.filter((n) => /observation/i.test(n)).join(", ")}). Status sync can use a webhook; polling stays as the fallback.` : "Not in Procore's list: status sync will poll.") : resources.status === 429 ? "Procore's rate limit: run the check again in a minute." : `Procore answered ${resources.status}: status sync will poll unless this is sorted out.`);
        const hooks = await get("/rest/v1.0/webhooks/hooks", c, { project_id: id });
        g("Existing webhooks on the first project", hooks.ok ? PASS : PARTIAL, hooks.ok ? `${listOf(hooks.json).length} set up.` : hooks.status === 429 ? "Procore's rate limit: run the check again in a minute." : `Procore answered ${hooks.status} (may need a company admin, or a hook made by the app itself).`);
      }
    }
    console.log("SiteSnap demo check", JSON.stringify(out.map((p) => ({ projectId: p.projectId, result: p.result }))));
    sendJson(res, 200, { at: new Date().toISOString(), global, projects: out });
  } catch (err) {
    sendError(res, err);
  }
}
