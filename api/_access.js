// Who on a project Procore will accept for each kind of record, from their permission template.
// Template levels (GET /rest/v1.0/companies/{c}/permission_templates/{id} -> user_access_levels) are numbers:
// 1 None, 2 Read Only, 3 Standard, 4 Admin (sandbox, 2026-10-15). Only admins can read them, so SiteSnap keeps
// a copy per company in Firestore (procoreCompanies/{c}/meta/permissionTemplates, server only: no client rule
// matches it) and refreshes it when an admin opens a project, at most once a day.
// Observations also have Procore's own list (GET /rest/v1.0/observations/assignees?project_id=), which anyone
// on the project can read; when it answers, it decides.
import { firestore } from "./_firestore.js";

export const LEVEL = { 1: "None", 2: "Read Only", 3: "Standard", 4: "Admin" };
export const TOOL = { punch_item: "punch_list", observation: "observations" };
export const TOOL_NAME = { punch_item: "Punch List", observation: "Observations" };
export const STALE_MS = 24 * 60 * 60 * 1000;

const levelOf = (levels, key) => {
  const n = Number(levels?.[key]);
  return Number.isFinite(n) && n >= 1 ? n : null;
};

/** The levels SiteSnap keeps for one template: just the tools it uses */
export function keepLevels(json) {
  const l = json?.user_access_levels ?? {};
  return { name: String(json?.name ?? ""), punch_list: levelOf(l, "punch_list"), observations: levelOf(l, "observations"), task_items: levelOf(l, "task_items"), directory: levelOf(l, "directory") };
}

/**
 * One person's access: for each record type, { ok: true | false | null (not known), why }.
 * Only None (1) blocks; Read Only hasn't been seen on these tools yet, so it isn't treated as a no.
 */
export function accessFor(user, templates, observationIds) {
  const t = user.permission_template;
  const out = { template: t?.name ?? null };
  for (const [type, key] of Object.entries(TOOL)) {
    if (type === "observation" && observationIds) {
      const ok = observationIds.has(String(user.id));
      out[type] = { ok, why: ok ? "" : t?.name ? `"${t.name}" has no access to Observations` : "no permission template in Procore" };
      continue;
    }
    if (!t?.id) { out[type] = { ok: false, why: "no permission template in Procore" }; continue; }
    const level = templates?.[String(t.id)]?.[key] ?? null;
    if (level == null) { out[type] = { ok: null, why: "" }; continue; }
    out[type] = level <= 1 ? { ok: false, why: `"${t.name}" has no access to ${TOOL_NAME[type]}` } : { ok: true, why: "" };
  }
  return out;
}

// ---------- the saved levels (Firestore, server only; tests replace it with setAccessStore) ----------

let accessStore = null;
export const setAccessStore = (s) => { accessStore = s; };

async function store() {
  if (accessStore) return accessStore;
  const db = await firestore();
  const ref = (companyId) => db.doc(`procoreCompanies/${companyId}/meta/permissionTemplates`);
  return {
    async read(companyId) { return (await ref(companyId).get()).data() ?? null; },
    async write(companyId, value) { await ref(companyId).set(value); },
  };
}
export const readSaved = async (companyId) => (await store()).read(companyId);
export const writeSaved = async (companyId, value) => (await store()).write(companyId, value);
