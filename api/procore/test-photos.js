// Project photos, Step 0 (sandbox check before building; docs/sitesnap-project-home-and-photos-spec.md section 6).
// GET  /api/procore/test-photos : a small page (sign in with Procore first) with a Run Check button.
// POST /api/procore/test-photos : with the signed-in person's own Procore sign-in, answers the six blocking
//   questions against the real Photos tool: can SiteSnap create an album, does an upload work for this person,
//   does a description stick (at creation and by update, and how long), how to list by album / date / trade,
//   what the thumbnail links need, and the rate-limit headers. Writes ONE test album ("SiteSnap test album",
//   public, reused on later runs) and ONE test photo into it; delete them in Procore afterwards if you like.
// Run it as an admin, then as a test person with less than Standard on Photos, to see the refusal.
// Sandbox only (PROCORE_API_URL must be Procore's sandbox). Same-origin JSON for the POST.
import { config, HttpError, procoreId, requireSameOriginJson, readBody, sendError, sendJson } from "../_procore.js";
import { listProjects } from "../_projects.js";
import { procoreSend, uploadFile } from "../_procoreWrite.js";
import { TEST_PHOTO_JPEG_B64 } from "../_testPhoto.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const pace = { gapMs: 450 }; // Procore allows about 25 calls per 10 seconds
export const TEST_ALBUM = "SiteSnap test album";
const LONG = 3000; // characters tried for the description limit

// The project's own date (Procore keeps a time zone per project), as YYYY-MM-DD
function projectDate(timeZone) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "America/Los_Angeles" }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}
// What a link needs, never the link itself: host, whether it signs/expires, and the query names only
function linkShape(u) {
  try {
    const url = new URL(u);
    const names = [...url.searchParams.keys()];
    return { host: url.host, query: names, signed: names.some((n) => /signature|expires|token|policy|key-pair/i.test(n)) };
  } catch { return { host: null, query: [], signed: false }; }
}
const brief = (r) => (r.ok ? null : typeof r.json === "object" ? JSON.stringify(r.json).slice(0, 300) : String(r.json ?? ""));

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SiteSnap AI · Photos check</title>
<style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#000;color:#f5efe6;max-width:640px;margin:0 auto;padding:24px 16px}
button{font:inherit;font-size:20px;font-weight:700;padding:14px 20px;border:0;border-radius:14px;background:#ffb81c;color:#1f1a14;width:100%;margin:8px 0}
select{font:inherit;font-size:17px;width:100%;padding:12px;border-radius:12px;background:#221d18;color:#f5efe6;border:1px solid #3a332b}
.step{background:#221d18;border-radius:12px;padding:10px 14px;margin:8px 0}.ok{color:#30d158}.bad{color:#ff5f57}.maybe{color:#ffc24d}a{color:#ffc24d}small{color:#b8ac9c}img{max-width:120px;border-radius:8px;margin-top:6px}</style></head>
<body><h1>Photos check</h1>
<p>Checks what SiteSnap can do with Procore's <b>Photos</b> tool before we build Project photos. It makes <b>one album</b> called "${TEST_ALBUM}" (only the first time) and puts <b>one test photo</b> in it, using your own Procore sign-in. You can delete them in Procore afterwards.</p>
<p id="who"><small>Checking your Procore sign-in…</small></p>
<p><small><b>To run it as someone else</b> (a test person with less than Standard on Photos): open this page in a <b>private / incognito window</b>, tap Sign in with Procore, and log in to Procore as that person.</small></p>
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
  $('#run').disabled=true; $('#out').innerHTML='<p>Checking… (about 20 seconds)</p>';
  const [companyId,projectId]=$('#p').value.split('_');
  const r=await fetch('/api/procore/test-photos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({companyId,projectId})});
  const b=await r.json().catch(()=>({message:'No answer'}));
  if(!r.ok){ $('#out').innerHTML='<p class="bad">'+esc(b.message||'Failed')+'</p>'; $('#run').disabled=false; return; }
  $('#out').innerHTML='<p><b>'+esc(b.who)+'</b></p>'+(b.steps||[]).map(s=>'<div class="step"><b class="'+(s.ok?'ok':s.status===404?'maybe':'bad')+'">'+(s.ok?'✓':'✗')+' '+esc(s.name)+'</b> <small>('+s.status+')</small><br><small>'+esc(s.detail)+'</small></div>').join('')
    +(b.thumb?'<p><small>Thumbnail as the page loads it (no Procore sign-in sent):</small><br><img src="'+esc(b.thumb)+'" alt="test photo thumbnail"></p>':'')
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
    const q = (extra = {}) => ({ project_id: p, ...extra });

    const me = await send("GET", "/rest/v1.0/me", { query: { company_id: companyId } });
    const proj = await send("GET", `/rest/v1.0/projects/${p}`, { query: { company_id: companyId } });
    const today = projectDate(proj.json?.time_zone);
    raw.project = { timeZone: proj.json?.time_zone ?? null, today };
    // The person's permission template on this project (the Photos level inside it is admin-only to read)
    const users = await send("GET", `/rest/v1.0/projects/${p}/users`, { query: { per_page: 200 } });
    const mine = Array.isArray(users.json) ? users.json.find((u) => String(u.id) === String(me.json?.id)) : null;
    const template = mine?.permission_template?.name ?? "none shown";
    raw.template = template;
    const who = `Signed in as ${me.json?.name ?? "?"} (template here: ${template}). Project date today: ${today} (${proj.json?.time_zone ?? "time zone not shown"})`;

    // 1. Albums: list, then find or create the test album (public)
    const cats = await send("GET", "/rest/v1.0/image_categories", { query: q({ per_page: 100 }) });
    const albums = Array.isArray(cats.json) ? cats.json : [];
    raw.albums = { keys: albums[0] ? Object.keys(albums[0]) : [], list: albums.slice(0, 20).map((a) => ({ id: a.id, name: a.name, private: a.private, count: a.count, cover_photo: a.cover_photo && typeof a.cover_photo === "object" ? Object.keys(a.cover_photo) : a.cover_photo ?? null })), headers: cats.headers };
    step("List albums", cats, cats.ok ? `${albums.length} album(s); ${albums.filter((a) => a.private).length} private. ${albums.slice(0, 8).map((a) => `${a.name}${a.private ? " (private)" : ""}: ${a.count ?? "?"}`).join(", ")}`
      : cats.status === 403 ? "Procore said no: this person can't see Photos here (or the tool is off in this project)" : `Procore answered ${cats.status}: ${brief(cats)}`);
    let album = albums.find((a) => a.name === TEST_ALBUM);
    if (album) {
      steps.push({ name: "Create an album (question 1)", ok: true, status: 200, detail: `"${TEST_ALBUM}" already exists from an earlier run (id ${album.id}); not made again` });
    } else {
      const made = await send("POST", "/rest/v1.0/image_categories", { query: q(), body: { image_category: { name: TEST_ALBUM, private: false } } });
      if (made.ok) album = made.json;
      raw.createAlbum = made.ok ? { id: made.json?.id, private: made.json?.private, keys: Object.keys(made.json ?? {}) } : { error: brief(made) };
      step("Create an album (question 1)", made, made.ok ? `Yes: made "${made.json?.name}" (id ${made.json?.id}, private: ${made.json?.private})` : `No: Procore answered ${made.status}: ${brief(made)}`);
    }
    // Can't make one (the spec's fallback): try the upload into an existing public album instead
    if (!album) {
      album = albums.find((a) => !a.private);
      if (album) steps.push({ name: "Fallback: use an existing album", ok: true, status: 200, detail: `uploading into "${album.name}" (id ${album.id}) instead` });
      else steps.push({ name: "Fallback: use an existing album", ok: false, status: 0, detail: "no public album to upload into" });
    }

    // Native trade and location fields, if the project has any (Create Image takes trade_ids and location_id)
    const trades = await send("GET", `/rest/v1.0/companies/${companyId}/trades`, { query: { per_page: 5 } });
    const trade = Array.isArray(trades.json) ? trades.json.find((t) => t.active !== false) : null;
    const locs = await send("GET", `/rest/v1.0/projects/${p}/locations`, { query: { per_page: 5 } });
    const loc = Array.isArray(locs.json) ? locs.json[0] : null;
    step("Trades and locations to tag the photo with", { ok: trades.ok && locs.ok, status: trades.ok ? locs.status : trades.status },
      `Trades: ${trades.ok ? (trade ? `using "${trade.name}" (id ${trade.id})` : "none in the company") : `not readable (${trades.status})`}. Locations: ${locs.ok ? (loc ? `using "${loc.name}" (id ${loc.id})` : "none in the project") : `not readable (${locs.status})`}`);

    // 2 + 3. Upload one photo into the album with a description, date, trade and location
    let image = null;
    if (album?.id) {
      const up = await uploadFile(req, res, cfg, { companyId, projectId, name: "SiteSnap-photos-test.jpg", type: "image/jpeg", bytes: Buffer.from(TEST_PHOTO_JPEG_B64, "base64") });
      steps.push({ name: "Upload the photo file (upload slot)", ok: up.ok, status: up.ok ? 200 : up.status, detail: up.ok ? `upload ${up.uuid}` : `failed at ${up.step}: ${JSON.stringify(up.error ?? "").slice(0, 300)}` });
      if (up.ok) {
        const desc = `SiteSnap test photo. Captured by ${me.json?.name ?? "?"} at ${new Date().toISOString()}. Trade: ${trade?.name ?? "none"}. Safe to delete.`;
        const imageBody = (extra) => ({ upload_uuid: up.uuid, image_name: "SiteSnap-photos-test.jpg", image: { image_category_id: album.id, private: false, description: desc, log_date: today, source: "SiteSnap", ...extra } });
        const extra = { ...(trade ? { trade_ids: [trade.id] } : {}), ...(loc ? { location_id: loc.id } : {}) };
        let made = await send("POST", "/rest/v1.0/images", { query: q(), body: imageBody(extra) });
        if (!made.ok && Object.keys(extra).length && made.status === 422) {
          raw.firstTryWithTradeLocation = brief(made);
          made = await send("POST", "/rest/v1.0/images", { query: q(), body: imageBody({}) });
        }
        if (made.ok) image = made.json;
        raw.createImage = made.ok ? {
          keys: Object.keys(made.json ?? {}), id: made.json?.id, image_category_id: made.json?.image_category_id, private: made.json?.private,
          description: made.json?.description, log_date: made.json?.log_date ?? null, taken_at: made.json?.taken_at ?? null,
          trades: (made.json?.trades ?? []).map((t) => t.name), location: made.json?.location?.name ?? null, uploader: made.json?.uploader?.name ?? null,
          width: made.json?.width, height: made.json?.height, size: made.json?.size, headers: made.headers,
        } : { error: brief(made) };
        step("Add a photo to the album (question 2)", made, made.ok
          ? `Yes: photo id ${made.json?.id} in "${made.json?.image_category_name ?? album.name}", private: ${made.json?.private}, uploader ${made.json?.uploader?.name ?? "?"}`
          : made.status === 403 ? `No: Procore refused (403). This person needs Standard or higher on Photos. SiteSnap would say: "You don't have permission to add photos to this project."` : `No: Procore answered ${made.status}: ${brief(made)}`);
        if (made.ok) {
          const kept = made.json?.description === desc;
          steps.push({ name: "Description set when the photo is created (question 3)", ok: kept, status: made.status, detail: kept ? "kept exactly" : `came back as: ${JSON.stringify(made.json?.description ?? null)}` });
          const tr = (made.json?.trades ?? []).map((t) => t.name);
          steps.push({ name: "Trade and location stored on the photo", ok: !trade || tr.includes(trade.name), status: made.status,
            detail: `trades: ${tr.join(", ") || "none"}; location: ${made.json?.location?.name ?? "none"}${raw.firstTryWithTradeLocation ? ` (first try with them was refused: ${raw.firstTryWithTradeLocation})` : ""}` });
        }
      }
    }

    if (image?.id) {
      // 3b. A long description by update, then read it back
      const long = `SiteSnap length test. ${"x".repeat(LONG)}`.slice(0, LONG);
      const upd = await send("PATCH", `/rest/v1.0/images/${image.id}`, { query: q(), body: { image: { description: long } } });
      const back = await send("GET", `/rest/v1.0/images/${image.id}`, { query: q() });
      const len = typeof back.json?.description === "string" ? back.json.description.length : null;
      raw.updateDescription = { status: upd.status, error: brief(upd), lengthBack: len };
      step("Description changed later, 3,000 characters (question 3)", upd, upd.ok ? `update accepted; read back ${len ?? "?"} characters${len === LONG ? " (all kept)" : ""}` : `Procore answered ${upd.status}: ${brief(upd)}`);

      // 4. Listing: by album, by created date, by log date, by trade; paging headers
      const byAlbum = await send("GET", "/rest/v1.0/images", { query: q({ image_category_id: album.id, per_page: 1, page: 1, sort: "-created_at" }) });
      raw.listByAlbum = { count: Array.isArray(byAlbum.json) ? byAlbum.json.length : null, headers: byAlbum.headers, keys: Array.isArray(byAlbum.json) && byAlbum.json[0] ? Object.keys(byAlbum.json[0]) : [] };
      step("List photos in an album, 1 per page (question 4)", byAlbum, byAlbum.ok ? `Total header: ${byAlbum.headers?.total ?? "none"}; Per-Page: ${byAlbum.headers?.["per-page"] ?? "none"}; Link: ${byAlbum.headers?.link ? "yes" : "none"}` : `Procore answered ${byAlbum.status}: ${brief(byAlbum)}`);
      const filters = [
        ["created today", { "filters[created_at]": `${today}...${today}` }],
        ["log date today", { "filters[log_date]": today }],
        ...(trade ? [["this trade", { "filters[trade_ids][]": trade.id }]] : []),
      ];
      for (const [label, f] of filters) {
        const r = await send("GET", "/rest/v1.0/images", { query: q({ ...f, per_page: 100 }) });
        const list = Array.isArray(r.json) ? r.json : [];
        raw[`filter: ${label}`] = { count: list.length, total: r.headers?.total ?? null, includesTestPhoto: list.some((x) => x.id === image.id) };
        step(`List photos ${label} (question 4)`, r, r.ok ? `${r.headers?.total ?? list.length} photo(s); test photo ${list.some((x) => x.id === image.id) ? "is" : "is NOT"} in the list` : `Procore answered ${r.status}: ${brief(r)}`);
      }

      // 5. Thumbnails: which fields, and do they open without a Procore sign-in?
      const shown = back.json ?? image;
      const urlFields = Object.keys(shown).filter((k) => /url/i.test(k) && typeof shown[k] === "string");
      raw.thumbnails = {};
      for (const k of urlFields) {
        let status = null, type = null;
        try { const t = await fetch(shown[k], { method: "GET", redirect: "follow" }); status = t.status; type = t.headers.get("content-type"); } catch { status = "network error"; }
        raw.thumbnails[k] = { ...linkShape(shown[k]), openWithoutSignIn: status, contentType: type };
      }
      const th = raw.thumbnails.thumbnail_url;
      steps.push({ name: "Thumbnail link (question 5)", ok: th?.openWithoutSignIn === 200, status: typeof th?.openWithoutSignIn === "number" ? th.openWithoutSignIn : 0,
        detail: th ? `thumbnail_url on ${th.host}; opens without a Procore sign-in: ${th.openWithoutSignIn}; ${th.contentType ?? "?"}; ${th.signed ? `signed link (expires; query: ${th.query.join(", ")})` : "not a signed link"}. Other link fields: ${urlFields.filter((k) => k !== "thumbnail_url").join(", ") || "none"}` : `no thumbnail_url; link fields: ${urlFields.join(", ") || "none"}` });
      raw.thumbUrl = shown.thumbnail_url ?? null;
    }

    // 6. Rate limits, from the last answers' headers
    const rl = raw.listByAlbum?.headers ?? cats.headers ?? {};
    steps.push({ name: "Rate limit headers (question 6)", ok: !!rl["x-rate-limit-limit"], status: 200, detail: rl["x-rate-limit-limit"] ? `limit ${rl["x-rate-limit-limit"]}, remaining ${rl["x-rate-limit-remaining"]}, resets ${rl["x-rate-limit-reset"]}` : "no rate-limit headers in the answer" });

    console.log("SiteSnap photos check", JSON.stringify(steps.map((s) => ({ name: s.name, status: s.status }))));
    const thumb = raw.thumbUrl;
    delete raw.thumbUrl;
    sendJson(res, 200, { who, steps, raw, thumb });
  } catch (err) {
    sendError(res, err);
  }
}
