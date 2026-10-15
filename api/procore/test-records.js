// Step 1 of SPEC_voice-photo-to-procore-record: prove SiteSnap can write real Procore records.
// GET  /api/procore/test-records : a small page (sign in with Procore first) with a Run Test button.
// POST /api/procore/test-records : with the signed-in person's own Procore sign-in, in the chosen project:
//   reads the Observation types and statuses, uploads a labeled test photo and a 1-second test sound,
//   creates one Observation and one Punch Item named "SiteSnap API test" with both attached (a Punch Item
//   is tried again with the signed-in person as manager and final approver if Procore asks for them),
//   and lists the webhook event names Procore offers. Reports every step's result; never a token.
// Sandbox only (PROCORE_API_URL must be Procore's sandbox). Same-origin JSON for the POST.
import { config, HttpError, procoreGet, procoreId, requireSameOriginJson, readBody, sendError, sendJson } from "../_procore.js";
import { listProjects } from "../_projects.js";
import { procoreSend, uploadFile } from "../_procoreWrite.js";
import { TEST_PHOTO_JPEG_B64 } from "../_testPhoto.js";

// 1 second of a soft 440 Hz tone as a WAV file (8 kHz, 16-bit mono)
function testSound() {
  const rate = 8000;
  const n = rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 6000), 44 + i * 2);
  return buf;
}

// What Procore said, without anything large: the status and its error text
const brief = (r) => ({ status: r.status, ok: r.ok, ...(r.ok ? {} : { error: r.json?.errors ?? r.json?.message ?? r.json?.error ?? null }) });

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SiteSnap AI · Procore API test</title>
<style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#000;color:#f5efe6;max-width:640px;margin:0 auto;padding:24px 16px}
button{font:inherit;font-size:20px;font-weight:700;padding:14px 20px;border:0;border-radius:14px;background:#ffb81c;color:#1f1a14;width:100%;margin:8px 0}
select{font:inherit;font-size:17px;width:100%;padding:12px;border-radius:12px;background:#221d18;color:#f5efe6;border:1px solid #3a332b}
.step{background:#221d18;border-radius:12px;padding:10px 14px;margin:8px 0}.ok{color:#30d158}.bad{color:#ff5f57}a{color:#ffc24d}small{color:#b8ac9c}</style></head>
<body><h1>Procore API test</h1>
<p>Creates one <b>Observation</b> and one <b>Punch Item</b> named "SiteSnap API test" in the project you pick, each with a test photo and a 1-second test sound attached. It uses your own Procore sign-in. You can delete them in Procore afterwards.</p>
<p id="who"><small>Checking your Procore sign-in…</small></p>
<label for="p">Project</label> <select id="p"></select>
<button id="run" disabled>Run Test</button>
<div id="out"></div>
<script>
const $=(s)=>document.querySelector(s);
fetch('/api/procore/projects').then(async(r)=>{
  if(r.status===401){ $('#who').innerHTML='Not signed in. <a href="/api/procore/login">Sign in with Procore</a>, then come back to this page.'; return; }
  const b=await r.json(); const list=b.projects||[];
  $('#who').innerHTML='<small>Signed in. '+list.length+' project(s).</small>';
  for(const p of list){ const o=document.createElement('option'); o.value=p.companyId+'_'+p.projectId; o.textContent=p.name; if(/sandbox test/i.test(p.name)) o.selected=true; $('#p').append(o); }
  $('#run').disabled=!list.length;
});
$('#run').onclick=async()=>{
  $('#run').disabled=true; $('#out').innerHTML='<p>Running… (about 15 seconds)</p>';
  const [companyId,projectId]=$('#p').value.split('_');
  const r=await fetch('/api/procore/test-records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId,projectId})});
  const b=await r.json().catch(()=>({message:'No answer'}));
  if(!r.ok){ $('#out').innerHTML='<p class="bad">'+(b.message||'Failed')+'</p>'; $('#run').disabled=false; return; }
  $('#out').innerHTML=(b.steps||[]).map(s=>'<div class="step"><b class="'+(s.ok?'ok':'bad')+'">'+(s.ok?'✓':'✗')+' '+s.name+'</b><br><small>'+s.detail+'</small>'+(s.link?'<br><a href="'+s.link+'" target="_blank" rel="noopener">Open in Procore</a>':'')+'</div>').join('')
    +'<p><small>Copy everything above (or take a screenshot) and send it to Claude.</small></p><pre style="white-space:pre-wrap;font-size:12px;color:#b8ac9c">'+JSON.stringify(b.raw,null,1)+'</pre>';
  $('#run').disabled=false;
};
</script></body></html>`;

export default async function handler(req, res) {
  try {
    const cfg = config();
    if (!/sandbox/i.test(cfg.apiUrl)) throw new HttpError(403, "not_sandbox", "This test only runs against Procore's sandbox.");
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
    // Only a project this person can open
    const { projects } = await listProjects(req, res, cfg);
    const project = projects.find((p) => p.companyId === companyId && p.projectId === projectId);
    if (!project) throw new HttpError(403, "no_access", "You're not on that project in Procore.");

    const steps = [];
    const raw = {};
    const step = (name, ok, detail, link) => steps.push({ name, ok, detail, ...(link ? { link } : {}) });
    const web = cfg.apiUrl.replace(/\/+$/, "");
    const at = new Date().toISOString().replace("T", " ").slice(0, 16);

    const me = await procoreGet(req, res, cfg, "/rest/v1.0/me", { companyId, query: { company_id: companyId } });
    step("Signed in", true, `${me?.name ?? me?.login ?? "you"} (Procore user ${me?.id})`);

    // Observation types and statuses for this project
    const types = await procoreSend(req, res, cfg, "GET", `/rest/v1.0/projects/${projectId}/observation_types`, { companyId });
    const typeList = Array.isArray(types.json) ? types.json : [];
    raw.observationTypes = typeList.map((t) => ({ id: t.id, name: t.name, category: t.category, active: t.active }));
    const type = typeList.find((t) => t.active !== false) ?? typeList[0];
    step("Observation types", types.ok && !!type, types.ok ? `${typeList.length} found${type ? `; using "${type.name}"` : "; none, so no Observation can be made"}` : `Procore answered ${types.status}`);
    const statuses = await procoreSend(req, res, cfg, "GET", `/rest/v1.0/projects/${projectId}/observations/items/statuses`, { companyId });
    raw.observationStatuses = statuses.ok ? statuses.json : brief(statuses);

    // Attachments: one photo, one short sound
    const photo = await uploadFile(req, res, cfg, { companyId, projectId, name: "SiteSnap-API-test-photo.jpg", type: "image/jpeg", bytes: Buffer.from(TEST_PHOTO_JPEG_B64, "base64") });
    step("Upload test photo", photo.ok, photo.ok ? `upload ${photo.uuid}` : `${photo.step}: Procore answered ${photo.status}`);
    const sound = await uploadFile(req, res, cfg, { companyId, projectId, name: "SiteSnap-API-test-voice.wav", type: "audio/wav", bytes: testSound() });
    step("Upload test sound (stands in for a voice note)", sound.ok, sound.ok ? `upload ${sound.uuid}` : `${sound.step}: Procore answered ${sound.status}`);
    const uploadIds = [photo, sound].filter((u) => u.ok).map((u) => u.uuid);
    const text = `SiteSnap API test, ${at} UTC. Safe to delete.\n\nReported by ${me?.name ?? "the signed-in user"} via SiteSnap AI.\n\nTranscript: "Test only: this item was created by SiteSnap's Procore connection test."`;

    // Observation
    if (type) {
      const obs = await procoreSend(req, res, cfg, "POST", "/rest/v1.0/observations/items", {
        companyId,
        body: { project_id: Number(projectId), observation: { name: "SiteSnap API test: observation", type_id: type.id, description: text, status: "initiated", upload_ids: uploadIds } },
      });
      raw.observation = obs.ok ? { id: obs.json?.id, number: obs.json?.number, status: obs.json?.status, attachments: (obs.json?.attachments ?? []).length } : brief(obs);
      step("Create Observation", obs.ok, obs.ok ? `#${obs.json?.number ?? "?"} (id ${obs.json?.id}), ${(obs.json?.attachments ?? []).length} attachment(s), status ${obs.json?.status ?? "?"}` : `Procore answered ${obs.status}: ${JSON.stringify(brief(obs).error)}`,
        obs.ok ? `${web}/${projectId}/project/observations/items/${obs.json?.id}` : null);
    }

    // Punch Item: first with only what the API requires, then with a manager and final approver
    const punchBody = (extra) => ({ project_id: Number(projectId), punch_item: { name: "SiteSnap API test: punch item", description: text, reference: `Reported by ${me?.name ?? "user"} via SiteSnap AI`, upload_ids: uploadIds, ...extra } });
    let punch = await procoreSend(req, res, cfg, "POST", "/rest/v1.1/punch_items", { companyId, body: punchBody({}) });
    raw.punchFirstTry = brief(punch);
    if (!punch.ok && me?.id) {
      punch = await procoreSend(req, res, cfg, "POST", "/rest/v1.1/punch_items", { companyId, body: punchBody({ punch_item_manager_id: me.id, final_approver_id: me.id }) });
      raw.punchSecondTry = brief(punch);
    }
    if (punch.ok) raw.punchItem = { id: punch.json?.id, position: punch.json?.position, status: punch.json?.status, workflow_status: punch.json?.workflow_status, attachments: (punch.json?.attachments ?? []).length };
    step("Create Punch Item", punch.ok, punch.ok ? `#${punch.json?.position ?? "?"} (id ${punch.json?.id}), ${(punch.json?.attachments ?? []).length} attachment(s), ${punch.json?.workflow_status ?? punch.json?.status ?? ""}${raw.punchSecondTry ? " (needed a manager and final approver)" : ""}` : `Procore answered ${punch.status}: ${JSON.stringify(brief(punch).error)}`,
      punch.ok ? `${web}/${projectId}/project/punch_list/${punch.json?.id}` : null);

    // Webhook event names Procore offers for this project (read-only)
    const hooks = await procoreSend(req, res, cfg, "GET", "/rest/v1.0/webhooks/resources", { companyId, query: { project_id: projectId } });
    const names = Array.isArray(hooks.json) ? hooks.json.map((r) => r.name ?? r.resource_name ?? r).filter(Boolean) : [];
    raw.webhookResources = hooks.ok ? names : brief(hooks);
    step("Webhook events available", hooks.ok, hooks.ok ? `${names.length} resources: ${names.filter((n) => /observ|punch|change/i.test(String(n))).join(", ") || "(none for these tools)"}` : `Procore answered ${hooks.status}`);

    console.log("SiteSnap API test", JSON.stringify(steps.map((s) => ({ name: s.name, ok: s.ok }))));
    sendJson(res, 200, { project: project.name, steps, raw });
  } catch (err) {
    sendError(res, err);
  }
}
