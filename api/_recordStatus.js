// Step 4: keeping a Procore record and its SiteSnap thread in step (decision B: Done in SiteSnap means
// "ready for review"; closing is the manager's / final approver's, and Procore enforces who may).
// Plain functions so tests can check what Procore is sent. From Procore's reference:
//   Observation: PATCH /rest/v1.0/observations/items/{id}  { project_id, observation: { status } }
//                statuses initiated | ready_for_review | not_accepted | closed
//   Punch Item:  PATCH /rest/v1.1/punch_items/{id}         { project_id, punch_item: { status | workflow_status } }
//                status open | closed; workflow_status initiated, work_required, ready_for_review, ready_to_close, closed, …
//   Read either: GET …/{id}?project_id=
export const ACTIONS = ["done", "close", "reopen"];

export function updateBody(recordType, action, projectId) {
  const pid = Number(projectId);
  if (recordType === "observation") {
    const status = { done: "ready_for_review", close: "closed", reopen: "initiated" }[action];
    return { path: "/rest/v1.0/observations/items", body: { project_id: pid, observation: { status } } };
  }
  const item = { done: { workflow_status: "ready_for_review" }, close: { status: "closed" }, reopen: { status: "open", workflow_status: "work_required" } }[action];
  return { path: "/rest/v1.1/punch_items", body: { project_id: pid, punch_item: item } };
}

export const readPath = (recordType) => (recordType === "observation" ? "/rest/v1.0/observations/items" : "/rest/v1.1/punch_items");

const LABELS = {
  initiated: "Open", open: "Open", work_required: "Work required", ready_for_review: "Ready for review",
  ready_to_close: "Ready to close", not_accepted: "Not accepted", work_not_accepted: "Work not accepted",
  in_dispute: "In dispute", not_accepted_by_creator: "Not accepted", draft: "Draft", closed: "Closed",
};

/** What Procore says now, in plain words: { value, label, closed } */
export function statusOf(recordType, json) {
  const raw = recordType === "observation"
    ? String(json?.status ?? "")
    : String(json?.workflow_status || "") || (String(json?.status ?? "").toLowerCase() === "closed" ? "closed" : "open");
  const closed = raw === "closed" || (recordType === "punch_item" && String(json?.status ?? "").toLowerCase() === "closed");
  const value = closed ? "closed" : raw || "open";
  return { value, label: LABELS[value] ?? value.replace(/_/g, " "), closed };
}
