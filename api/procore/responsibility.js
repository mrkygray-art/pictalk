// POST /api/procore/responsibility  { companyId, projectId, userId, label }  (label null = remove)
// A PM tags a project member with a responsibility (PM, Superintendent, Purchasing, Sub foreman)
// when Procore has no title or role for them. Allowed only for a signed-in Procore user who is a
// Project Manager / Executive in this project's Project Roles, for someone on the project's
// Directory. Same-origin JSON only. Reads Procore; writes only SiteSnap's Firestore.
import { config, HttpError, procoreGet, procoreId, readBody, requireSameOriginJson, sendError, sendJson } from "../_procore.js";
import { canTag, LABELS, projectRoles, writeTag } from "../_responsibilities.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") throw new HttpError(405, "bad_method", "Not allowed.");
    const cfg = config();
    requireSameOriginJson(req);
    const body = await readBody(req);
    const companyId = procoreId(String(body.companyId ?? ""));
    const projectId = procoreId(String(body.projectId ?? ""));
    const userId = procoreId(String(body.userId ?? ""));
    if (!companyId || !projectId || !userId) throw new HttpError(400, "missing_ids", "Needs a Procore companyId, projectId, and userId.");
    const label = body.label ?? null;
    if (label !== null && !LABELS.includes(label)) throw new HttpError(400, "bad_label", `Choose one of: ${LABELS.join(", ")}.`);

    // Who's asking, and are they a PM on this project?
    const me = await procoreGet(req, res, cfg, "/rest/v1.0/me", { companyId, query: { company_id: companyId } });
    const { roles } = await projectRoles(req, res, cfg, companyId, projectId);
    if (!canTag(roles, me?.id)) {
      throw new HttpError(403, "not_pm", "Only this project's Project Manager in Procore (Project Team) can tag people.");
    }
    // The person must be on this project's Directory (404 from Procore otherwise)
    await procoreGet(req, res, cfg, `/rest/v1.0/projects/${projectId}/users/${userId}`, { companyId });

    await writeTag(companyId, projectId, userId, label, me);
    sendJson(res, 200, { userId: Number(userId), tag: label });
  } catch (err) {
    sendError(res, err);
  }
}
