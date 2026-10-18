// Paced Procore calls and the directory steps (company, person, permission template) shared by the sandbox
// pages api/procore/seed-directory.js (Ky's test people) and api/procore/demo-staging.js (demo projects).
// Every call is paced: Procore allows about 25 calls per 10 seconds ("spike limit",
// developers.procore.com/documentation/rate-limiting). By default a 429 waits out the window and tries once
// more; { retry429: false } hands the 429 back instead (the demo import stops its batch on one).
// Endpoints: see the header of api/procore/seed-directory.js.
import { HttpError, procoreId, rateLimited } from "./_procore.js";
import { procoreSend } from "./_procoreWrite.js";
import { projectRoleFor, userBody, vendorBody } from "./_seedDirectory.js";

export const brief = (r) => (r.ok ? `ok (${r.status})` : `Procore answered ${r.status}: ${JSON.stringify(r.json?.errors ?? r.json?.message ?? r.json?.error ?? r.json ?? "").slice(0, 300)}`);
export const lower = (s) => String(s ?? "").trim().toLowerCase();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const pace = { gapMs: 500, spikeWaitMs: 10_500 }; // 20 calls per 10 s at most; tests set both to 0
let lastCall = 0;
/** Waits until the next Procore call may go (for calls made outside api(), like file uploads) */
export async function waitTurn() {
  const wait = lastCall + pace.gapMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
}
export async function api(req, res, cfg, method, path, opts = {}) {
  const { retry429 = true, ...send } = opts;
  for (let attempt = 0; ; attempt++) {
    await waitTurn();
    const r = await procoreSend(req, res, cfg, method, path, send);
    if (r.status !== 429 || !retry429 || attempt >= 1) return r;
    await sleep(pace.spikeWaitMs);
  }
}

// Every page of a list; null when Procore refuses it (403 / 404), so a missing permission doesn't stop the run
export async function pages(req, res, cfg, path, { companyId, query = {}, retry429 = true }) {
  const out = [];
  for (let page = 1; page <= 10; page++) {
    const r = await api(req, res, cfg, "GET", path, { companyId, query: { ...query, page, per_page: 100 }, retry429 });
    if (r.status === 403 || r.status === 404) return null;
    if (r.status === 401) throw new HttpError(401, "not_connected", "Your Procore sign-in ran out. Sign in with Procore again.");
    if (r.status === 429) throw rateLimited(r.headers?.["x-rate-limit-reset"]);
    if (!r.ok) throw new HttpError(502, "procore_failed", `Procore answered ${r.status} reading ${path.replace(/\d{3,}/g, "…")}. Wait a minute and run it again.`);
    if (!Array.isArray(r.json)) break;
    out.push(...r.json);
    if (r.json.length < 100) break;
  }
  return out;
}

// The company's vendor record, by name (active, else inactive). The company step hands its id on, because
// Procore's search doesn't find a company created seconds ago; else search, then the whole list.
export async function findVendor(req, res, cfg, companyId, name, knownId) {
  if (procoreId(String(knownId ?? ""))) {
    const r = await api(req, res, cfg, "GET", `/rest/v1.0/vendors/${knownId}`, { companyId, query: { company_id: companyId } });
    if (r.ok && lower(r.json?.name) === lower(name)) return r.json;
  }
  const searched = (await pages(req, res, cfg, "/rest/v1.0/vendors", { companyId, query: { company_id: companyId, "filters[search]": name } })) ?? [];
  const hit = searched.find((v) => lower(v.name) === lower(name))
    ?? ((await pages(req, res, cfg, "/rest/v1.0/vendors", { companyId, query: { company_id: companyId } })) ?? []).find((v) => lower(v.name) === lower(name));
  if (hit) return hit;
  const inactive = (await pages(req, res, cfg, `/rest/v1.0/companies/${companyId}/vendors/inactive`, { companyId })) ?? [];
  return inactive.find((v) => lower(v.name) === lower(name)) ?? null;
}

export async function addCompany(req, res, cfg, companyId, projectId, seed) {
  const steps = [];
  const found = await findVendor(req, res, cfg, companyId, seed.vendor.name);
  const vr = found
    ? await api(req, res, cfg, "PATCH", `/rest/v1.0/vendors/${found.id}`, { companyId, body: vendorBody(companyId, seed.vendor) })
    : await api(req, res, cfg, "POST", "/rest/v1.0/vendors", { companyId, body: vendorBody(companyId, seed.vendor) });
  const vendorId = vr.ok ? vr.json?.id ?? found?.id : null;
  steps.push({ name: `${found ? "Updated" : "Created"} company: ${seed.vendor.name}`, ok: vr.ok && !!vendorId, detail: `${brief(vr)}${vendorId ? `, id ${vendorId}` : ""}` });
  if (!vendorId) return { steps };
  const onProject = (await pages(req, res, cfg, `/rest/v1.0/projects/${projectId}/vendors`, { companyId })) ?? [];
  if (onProject.some((v) => String(v.id) === String(vendorId))) steps.push({ name: "Company on the project", ok: true, detail: "already there" });
  else {
    const r = await api(req, res, cfg, "POST", `/rest/v1.0/projects/${projectId}/vendors/${vendorId}/actions/add`, { companyId });
    steps.push({ name: "Added company to the project", ok: r.ok, detail: brief(r) });
  }
  return { steps, vendorId: String(vendorId) };
}

/**
 * One person: create (or update and reactivate), add to the project, set the permission template, and (when
 * u.projectRole) the Project Role. templateFor(seed, u) names the template, or a list of them, best first.
 */
export async function addPerson(req, res, cfg, companyId, projectId, seed, u, vendorId, templateFor) {
  const steps = [];
  const step = (name, r, extra = "") => { steps.push({ name, ok: r.ok, detail: `${brief(r)}${extra}` }); return r.ok; };
  const name = `${u.first_name} ${u.last_name}`;
  const vendor = await findVendor(req, res, cfg, companyId, seed.vendor.name, vendorId);
  if (!vendor) return [{ name: `${name}: company`, ok: false, detail: `${seed.vendor.name} isn't in Procore yet, so ${u.first_name} was skipped.` }];

  // The person, by email: in the company list, else the inactive list
  const search = { companyId, query: { "filters[search]": u.email_address } };
  const byEmail = (list) => (list ?? []).find((x) => lower(x.email_address) === lower(u.email_address));
  const existing = byEmail(await pages(req, res, cfg, `/rest/v1.3/companies/${companyId}/users`, search))
    ?? byEmail(await pages(req, res, cfg, `/rest/v1.0/companies/${companyId}/users/inactive`, { companyId }));
  let found = existing;
  let ur = existing
    ? await api(req, res, cfg, "PATCH", `/rest/v1.3/companies/${companyId}/users/${existing.id}`, { companyId, body: userBody(u, vendor.id, seed.vendor, { update: true }) })
    : await api(req, res, cfg, "POST", `/rest/v1.3/companies/${companyId}/users`, { companyId, body: userBody(u, vendor.id, seed.vendor) });
  // 409 "email already exists": made moments ago (Procore's search doesn't find a new user yet), so look through
  // the whole company list and update that person instead
  if (ur.status === 409 && !existing) {
    found = byEmail(await pages(req, res, cfg, `/rest/v1.3/companies/${companyId}/users`, { companyId }));
    if (found) ur = await api(req, res, cfg, "PATCH", `/rest/v1.3/companies/${companyId}/users/${found.id}`, { companyId, body: userBody(u, vendor.id, seed.vendor, { update: true }) });
  }
  const userId = ur.ok ? ur.json?.id ?? found?.id : null;
  if (!step(`${found ? "Updated" : "Created"} ${name} (${u.job_title})`, ur) || !userId) return steps;

  // Active in the directory (someone made inactive earlier comes back)
  const person = ((await pages(req, res, cfg, `/rest/v1.0/companies/${companyId}/people`, search)) ?? []).find((p) => String(p.user_id) === String(userId));
  if (person && person.contact?.is_active === false) {
    step(`${name} active again`, await api(req, res, cfg, "POST", `/rest/v2.0/companies/${companyId}/people/bulk_activate`, { companyId, body: { ids: [Number(person.id)] } }));
  }

  const onProject = (await pages(req, res, cfg, `/rest/v1.0/projects/${projectId}/users`, { companyId, query: { "filters[id][]": userId } })) ?? [];
  if (onProject.some((x) => String(x.id) === String(userId))) steps.push({ name: `${name} on the project`, ok: true, detail: "already there" });
  else step(`Added ${name} to the project`, await api(req, res, cfg, "POST", `/rest/v1.0/projects/${projectId}/users/${userId}/actions/add`, { companyId, body: { user: {} } }));

  steps.push(await setTemplate(req, res, cfg, companyId, projectId, await projectTemplates(req, res, cfg, companyId, projectId), templateFor(seed, u), u, userId, onProject[0]?.permission_template));

  // Project Role: only when the person has one (PMs); others get none (their job title shows)
  if (!u.projectRole) {
    steps.push({ name: `${name}: Project Role`, ok: true, detail: `none (role type ${u.roleType}); job title shows` });
    return steps;
  }
  const roles = (await pages(req, res, cfg, "/rest/v1.0/project_roles", { companyId, query: { project_id: projectId } })) ?? [];
  const role = projectRoleFor(u.projectRole, roles.map((r) => r.role).filter(Boolean));
  if (!role) {
    steps.push({ name: `${name}: Project Role ${u.projectRole}`, ok: false, detail: `This project has no "${u.projectRole}" role. Add it in Procore and run again.` });
  } else if (roles.some((r) => String(r.user_id) === String(userId) && lower(r.role) === lower(role))) {
    steps.push({ name: `${name}: Project Role ${role}`, ok: true, detail: "already set" });
  } else {
    step(`${name}: Project Role ${role}`, await api(req, res, cfg, "POST", "/rest/v1.0/project_roles", {
      companyId, body: { project_id: Number(projectId), project_role: { role, user_id: Number(userId) } },
    }));
  }
  return steps;
}


// The permission templates this project offers, by lower-case name (GET /rest/v1.0/projects/{p}/permission_templates)
export async function projectTemplates(req, res, cfg, companyId, projectId) {
  const r = await api(req, res, cfg, "GET", `/rest/v1.0/projects/${projectId}/permission_templates`, { companyId });
  return new Map((r.ok && Array.isArray(r.json) ? r.json : []).map((t) => [lower(t.name), t]));
}

// One person's permission template on the project (the first of `wanted` the project has); skipped when
// Procore already shows the right one
export async function setTemplate(req, res, cfg, companyId, projectId, templates, wanted, u, userId, current) {
  const name = `${u.first_name} ${u.last_name}: permission template`;
  const list = [].concat(wanted);
  const want = list.find((w) => templates.has(lower(w))) ?? list[0];
  const t = templates.get(lower(want));
  if (!t) return { name, ok: false, detail: `This project has no "${list.join('" or "')}" template${templates.size ? "" : " (couldn't read the project's templates)"}.` };
  if (current && String(current.id) === String(t.id)) return { name: `${name} ${want}`, ok: true, detail: "already set" };
  const r = await api(req, res, cfg, "PATCH", `/rest/v1.0/projects/${projectId}/permission_template_assignments`, {
    companyId, body: { permission_template_assignments: { user_id: Number(userId), permission_template_id: Number(t.id) } },
  });
  return { name: `${name} ${want}`, ok: r.ok, detail: brief(r) };
}
