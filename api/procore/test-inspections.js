// Inspections, sandbox check (sitesnap-inspections-spec.md section 2; docs/inspections-api-notes.md section 7).
// Confirms the Procore side with the signed-in person's own Procore sign-in and exactly the requests the app sends
// (api/_inspections.js).
// GET  /api/procore/test-inspections : a small page (sign in with Procore first) with a Run Check button.
// POST /api/procore/test-inspections : READS ONLY unless { write: true }: the project's inspections (fields, counts,
//   who's an inspector, responsible contractor), one inspection's sections and items (kinds, response sets,
//   answers, section N/A), the lighter items list. With write: answers ONE item N/A on the picked inspection's LAST
//   item, reads the counts again, tries to clear it, toggles the last section N/A and back, and adds a test note.
// Run it as Edward (admin), Chloe (Foreman / Superintendent - Internal) and Derek (Subcontractor - External) to see
// who gets a 403. Sandbox only. Same-origin JSON for the POST.
import { config, HttpError, procoreId, requireSameOriginJson, readBody, sendError, sendJson } from "../_procore.js";
import { listProjects } from "../_projects.js";
import { procoreSend } from "../_procoreWrite.js";
import { groupInspections, inspectionDetail, inspectionSummary, PATHS, responseBody } from "../_inspections.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pace = { gapMs: 450 }; // Procore allows about 25 calls per 10 seconds
const brief = (r) => (r.ok ? null : typeof r.json === "object" ? JSON.stringify(r.json).slice(0, 400) : String(r.json ?? ""));
const shape = (o) => (o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && typeof v === "object" ? (Array.isArray(v) ? `[${v.length}]` : `{${Object.keys(v).join(",")}}`) : v])) : o);

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SiteSnap AI · Inspections check</title>
<style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#000;color:#f5efe6;max-width:640px;margin:0 auto;padding:24px 16px}
button{font:inherit;font-size:20px;font-weight:700;padding:14px 20px;border:0;border-radius:14px;background:#ffb81c;color:#1f1a14;width:100%;margin:8px 0}
select,input[type=text]{font:inherit;font-size:17px;width:100%;box-sizing:border-box;padding:12px;border-radius:12px;background:#221d18;color:#f5efe6;border:1px solid #3a332b}
label.cb{display:flex;gap:10px;align-items:center;margin:10px 0}label.cb input{width:22px;height:22px}
.step{background:#221d18;border-radius:12px;padding:10px 14px;margin:8px 0}.ok{color:#30d158}.bad{color:#ff5f57}.maybe{color:#ffc24d}a{color:#ffc24d}small{color:#b8ac9c}</style></head>
<body><h1>Inspections check</h1>
<p>Checks what SiteSnap can do with Procore's <b>Inspections</b> before foremen use it, with your own Procore sign-in. <b>Run Check</b> only reads. <b>Run Write Check</b> also tries saving.</p>
<p id="who"><small>Checking your Procore sign-in…</small></p>
<p><small><b>To run it as someone else</b> (a foreman or a subcontractor foreman): open this page in a <b>private / incognito window</b>, tap Sign in with Procore, and log in to Procore as that person.</small></p>
<label for="p">Project</label> <select id="p"></select>
<p><label for="q">Inspection to look at (part of its name)</label> <input type="text" id="q" value="Site Safety Inspection #2"></p>
<button id="run" disabled>Run Check (read only)</button>
<button id="runw" disabled style="background:#3a332b;color:#ffc24d">Run Write Check</button>
<p><small>Write Check answers the LAST item N/A and tries to clear it, sets the last section N/A and back, and adds a test note.</small></p>
<div id="out"></div>
<script>
const $=(s)=>document.querySelector(s);
const esc=(s)=>String(s??'').replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
fetch('/api/procore/projects').then(async(r)=>{
  if(r.status===401){ $('#who').innerHTML='Not signed in. <a href="/api/procore/login">Sign in with Procore</a>, then come back to this page.'; return; }
  const b=await r.json(); const list=b.projects||[];
  $('#who').innerHTML='<small>Signed in. '+list.length+' project(s).</small>';
  for(const p of list){ const o=document.createElement('option'); o.value=p.companyId+'_'+p.projectId; o.textContent=p.name; if(/westgate/i.test(p.name)) o.selected=true; $('#p').append(o); }
  $('#run').disabled=!list.length; $('#runw').disabled=!list.length;
});
const go=async(write)=>{
  $('#run').disabled=true; $('#runw').disabled=true; $('#out').innerHTML='<p>Checking… (about 15 seconds)</p>';
  const [companyId,projectId]=$('#p').value.split('_');
  const r=await fetch('/api/procore/test-inspections',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId,projectId,match:$('#q').value,write})});
  const b=await r.json().catch(()=>({message:'No answer'}));
  if(!r.ok){ $('#out').innerHTML='<p class="bad">'+esc(b.message||'Failed')+'</p>'; $('#run').disabled=false; $('#runw').disabled=false; return; }
  $('#out').innerHTML='<p><b>'+esc(b.who)+'</b> · '+(write?'WRITE check':'read-only check')+'</p>'+(b.steps||[]).map(s=>'<div class="step"><b class="'+(s.ok?'ok':s.status===404?'maybe':'bad')+'">'+(s.ok?'✓':'✗')+' '+esc(s.name)+'</b> <small>('+s.status+')</small><br><small>'+esc(s.detail)+'</small></div>').join('')
    +'<p><small>Copy everything on this page (or take screenshots) and send it to Claude.</small></p><pre style="white-space:pre-wrap;font-size:12px;color:#b8ac9c">'+esc(JSON.stringify(b.raw,null,1))+'</pre>';
  $('#run').disabled=false; $('#runw').disabled=false;
};
$('#run').onclick=()=>go(false);
$('#runw').onclick=()=>go(true);
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
    const users = await send("GET", `/rest/v1.0/projects/${p}/users`, { query: { per_page: 300 } });
    const mine = Array.isArray(users.json) ? users.json.find((u) => String(u.id) === String(me.json?.id)) : null;
    const template = mine?.permission_template?.name ?? "none shown";
    const myCompany = mine?.vendor?.id ? { id: String(mine.vendor.id), name: mine.vendor.name } : null;
    const who = `Signed in as ${me.json?.name ?? "?"} (id ${me.json?.id ?? "?"}; template here: ${template}; company: ${myCompany?.name ?? "not shown"})`;

    // 1. The project's inspections
    const lists = await send("GET", PATHS.lists(p), { query: { per_page: 100, sort: "number" } });
    const rows = Array.isArray(lists.json) ? lists.json : [];
    raw.list = { status: lists.status, count: rows.length, total: lists.headers?.total ?? null, first: shape(rows[0]) ?? null, error: brief(lists) };
    step("Read the project's inspections", lists, lists.ok ? `${rows.length} inspection(s): ${rows.slice(0, 8).map((r) => `${r.name} #${r.number} (${r.status})`).join("; ")}` : lists.status === 403 ? "Procore said no: this person can't see Inspections here" : `Procore answered ${lists.status}: ${brief(lists)}`);
    if (!lists.ok) return sendJson(res, 200, { who, steps, raw });
    const summaries = rows.map(inspectionSummary);
    const groups = groupInspections(summaries, { myId: me.json?.id, myCompanyId: myCompany?.id });
    raw.groups = { mine: groups.mine.map((r) => r.title), company: groups.company.map((r) => r.title), open: groups.open.map((r) => r.title) };
    steps.push({ name: "Fields the list needs", ok: rows.every((r) => r.number != null && Array.isArray(r.inspectors)), status: 200, detail: summaries.slice(0, 5).map((s, i) => `${s.title}: inspectors [${s.inspectors.map((x) => x.name).join(", ") || "none"}], responsible contractor ${s.responsibleContractor?.name ?? "BLANK"}, location ${s.location ?? "BLANK"}, due ${s.due ?? "BLANK"}, progress ${s.progress.done} of ${s.progress.total} (raw counts: item_count ${rows[i].item_count ?? "?"}, inspected ${rows[i].inspected_item_count ?? "?"}, conforming ${rows[i].conforming_item_count ?? "?"}, deficient ${rows[i].deficient_item_count ?? "?"}, n/a ${rows[i].not_applicable_item_count ?? rows[i].na_item_count ?? "?"})`).join(" | ") });
    steps.push({ name: "Groups", ok: true, status: 200, detail: `Assigned to me: ${raw.groups.mine.join(", ") || "none"}. My company's work: ${raw.groups.company.join(", ") || "none"}. Open: ${raw.groups.open.length}` });

    // 2. One inspection with its sections and items
    const want = String(body.match ?? "").trim().toLowerCase();
    const pick = summaries.find((s) => want && s.title.toLowerCase().includes(want)) ?? groups.mine[0] ?? summaries[0];
    if (!pick) return sendJson(res, 200, { who, steps, raw });
    const one = await send("GET", PATHS.list(pick.id), { query: { project_id: p } });
    if (!one.ok) { step(`Open ${pick.title}`, one, `Procore answered ${one.status}: ${brief(one)}`); return sendJson(res, 200, { who, steps, raw }); }
    const detail = inspectionDetail(one.json);
    const rs = Array.isArray(one.json?.sections) ? one.json.sections : [];
    const firstItem = rs.flatMap((s) => s.items ?? [])[0];
    raw.inspection = { keys: shape(one.json), section: shape(rs[0]), item: shape(firstItem), itemType: firstItem?.type ?? null, itemResponse: firstItem?.item_response ?? null, responseSet: firstItem?.response_set ?? null };
    const kinds = {};
    const types = new Set();
    for (const s of rs) for (const it of s.items ?? []) types.add(`${it.type?.category ?? "?"}/${it.type?.name ?? "?"} set:${it.response_set?.name ?? it.response_set?.id ?? "none"}`);
    for (const s of detail.sections) for (const it of s.items) kinds[it.kind] = (kinds[it.kind] ?? 0) + 1;
    step(`Open ${pick.title}`, one, `${detail.sections.length} section(s), ${detail.counts.total} item(s); answered ${detail.counts.answered} (pass ${detail.counts.pass}, fail ${detail.counts.fail}, n/a ${detail.counts.na}, neutral ${detail.counts.neutral}). Item kinds SiteSnap sees: ${JSON.stringify(kinds)}. Procore item types: ${[...types].slice(0, 6).join("; ")}`);
    steps.push({ name: "Section N/A field", ok: true, status: 200, detail: rs.length ? ("not_applicable" in rs[0] ? `not_applicable is on the section (first section: ${rs[0].not_applicable})` : "Not in Procore's read (known): SiteSnap remembers the sections it sets N/A. Sections set N/A in Procore's web app don't show yet.") : "No sections" });
    const repeats = new Map();
    for (const s of detail.sections) for (const it of s.items) repeats.set(it.text, [...(repeats.get(it.text) ?? []), it.number]);
    const dup = [...repeats.entries()].filter(([, n]) => n.length > 1).slice(0, 3);
    steps.push({ name: "Item numbers", ok: true, status: 200, detail: `${detail.sections.slice(0, 3).map((s) => `${s.number}. ${s.name} (${s.items.length})`).join(", ")}…${dup.length ? ` Repeated text told apart by number: ${dup.map(([t, n]) => `"${t.slice(0, 40)}" = ${n.join(" and ")}`).join("; ")}` : ""}` });
    const answered = detail.sections.flatMap((s) => s.items).filter((i) => i.answer).slice(0, 3);
    steps.push({ name: "Who answered", ok: true, status: 200, detail: answered.length ? answered.map((i) => `${i.number} ${i.answer.counts} by ${i.answer.by?.name ?? "not shown"} at ${i.answer.at ?? "?"}`).join("; ") : "No answered items yet" });

    // 3. The lighter items list
    const items = await send("GET", `/rest/v1.0/projects/${p}/checklist/list_items`, { query: { "filters[list_id][]": pick.id, per_page: 5, sort: "position_by_section" } });
    raw.listItems = { status: items.status, first: Array.isArray(items.json) ? shape(items.json[0]) : null, error: brief(items) };
    step("Read items (list_items)", items, items.ok ? `${Array.isArray(items.json) ? items.json.length : 0} item(s) back, total ${items.headers?.total ?? "?"}` : `Procore answered ${items.status}: ${brief(items)}`);

    // 4. Writing, only when asked: the last item and the last section
    if (body.write) {
      const lastSection = detail.sections.at(-1);
      const target = detail.sections.flatMap((s) => s.items).filter((i) => i.kind === "passfail").at(-1);
      if (target) {
        const r = await send("POST", PATHS.respond(p, target.id), { body: responseBody(target, { counts: "na" }) });
        raw.answer = { item: target.number, sent: responseBody(target, { counts: "na" }), status: r.status, answer: r.ok ? r.json : brief(r) };
        step(`Answer item ${target.number} N/A (item_response)`, r, r.ok ? `Saved: status ${r.json?.status ?? "?"}, by ${r.json?.responder?.name ?? "?"}` : r.status === 403 ? "Procore said no: this person can't answer items" : `Procore answered ${r.status}: ${brief(r)}`);
        if (!r.ok && r.status === 404) {
          const old = await send("PATCH", PATHS.item(pick.id, target.id), { body: { project_id: Number(p), section_id: Number(target.sectionId), item: { status: "n/a" } } });
          step(`Answer item ${target.number} N/A (older PATCH)`, old, old.ok ? `Saved: status ${old.json?.status ?? "?"}` : `Procore answered ${old.status}: ${brief(old)}`);
        }
        const again = await send("GET", PATHS.list(pick.id), { query: { project_id: p } });
        const now = again.ok ? inspectionDetail(again.json) : null;
        steps.push({ name: "Counts after answering", ok: !!now && now.counts.na > detail.counts.na, status: again.status, detail: now ? `n/a ${detail.counts.na} -> ${now.counts.na}; Procore's own counts now: n/a ${again.json?.na_item_count ?? again.json?.not_applicable_item_count ?? "?"}, not inspected ${again.json?.not_inspected_item_count ?? "?"}` : `Procore answered ${again.status}` });
        const n = await send("POST", PATHS.comment(pick.id), { body: { project_id: Number(p), item_id: Number(target.id), comment: { body: "SiteSnap test note" } } });
        raw.note = { status: n.status, answer: n.ok ? shape(n.json) : brief(n) };
        step(`Add a note to item ${target.number}`, n, n.ok ? "Saved as a comment on the item" : `Procore answered ${n.status}: ${brief(n)} (the note path is the least certain; notes stay in SiteSnap until this works)`);
      } else steps.push({ name: "Answer an item", ok: false, status: 0, detail: "No Pass / Fail / N/A item found" });
      if (lastSection) {
        for (const label of ["Section N/A on", "Section N/A back"]) {
          let r = await send("PATCH", PATHS.sectionToggle(pick.id, lastSection.id), { body: { project_id: Number(p) } });
          let way = "toggle_not_applicable";
          if (r.status === 404 || r.status === 405) { r = await send("PATCH", PATHS.section(pick.id, lastSection.id), { body: { project_id: Number(p), section: { name: lastSection.name, position: lastSection.position, not_applicable: label.endsWith("on") ? !lastSection.na : lastSection.na } } }); way = "section PATCH (deprecated)"; }
          raw[label] = { way, status: r.status, answer: r.ok ? r.json : brief(r) };
          step(`${label}: ${lastSection.name}`, r, r.ok ? `Worked via ${way}. Procore answered: ${JSON.stringify(shape(r.json)).slice(0, 300)}` : `Procore answered ${r.status} via ${way}: ${brief(r)}`);
          // The read has no not_applicable on sections: what changes when a section is N/A?
          const look = await send("GET", PATHS.list(pick.id), { query: { project_id: p } });
          const sec = (look.json?.sections ?? []).find((x) => String(x.id) === lastSection.id);
          raw[`${label} read`] = { section: sec ? shape(sec) : null, items: (sec?.items ?? []).map((i) => ({ status: i.status, responded_with: i.responded_with, item_response: i.item_response?.status ?? null })), counts: { na: look.json?.na_item_count, not_inspected: look.json?.not_inspected_item_count } };
          steps.push({ name: `${label}: what the read shows`, ok: look.ok, status: look.status, detail: sec ? `section keys: ${Object.keys(sec).join(", ")}; items: ${(sec.items ?? []).map((i) => `${i.status}/${i.responded_with}`).join(", ")}; inspection n/a count ${look.json?.na_item_count ?? "?"}, not inspected ${look.json?.not_inspected_item_count ?? "?"}` : "section not found" });
        }
      }
    }
    const rl = lists.headers ?? {};
    steps.push({ name: "Rate-limit headers", ok: !!rl["x-rate-limit-limit"], status: 200, detail: rl["x-rate-limit-limit"] ? `limit ${rl["x-rate-limit-limit"]}, remaining ${rl["x-rate-limit-remaining"]}` : "Not shown" });
    sendJson(res, 200, { who, steps, raw });
  } catch (err) {
    sendError(res, err);
  }
}
