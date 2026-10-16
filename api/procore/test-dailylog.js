// Daily log by voice, sandbox check (docs/closeout-and-daily-log-spec.md, B9). Confirms the Procore side before
// foremen use it, with the signed-in person's own Procore sign-in and exactly the requests the app sends (api/_dailyLog.js).
// GET  /api/procore/test-dailylog : a small page (sign in with Procore first) with a Run Check button.
// POST /api/procore/test-dailylog : reads today's Manpower / Delays / Deliveries / Notes, the project's delay types and
//   companies, then creates ONE test entry in each section labeled "SiteSnap test" (Delays and Notes with a test photo),
//   reads them back, shows the rate-limit headers, and (only when asked) deletes the test entries again.
// Run it as an admin, then as a foreman (Foreman / Superintendent - Internal) and a subcontractor foreman
// (Subcontractor - External) to see who gets a 403. Sandbox only. Same-origin JSON for the POST.
import { config, HttpError, procoreId, requireSameOriginJson, readBody, sendError, sendJson } from "../_procore.js";
import { listProjects } from "../_projects.js";
import { procoreSend } from "../_procoreWrite.js";
import { TEST_PHOTO_JPEG_B64 } from "../_testPhoto.js";
import { delayTypePaths, ianaZone, procoreFields, projectDay, requestFor, SECTIONS, SECTION_KEYS } from "../_dailyLog.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pace = { gapMs: 450 }; // Procore allows about 25 calls per 10 seconds
const brief = (r) => (r.ok ? null : typeof r.json === "object" ? JSON.stringify(r.json).slice(0, 400) : String(r.json ?? ""));
const shape = (o) => (o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && typeof v === "object" ? (Array.isArray(v) ? `[${v.length}]` : `{${Object.keys(v).join(",")}}`) : v])) : o);

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SiteSnap AI · Daily Log check</title>
<style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#000;color:#f5efe6;max-width:640px;margin:0 auto;padding:24px 16px}
button{font:inherit;font-size:20px;font-weight:700;padding:14px 20px;border:0;border-radius:14px;background:#ffb81c;color:#1f1a14;width:100%;margin:8px 0}
select{font:inherit;font-size:17px;width:100%;padding:12px;border-radius:12px;background:#221d18;color:#f5efe6;border:1px solid #3a332b}
label.cb{display:flex;gap:10px;align-items:center;margin:10px 0}label.cb input{width:22px;height:22px}
.step{background:#221d18;border-radius:12px;padding:10px 14px;margin:8px 0}.ok{color:#30d158}.bad{color:#ff5f57}.maybe{color:#ffc24d}a{color:#ffc24d}small{color:#b8ac9c}</style></head>
<body><h1>Daily Log check</h1>
<p>Checks what SiteSnap can do with Procore's <b>Daily Log</b> before foremen use it. It reads today's log, then adds <b>one test entry</b> to each of Manpower, Delays, Deliveries and Notes (all labeled "SiteSnap test"; Delays and Notes get a test photo), using your own Procore sign-in.</p>
<p><small>The Daily Log tool must be turned on for the project in Procore.</small></p>
<p id="who"><small>Checking your Procore sign-in…</small></p>
<p><small><b>To run it as someone else</b> (a foreman or a subcontractor foreman): open this page in a <b>private / incognito window</b>, tap Sign in with Procore, and log in to Procore as that person.</small></p>
<label for="p">Project</label> <select id="p"></select>
<label class="cb"><input type="checkbox" id="clean"> Delete the test entries afterward</label>
<button id="run" disabled>Run Check</button>
<div id="out"></div>
<script>
const $=(s)=>document.querySelector(s);
const esc=(s)=>String(s??'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
fetch('/api/procore/projects').then(async(r)=>{
  if(r.status===401){ $('#who').innerHTML='Not signed in. <a href="/api/procore/login">Sign in with Procore</a>, then come back to this page.'; return; }
  const b=await r.json(); const list=b.projects||[];
  $('#who').innerHTML='<small>Signed in. '+list.length+' project(s).</small>';
  for(const p of list){ const o=document.createElement('option'); o.value=p.companyId+'_'+p.projectId; o.textContent=p.name; if(/sandbox test/i.test(p.name)) o.selected=true; $('#p').append(o); }
  $('#run').disabled=!list.length;
});
$('#run').onclick=async()=>{
  $('#run').disabled=true; $('#out').innerHTML='<p>Checking… (about 20 seconds)</p>';
  const [companyId,projectId]=$('#p').value.split('_');
  const r=await fetch('/api/procore/test-dailylog',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId,projectId,cleanup:$('#clean').checked})});
  const b=await r.json().catch(()=>({message:'No answer'}));
  if(!r.ok){ $('#out').innerHTML='<p class="bad">'+esc(b.message||'Failed')+'</p>'; $('#run').disabled=false; return; }
  $('#out').innerHTML='<p><b>'+esc(b.who)+'</b></p>'+(b.steps||[]).map(s=>'<div class="step"><b class="'+(s.ok?'ok':s.status===404?'maybe':'bad')+'">'+(s.ok?'✓':'✗')+' '+esc(s.name)+'</b> <small>('+s.status+')</small><br><small>'+esc(s.detail)+'</small></div>').join('')
    +'<p><small>Copy everything on this page (or take screenshots) and send it to Claude.</small></p><pre style="white-space:pre-wrap;font-size:12px;color:#b8ac9c">'+esc(JSON.stringify(b.raw,null,1))+'</pre>';
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
    const send = async (method, path, opts = {}) => {
      const wait = last + pace.gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      return procoreSend(req, res, cfg, method, path, { companyId, ...opts });
    };
    const steps = [];
    const raw = {};
    const step = (name, r, detail) => steps.push({ name, ok: r.ok, status: r.status, detail });
    const p = projectId;

    const me = await send("GET", "/rest/v1.0/me", { query: { company_id: companyId } });
    const proj = await send("GET", `/rest/v1.0/projects/${p}`, { query: { company_id: companyId } });
    const today = projectDay(proj.json?.time_zone);
    const users = await send("GET", `/rest/v1.0/projects/${p}/users`, { query: { per_page: 300 } });
    const mine = Array.isArray(users.json) ? users.json.find((u) => String(u.id) === String(me.json?.id)) : null;
    const template = mine?.permission_template?.name ?? "none shown";
    const myCompany = mine?.vendor?.id ? { id: mine.vendor.id, name: mine.vendor.name } : null;
    raw.project = { timeZone: proj.json?.time_zone ?? null, iana: ianaZone(proj.json?.time_zone), today, template, myCompany };
    const who = `Signed in as ${me.json?.name ?? "?"} (template here: ${template}; company: ${myCompany?.name ?? "not shown"}). Project date today: ${today} (${proj.json?.time_zone ?? "time zone not shown"})`;

    // 1. Read today's entries in each section (B9 step 1, and the B7 capability probe)
    raw.read = {};
    for (const s of SECTION_KEYS) {
      const r = await send("GET", `/rest/v1.0/projects/${p}/${SECTIONS[s].path}`, { query: { log_date: today } });
      const list = Array.isArray(r.json) ? r.json : [];
      raw.read[s] = { status: r.status, count: list.length, first: shape(list[0]) ?? null, headers: r.headers };
      step(`Read today's ${SECTIONS[s].label}`, r, r.ok ? `${list.length} entr${list.length === 1 ? "y" : "ies"} today` : r.status === 403 ? "Procore said no: this person can't see this part of the Daily Log" : r.status === 404 ? "Not found: is the Daily Log tool turned on for this project?" : `Procore answered ${r.status}: ${brief(r)}`);
    }

    // 2. The project's delay types (B5: never created by SiteSnap)
    let delayType = null;
    raw.delayTypes = [];
    for (const path of delayTypePaths(companyId, p)) {
      const r = await send("GET", path, { query: { project_id: p } });
      const list = Array.isArray(r.json) ? r.json : [];
      raw.delayTypes.push({ path, status: r.status, count: list.length, first: shape(list[0]) ?? null });
      if (r.ok && list.length) {
        delayType = list.find((t) => t.active !== false)?.name ?? list[0]?.name ?? null;
        step("Read the project's delay types", r, `${list.length} type(s) at ${path}: ${list.slice(0, 10).map((t) => t.name ?? t.title).join(", ")}`);
        break;
      }
    }
    if (!delayType) steps.push({ name: "Read the project's delay types", ok: false, status: raw.delayTypes.at(-1)?.status ?? 0, detail: `None of the known paths answered with a list (${raw.delayTypes.map((d) => d.status).join(", ")}). Delays will be sent without a type.` });

    // 3. One test entry per section, exactly as the app sends it
    const photo = [{ type: "image/jpeg", bytes: Buffer.from(TEST_PHOTO_JPEG_B64, "base64") }];
    const tests = {
      manpower: { entry: { workers: 1, hours: 1, company: myCompany?.id ?? null, comment: "SiteSnap test" }, photos: [] },
      delays: { entry: { type: delayType ?? "", start: "07:00", end: "08:00", company: myCompany?.id ?? null, comment: "SiteSnap test delay" }, photos: photo },
      deliveries: { entry: { what: "SiteSnap test delivery", time: "10:00", from: myCompany?.name ?? "SiteSnap test", comment: "SiteSnap test" }, photos: [] },
      notes: { entry: { text: "SiteSnap test note" }, photos: photo },
    };
    const made = {};
    raw.create = {};
    for (const s of SECTION_KEYS) {
      const t = tests[s];
      const fields = procoreFields(s, t.entry, { date: today });
      const r = await send("POST", `/rest/v1.0/projects/${p}/${SECTIONS[s].path}`, requestFor(s, fields, t.photos));
      raw.create[s] = { sent: { ...fields, attachments: t.photos.length }, status: r.status, answer: r.ok ? r.json : brief(r), headers: r.headers };
      if (r.ok) made[s] = r.json?.id;
      const a = r.json ?? {};
      const kept = s === "manpower" ? `workers ${a.num_workers ?? "?"}, hours ${a.num_hours ?? "?"}, company ${a.contact?.name ?? a.vendor?.name ?? "BLANK"}`
        : s === "delays" ? `type ${a.delay_type?.name ?? a.delay_type ?? "BLANK"}, ${a.start_time ?? "?"}–${a.end_time ?? "?"}, duration ${a.duration ?? "?"}, comments "${a.comments ?? a.notes ?? a.description ?? "BLANK"}", photos ${Array.isArray(a.attachments) ? a.attachments.length : "?"}`
        : s === "deliveries" ? `from "${a.delivery_from ?? "BLANK"}", contents "${a.contents ?? "BLANK"}", time ${a.time_hour ?? "?"}:${a.time_minute ?? "?"}`
        : `comment "${a.comment ?? "BLANK"}", photos ${Array.isArray(a.attachments) ? a.attachments.length : "?"}`;
      step(`Add a test ${SECTIONS[s].label} entry${t.photos.length ? " with a photo" : ""}`, r, r.ok ? `Made id ${a.id} (status ${a.status ?? "not shown"}). Procore kept: ${kept}` : r.status === 403 ? "Procore said no: this person can't add this" : `Procore answered ${r.status}: ${brief(r)}`);
    }

    // 4. Read back (B9 step 3)
    for (const s of SECTION_KEYS) {
      if (!made[s]) continue;
      const r = await send("GET", `/rest/v1.0/projects/${p}/${SECTIONS[s].path}`, { query: { log_date: today } });
      const found = Array.isArray(r.json) && r.json.some((x) => x.id === made[s]);
      step(`Read back the ${SECTIONS[s].label} entry`, { ok: r.ok && found, status: r.status }, found ? "Found in today's list" : `Not in today's list (${r.status})`);
    }

    // 5. Rate-limit headers (B9 step 7)
    const rl = Object.values(raw.create).map((c) => c.headers).find((h) => h?.["x-rate-limit-limit"]) ?? {};
    steps.push({ name: "Rate-limit headers", ok: !!rl["x-rate-limit-limit"], status: 200, detail: rl["x-rate-limit-limit"] ? `limit ${rl["x-rate-limit-limit"]}, remaining ${rl["x-rate-limit-remaining"]}, reset ${rl["x-rate-limit-reset"]}` : "Not shown on these answers" });

    // 6. Clean up (B9 step 8), only when asked
    if (body.cleanup) {
      for (const s of SECTION_KEYS) {
        if (!made[s]) continue;
        const r = await send("DELETE", `/rest/v1.0/projects/${p}/${SECTIONS[s].path}/${made[s]}`);
        step(`Delete the test ${SECTIONS[s].label} entry`, r, r.ok ? "Deleted" : `Procore answered ${r.status}: ${brief(r)} (it stays, labeled "SiteSnap test")`);
      }
    }

    sendJson(res, 200, { who, steps, raw });
  } catch (err) {
    sendError(res, err);
  }
}
