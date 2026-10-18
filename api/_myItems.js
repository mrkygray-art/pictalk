// My items (sitesnap-report-picker-my-items-spec.md, section 6): Observations and Punch Items assigned to the
// signed-in person, merged, grouped Overdue / Open / Ready for review, due date first. Plain functions so tests
// can feed Procore-shaped rows. Field names confirmed in the sandbox 2026-10-17 (/api/procore/test-my-items as
// Chloe Abara): the Observation assignee filter works (1 of 4 rows came back, the one assigned to her); Punch Item
// rows carry assignees[].id and assignments[].login_information_id; filters[status]=open left out the closed one.
//   Observations  GET /rest/v1.0/observations/items?project_id=&filters[assignee_id][]=me
//                 row: id, number, name, description, status (initiated | ready_for_review | not_accepted | closed),
//                 due_date, assignee {id, name}, created_by {id, name}, location {name | node_name}, type {name}
//   Punch Items   GET /rest/v1.1/punch_items?project_id=&filters[status]=open  (no assignee filter is documented)
//                 row: id, position, name, description, status (Open | Closed | ...), workflow_status, due_date,
//                 assignees [{id, name}], assignments [{ login_information_id?, status, attachments }],
//                 ball_in_court [{id}], created_by, punch_item_manager, location
// Every row is checked against "assigned to me" here too, so a filter Procore ignores never shows other people's items.
export const PATHS = {
  observations: "/rest/v1.0/observations/items",
  punch: "/rest/v1.1/punch_items",
};
export const PER_PAGE = 100;
export const MAX_PAGES = 5;

const str = (v, max = 400) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const day = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v ?? "")) ? String(v).slice(0, 10) : null);
const placeOf = (loc) => str(loc?.node_name || loc?.name, 120) || null;
const nameOf = (p) => str(p?.name, 120) || null;

/** Is this Procore row assigned to me? */
export function assignedToMe(type, row, myId) {
  const me = String(myId);
  if (type === "observation") {
    if (row?.assignee?.id != null && String(row.assignee.id) === me) return true;
    return (row?.assignees ?? []).some((a) => String(a?.id) === me) || (row?.assignee_ids ?? []).map(String).includes(me);
  }
  return (row?.assignees ?? []).some((a) => String(a?.id ?? a?.login_information_id) === me)
    || (row?.assignments ?? []).some((a) => String(a?.login_information_id ?? a?.assignee?.id ?? a?.login_information?.id) === me);
}

/** Procore's status as one of: open | ready | closed (plus Procore's own words for the row) */
export function stageOf(type, row) {
  if (type === "observation") {
    const s = String(row?.status ?? "").toLowerCase();
    if (s === "closed") return { stage: "closed", label: "Closed" };
    if (s === "ready_for_review") return { stage: "ready", label: "Ready for review" };
    if (s === "not_accepted") return { stage: "open", label: "Not accepted" };
    return { stage: "open", label: "Open" };
  }
  const status = String(row?.status ?? "").toLowerCase();
  const wf = String(row?.workflow_status ?? "").toLowerCase();
  if (status === "closed" || wf === "closed") return { stage: "closed", label: "Closed" };
  if (wf === "ready_for_review" || wf === "ready_to_close") return { stage: "ready", label: wf === "ready_to_close" ? "Ready to close" : "Ready for review" };
  if (wf === "work_not_accepted" || wf === "not_accepted") return { stage: "open", label: "Work not accepted" };
  return { stage: "open", label: "Open" };
}

/** One list row, the same shape for both kinds */
export function itemRow(type, row) {
  const { stage, label } = stageOf(type, row);
  return {
    type, // observation | punch_item
    id: String(row.id),
    number: str(type === "observation" ? row.number : row.position ?? row.number, 20) || null,
    // demo records carry a [SS-DEMO] tag for the staging page's reset; it means nothing to the person reading
    title: str(row.name || row.title, 200).replace(/^\[SS-DEMO\](\[ARCHIVED\])?\s*/, "") || "(no title)",
    location: placeOf(row.location),
    due: day(row.due_date),
    createdAt: str(row.created_at, 40) || null,
    stage,
    status: label,
    assignedBy: nameOf(type === "punch_item" ? row.punch_item_manager || row.created_by : row.created_by),
    assignedById: String((type === "punch_item" ? row.punch_item_manager?.id ?? row.created_by?.id : row.created_by?.id) ?? "") || null,
    kind: type === "observation" ? str(row.type?.name, 60) || null : str(row.punch_item_type?.name, 60) || null,
  };
}

/** Overdue / Open / Ready for review (closed left out), each by due date (no date last), then newest */
export function groupItems(rows, today) {
  const by = (a, b) => String(a.due ?? "9999-99-99").localeCompare(String(b.due ?? "9999-99-99")) || String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));
  const overdue = [];
  const open = [];
  const ready = [];
  for (const r of rows) {
    if (r.stage === "closed") continue;
    if (r.stage === "ready") ready.push(r);
    else if (r.due && r.due < today) overdue.push({ ...r, overdue: true });
    else open.push(r);
  }
  return { overdue: overdue.sort(by), open: open.sort(by), ready: ready.sort(by) };
}

/** The home badge: N = not closed and not ready for review; M = of those, past due */
export const countsOf = (groups) => ({ open: groups.overdue.length + groups.open.length, overdue: groups.overdue.length });

/** The list request for each kind (a plain object, so the demo guard still sees project_id) */
export function listQuery(type, { projectId, myId, page }) {
  if (type === "observation") return { project_id: projectId, "filters[assignee_id][]": myId, per_page: PER_PAGE, page };
  return { project_id: projectId, "filters[status]": "open", per_page: PER_PAGE, page };
}

/** Photos on a record (detail read): every attachment that looks like an image, { url, thumb, name }.
 *  Sandbox 2026-10-17: attachments carry url + thumbnail_url on sandbox.procore.com (the photo proxy's hosts). */
export function photosOf(json) {
  const found = [];
  const add = (a) => {
    const url = a?.url || a?.download_url || a?.thumbnail_url;
    const thumb = a?.thumbnail_url || url;
    const name = str(a?.name || a?.filename, 120);
    if (!url || found.some((f) => f.url === url)) return;
    if (/\.(jpe?g|png|heic|webp|gif)$/i.test(name || url) || /^image\//.test(String(a?.content_type ?? ""))) found.push({ url: String(url), thumb: String(thumb), name });
  };
  for (const a of json?.attachments ?? []) add(a);
  for (const asg of json?.assignments ?? []) for (const a of asg?.attachments ?? []) add(a);
  for (const img of json?.images ?? []) add(img);
  return found.slice(0, 12);
}

/** The detail view: the row plus description and photos */
export function itemDetail(type, json) {
  return { ...itemRow(type, json), description: String(json?.description ?? "").trim().slice(0, 4000), photos: photosOf(json) };
}
