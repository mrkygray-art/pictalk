// The one place SiteSnap writes to Procore. Every record is written with the signed-in person's own
// Procore sign-in (everyone on a project has a Procore login), so Procore shows the real author.
// Kept in one module so a service account (DMSA, client credentials) could replace it later.
// Like procoreGet: refreshes the token first when needed and retries once on a 401. Never logs tokens.
import { session } from "./_procore.js";

async function call(req, res, cfg, method, path, { companyId, query, body } = {}) {
  let tokens = await session(req, res, cfg);
  const url = `${cfg.apiUrl}${path}${query ? `?${new URLSearchParams(query)}` : ""}`;
  const send = (t) => fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${t.at}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(companyId ? { "Procore-Company-Id": String(companyId) } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let resp = await send(tokens);
  if (resp.status === 401) {
    tokens = await session(req, res, cfg, { force: true });
    resp = await send(tokens);
  }
  let json = null;
  try { json = await resp.json(); } catch { /* empty or not JSON */ }
  return { status: resp.status, ok: resp.ok, json };
}

/** A Procore API call; returns { status, ok, json } and never throws on a Procore error answer. */
export const procoreSend = (req, res, cfg, method, path, opts) => call(req, res, cfg, method, path, opts);

/**
 * Attach a file: ask Procore for an upload slot (POST /rest/v1.1/projects/{id}/uploads), post the file to
 * its storage URL with every returned field unchanged plus "file", and return the upload's uuid for upload_ids.
 */
export async function uploadFile(req, res, cfg, { companyId, projectId, name, type, bytes }) {
  const slot = await call(req, res, cfg, "POST", `/rest/v1.1/projects/${projectId}/uploads`, {
    companyId, body: { response_filename: name, response_content_type: type },
  });
  if (!slot.ok || !slot.json?.uuid || !slot.json?.url) return { ok: false, step: "upload slot", status: slot.status, error: slot.json };
  const form = new FormData();
  for (const [k, v] of Object.entries(slot.json.fields ?? {})) form.append(k, v);
  form.append("file", new Blob([bytes], { type }), name);
  const put = await fetch(slot.json.url, { method: "POST", body: form });
  if (!put.ok) return { ok: false, step: "upload file", status: put.status };
  return { ok: true, uuid: slot.json.uuid };
}
