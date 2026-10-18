// The one place SiteSnap writes to Procore. Every record is written with the signed-in person's own
// Procore sign-in (everyone on a project has a Procore login), so Procore shows the real author.
// Kept in one module so a service account (DMSA, client credentials) could replace it later.
// Like procoreGet: refreshes the token first when needed and retries once on a 401 (and, with retry429, waits
// out a 429). Never logs tokens.
// A guest demo session (docs/guest-demo.md) only gets GETs on its allowlisted projects through here; anything
// else is refused before it reaches Procore, even if the guest's own Procore permissions would allow it.
import { demoRead, session, waitFor429 } from "./_procore.js";
import { guardFullLoop } from "./_fullLoop.js";

async function call(req, res, cfg, method, path, { companyId, query, body, form, retry429 = false } = {}) {
  let tokens = await session(req, res, cfg);
  demoRead.guard(tokens, method, path, query);
  if (!tokens.demo) guardFullLoop(req, method, path, { query, body }); // full-loop demo mode (api/_fullLoop.js)
  const url = `${cfg.apiUrl}${path}${query ? `?${new URLSearchParams(query)}` : ""}`;
  const cacheKey = tokens.demo ? `send ${companyId ?? ""} ${url}` : null;
  if (cacheKey) {
    const hit = demoRead.cached(cacheKey);
    if (hit !== undefined) return structuredClone(hit);
    demoRead.spend();
  }
  const send = (t) => fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${t.at}`,
      Accept: "application/json",
      ...(body && !form ? { "Content-Type": "application/json" } : {}),
      ...(companyId ? { "Procore-Company-Id": String(companyId) } : {}),
    },
    // form: multipart (fields + files, e.g. a Daily Log entry with attachments); fetch sets its own boundary
    ...(form ? { body: form() } : body ? { body: JSON.stringify(body) } : {}),
  });
  let resp = await send(tokens);
  if (resp.status === 401) {
    tokens = await session(req, res, cfg, { force: true });
    resp = await send(tokens);
  }
  // retry429 (the full-loop demo's calls): 429 = Procore didn't take the call, so trying again is safe even for a
  // write; wait out the window, twice at most. Off by default: demo staging and others handle a 429 themselves.
  for (let tries = 0; retry429 && resp.status === 429 && tries < 2; tries++) {
    await new Promise((r) => setTimeout(r, waitFor429(resp)));
    resp = await send(tokens);
  }
  let json = null;
  try { json = await resp.json(); } catch { /* empty or not JSON */ }
  // Paging and rate-limit headers only (Total, Per-Page, Link, X-Rate-Limit-*)
  const headers = {};
  for (const k of ["total", "per-page", "link", "x-rate-limit-limit", "x-rate-limit-remaining", "x-rate-limit-reset"]) {
    const v = resp.headers?.get?.(k);
    if (v) headers[k] = v;
  }
  const out = { status: resp.status, ok: resp.ok, json, headers };
  if (cacheKey && resp.ok) demoRead.remember(cacheKey, structuredClone(out));
  return out;
}

/** A Procore API call; returns { status, ok, json, headers } and never throws on a Procore error answer.
 *  opts.form: a function returning a fresh FormData (called again if the token is refreshed and the call retried).
 *  opts.retry429: wait out a 429 and try again (twice at most). */
export const procoreSend = (req, res, cfg, method, path, opts) => call(req, res, cfg, method, path, opts);

/**
 * Attach a file: ask Procore for an upload slot (POST /rest/v1.1/projects/{id}/uploads), post the file to
 * its storage URL with every returned field unchanged plus "file", and return the upload's uuid for upload_ids.
 */
export async function uploadFile(req, res, cfg, { companyId, projectId, name, type, bytes }) {
  // (the upload slot below is a POST, so a demo session is refused there before any file is sent)
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
