// Who is responsible for what on a Procore project, for the people list and (later) suggesting
// a thread's owner. Order: the project team's Project Roles in Procore, then the Directory job
// title, then the permission template, then a tag a PM set in SiteSnap. Read-only on Procore.
//   Project Roles: GET /rest/v1.0/project_roles?project_id= (Procore-Company-Id), each entry
//   { id, name, role, user_id, contact_id, is_active } (Procore reference, "Project Roles").
// Tags live in SiteSnap's Firestore (sitesnap-procore), written only by the server:
//   procoreProjects/{companyId}_{projectId}/responsibilities/{procoreUserId}
//   = { label, setByProcoreUserId, setByName, setAt }   (rules deny all client access)
import { procoreGet } from "./_procore.js";
import { firestore } from "./_firestore.js";

export const LABELS = ["PM", "Superintendent", "Purchasing", "Sub foreman"];
// Project Roles that may tag people (a PM per the spec; a Project Executive outranks one)
const TAGGERS = /project manager|project executive/i;
const PER_PAGE = 100;
const MAX_PAGES = 10;

// procore user id -> ["Project Manager", ...]; empty (and unavailable) when the caller can't read them
export async function projectRoles(req, res, cfg, companyId, projectId) {
  const roles = new Map();
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await procoreGet(req, res, cfg, "/rest/v1.0/project_roles", {
        companyId, query: { project_id: projectId, page, per_page: PER_PAGE },
      });
      if (!Array.isArray(batch)) break;
      for (const r of batch) {
        if (r?.user_id == null || r.is_active === false || !r.role) continue;
        const list = roles.get(String(r.user_id)) ?? [];
        if (!list.includes(r.role)) list.push(r.role);
        roles.set(String(r.user_id), list);
      }
      if (batch.length < PER_PAGE) break;
    }
    return { roles, available: true };
  } catch (err) {
    // No permission to read the project team, or the tool is off: carry on without roles
    if (err?.status === 403 || err?.status === 404) return { roles, available: false };
    throw err;
  }
}

export const canTag = (roles, procoreUserId) => (roles.get(String(procoreUserId)) ?? []).some((r) => TAGGERS.test(r));

// One person for the list: name, company, role, and where the role came from
export function person(u, roles = new Map(), tags = new Map()) {
  const projectRole = (roles.get(String(u.id)) ?? []).join(", ");
  const tag = tags.get(String(u.id))?.label ?? null;
  const [role, roleSource] = projectRole ? [projectRole, "project_team"]
    : u.job_title ? [u.job_title, "job_title"]
      : u.permission_template?.name ? [u.permission_template.name, "permission_template"]
        : tag ? [tag, "tag"] : [null, null];
  return {
    id: u.id,
    name: u.name || [u.first_name, u.last_name].filter(Boolean).join(" ") || null,
    firstName: u.first_name ?? null,
    lastName: u.last_name ?? null,
    title: u.job_title || null, // the Directory job title on its own, for Title search
    company: u.vendor?.name ?? null,
    role,
    roleSource,
    tag,
  };
}

// ---------- tag storage (Firestore, server only; tests replace it with setTagStore) ----------

const projectDoc = (companyId, projectId) => `procoreProjects/${companyId}_${projectId}`;
let tagStore = null;
export const setTagStore = (s) => { tagStore = s; };

async function store() {
  if (tagStore) return tagStore;
  const db = await firestore();
  return {
    async list(companyId, projectId) {
      const snap = await db.collection(`${projectDoc(companyId, projectId)}/responsibilities`).get();
      return new Map(snap.docs.map((d) => [d.id, d.data()]));
    },
    async set(companyId, projectId, userId, value) {
      await db.doc(`${projectDoc(companyId, projectId)}/responsibilities/${userId}`).set(value);
    },
    async remove(companyId, projectId, userId) {
      await db.doc(`${projectDoc(companyId, projectId)}/responsibilities/${userId}`).delete();
    },
  };
}

export async function readTags(companyId, projectId) {
  return (await store()).list(companyId, projectId);
}

export async function writeTag(companyId, projectId, userId, label, by) {
  const s = await store();
  if (!label) return s.remove(companyId, projectId, String(userId));
  return s.set(companyId, projectId, String(userId), { label, setByProcoreUserId: String(by.id), setByName: by.name ?? null, setAt: Date.now() });
}
