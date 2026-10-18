// My items (sitesnap-report-picker-my-items-spec.md, section 6), with the signed-in person's own Procore sign-in.
// GET ?companyId=&projectId=                  : { groups: { overdue, open, ready }, counts: { open, overdue },
//     today, tools: { observations: ok|denied|error, punch: ... } }. A tool Procore refuses (403) is left out
//     quietly; only when both fail is it an error. Paged up to MAX_PAGES x PER_PAGE per tool.
// GET ?companyId=&projectId=&type=&id=        : one item for the detail view (description, photos, who assigned it).
// Marking an item fixed goes through the existing close-out: Composer + POST /api/procore/record-status.
// How Procore's rows become ours: api/_myItems.js.
import { config, HttpError, procoreId, queryOf, sendError, sendJson } from "../_procore.js";
import { procoreSend } from "../_procoreWrite.js";
import { projectDay } from "../_dailyLog.js";
import { recordUrl } from "../_records.js";
import { assignedToMe, countsOf, groupItems, itemDetail, itemRow, listQuery, MAX_PAGES, PATHS, PER_PAGE } from "../_myItems.js";

const TYPES = { observation: PATHS.observations, punch_item: PATHS.punch };

async function readAll(send, type, { projectId, myId, urlOf }) {
  const rows = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const r = await send(TYPES[type], listQuery(type, { projectId, myId, page }));
    if (!r.ok) return { state: r.status === 403 || r.status === 401 ? "denied" : "error", status: r.status, rows };
    const list = Array.isArray(r.json) ? r.json : [];
    rows.push(...list);
    if (list.length < PER_PAGE) break;
  }
  return { state: "ok", rows: rows.filter((x) => assignedToMe(type, x, myId)).map((x) => ({ ...itemRow(type, x), url: urlOf(type, x.id) })), seen: rows.length };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") throw new HttpError(405, "bad_request", "Use GET.");
    const cfg = config();
    const q = queryOf(req);
    const companyId = procoreId(q.get("companyId"));
    const projectId = procoreId(q.get("projectId"));
    if (!companyId || !projectId) throw new HttpError(400, "missing_ids", "Pick a project.");
    const send = (path, query) => procoreSend(req, res, cfg, "GET", path, { companyId, query });

    const type = q.get("type");
    if (type) {
      const id = procoreId(q.get("id"));
      if (!TYPES[type] || !id) throw new HttpError(400, "bad_request", "Unknown item.");
      const r = await send(`${TYPES[type]}/${id}`, { project_id: projectId });
      if (r.status === 403) throw new HttpError(403, "no_access", "Your role on this project doesn't include this. Ask your project admin.");
      if (r.status === 404) throw new HttpError(404, "not_found", "This item is gone from Procore.");
      if (!r.ok) throw new HttpError(502, "procore_failed", "Couldn't read this item from Procore. Try again.");
      return sendJson(res, 200, { item: { ...itemDetail(type, r.json), url: recordUrl(cfg.apiUrl, projectId, type, id) } });
    }

    const me = await send("/rest/v1.0/me", { company_id: companyId });
    if (!me.ok || me.json?.id == null) throw new HttpError(me.status === 401 ? 401 : 502, "procore_failed", "Couldn't check who you are in Procore. Try again.");
    const myId = String(me.json.id);
    const proj = await send(`/rest/v1.0/projects/${projectId}`, { company_id: companyId });
    const today = projectDay(proj.json?.time_zone);

    const urlOf = (t, id) => recordUrl(cfg.apiUrl, projectId, t, id);
    const [obs, punch] = await Promise.all([readAll(send, "observation", { projectId, myId, urlOf }), readAll(send, "punch_item", { projectId, myId, urlOf })]);
    if (obs.state !== "ok" && punch.state !== "ok") {
      if (obs.state === "denied" && punch.state === "denied") throw new HttpError(403, "no_access", "Your role on this project doesn't include Observations or Punch List. Ask your project admin.");
      throw new HttpError(502, "procore_failed", "Couldn't read your items from Procore. Try again.");
    }
    const groups = groupItems([...(obs.state === "ok" ? obs.rows : []), ...(punch.state === "ok" ? punch.rows : [])], today);
    console.log("SiteSnap my-items", JSON.stringify({ projectId, obs: obs.state, obsSeen: obs.seen ?? 0, punch: punch.state, punchSeen: punch.seen ?? 0, mine: groups.overdue.length + groups.open.length + groups.ready.length }));
    res.setHeader("Cache-Control", "private, no-store");
    sendJson(res, 200, { groups, counts: countsOf(groups), today, myId, tools: { observations: obs.state, punch: punch.state } });
  } catch (err) {
    sendError(res, err);
  }
}
