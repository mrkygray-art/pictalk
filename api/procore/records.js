// POST /api/procore/records : create the confirmed record in Procore (Step 3 of
// SPEC_voice-photo-to-procore-record), with the signed-in person's own Procore sign-in (decision A).
// Body (same-origin JSON): { companyId, projectId, card, files: [{ name, type, data (base64) }], link }
// The work is in api/_createRecord.js (shared with a failed inspection item): checks the project, uploads the
// photos and voice file, creates the Observation or Punch Item (not private, HTML description, "Reported by …
// via SiteSnap AI", transcript), retries without a refused location or assignees, emails the assignees only.
// Answers { recordType, id, number, url, warnings[] }. Never logs or returns a token.
// Demo projects (DEMO_MODE=true or FULL_LOOP_DEMO=true, and the project in DEMO_PROJECT_IDS): the title starts
// with [SS-DEMO], so the Demo staging page's reset finds live test captures too.
// One capture = one record (api/_captures.js): card.captureId is the idempotency key, so a double tap or a network
// retry answers with the record already made ({ ..., repeat: true }) instead of making a second one.
import { config, HttpError, procoreId, readBody, requireSameOriginJson, sendError, sendJson } from "../_procore.js";
import { cleanCard } from "../_records.js";
import { cleanFiles, createRecord } from "../_createRecord.js";
import { demoCodeOf, demoMode, withTag } from "../_demoScenarios.js";
import { fullLoopSettings } from "../_fullLoop.js";
import { claimCapture, finishCapture, releaseCapture } from "../_captures.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") throw new HttpError(405, "bad_request", "Use POST.");
    requireSameOriginJson(req);
    const cfg = config();
    const body = await readBody(req);
    const companyId = procoreId(String(body.companyId ?? ""));
    const projectId = procoreId(String(body.projectId ?? ""));
    if (!companyId || !projectId) throw new HttpError(400, "missing_ids", "Pick a project.");
    let card;
    try { card = cleanCard(body.card); } catch (err) { throw new HttpError(400, "bad_card", err.message); }
    const loop = fullLoopSettings().enabled;
    const demoTag = (demoMode() || loop) && !!demoCodeOf(projectId);
    if (demoTag) card = { ...card, title: withTag(card.title) };
    const files = cleanFiles(body.files);
    const link = typeof body.link === "string" && body.link.startsWith("https://") ? body.link.slice(0, 300) : null;

    const claim = await claimCapture(`${companyId}_${projectId}`, card.captureId);
    if (claim.repeat) {
      console.log("SiteSnap record repeat", JSON.stringify({ recordType: claim.repeat.recordType, id: claim.repeat.id }));
      return sendJson(res, 200, { ...claim.repeat, repeat: true });
    }
    let made;
    try {
      made = await createRecord(req, res, cfg, { companyId, projectId, card, files, link, retry429: loop });
    } catch (err) {
      await releaseCapture(claim.ref);
      throw err;
    }
    console.log("SiteSnap record created", JSON.stringify({ recordType: made.recordType, id: made.id, files: made.uploads, warnings: made.warnings.length }));
    const { recordType, id, number, url, warnings, reporterName } = made;
    const answer = { recordType, id, number, url, warnings, reporterName };
    // proposed: the card as SiteSnap first filled it in, so the log can count what the person changed
    const proposed = body.proposed && typeof body.proposed === "object" ? body.proposed : null;
    await finishCapture(claim.ref, { projectId, answer, actor: made.reporterId, demoTag, card: made.card, proposed });
    sendJson(res, 201, answer);
  } catch (err) {
    sendError(res, err);
  }
}
