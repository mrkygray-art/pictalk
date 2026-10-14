// GET /api/procore/projects : the Procore projects the signed-in user can open, for the project picker.
// Read-only; the listing itself lives in api/_projects.js (shared with /api/procore/session).
import { config, sendError, sendJson } from "../_procore.js";
import { listProjects } from "../_projects.js";

export default async function handler(req, res) {
  try {
    const cfg = config();
    sendJson(res, 200, await listProjects(req, res, cfg));
  } catch (err) {
    sendError(res, err);
  }
}
