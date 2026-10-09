// Admin console data: the company's customers, all its shared jobs, settings, activity
// (audit log), and exports. Reads go straight to Firestore (the rules limit them to the
// company's admin); changes to other people's jobs go through functions/admin.js.
import {
  addDoc, collection, collectionGroup, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, updateDoc, where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../firebase";

export const SALES = [
  ["captured", "Captured"],
  ["drafted", "Drafted"],
  ["quoted", "Quoted"],
  ["won", "Won"],
  ["lost", "Lost"],
  ["installed", "Installed"],
];
export const salesLabel = (s) => SALES.find(([id]) => id === s)?.[1] || "Captured";

/** Sales status: what the admin set, else what Piccolo has done so far. */
export function salesStatusOf(job) {
  if (job.salesStatus) return job.salesStatus;
  if (job.piccoloStatus === "finalized") return "quoted";
  if (job.piccoloStatus === "drafted" || job.piccoloStatus === "editing") return "drafted";
  return "captured";
}

const watch = (q, callback, label) =>
  onSnapshot(
    q,
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    (err) => {
      console.warn(`Watching ${label} failed:`, err);
      callback([]);
    }
  );

export const watchCustomers = (orgId, cb) => watch(query(collection(db, "customers"), where("orgId", "==", orgId)), cb, "customers");

/** Every job shared with the company (any status), with its owner. */
export function watchOrgJobs(orgId, callback) {
  return onSnapshot(
    query(collectionGroup(db, "jobs"), where("orgId", "==", orgId)),
    (snap) => callback(snap.docs.map((d) => ({ id: d.id, ownerUid: d.ref.parent.parent.id, ...d.data() }))),
    (err) => {
      console.warn("Watching company jobs failed:", err);
      callback([]);
    }
  );
}

export const watchActivity = (orgId, cb) =>
  watch(query(collection(db, "auditLog"), where("orgId", "==", orgId), orderBy("at", "desc"), limit(200)), cb, "activity");

/** Add or edit a customer. Works offline (syncs later). */
export function saveCustomer(orgId, uid, customer) {
  const now = Date.now();
  const data = {
    name: customer.name.trim(),
    address: (customer.address || "").trim(),
    notes: (customer.notes || "").trim(),
    contacts: (customer.contacts || [])
      .map((c) => ({ name: (c.name || "").trim(), phone: (c.phone || "").trim(), email: (c.email || "").trim() }))
      .filter((c) => c.name || c.phone || c.email),
    archived: !!customer.archived,
    orgId,
    updatedAt: now,
  };
  if (customer.id) return updateDoc(doc(db, "customers", customer.id), data);
  return addDoc(collection(db, "customers"), { ...data, createdAt: now, createdBy: uid });
}

export const saveOrgSettings = (orgId, name, defaults) => updateDoc(doc(db, "orgs", orgId), { name, defaults, updatedAt: Date.now() });

const call = (name) => (data) => httpsCallable(functions, name, { timeout: 130000 })(data).then((r) => r.data);
export const updateTeamJob = (ownerUid, jobId, change) => call("updateTeamJob")({ ownerUid, jobId, ...change });
export const orgStorageUsage = () => call("orgStorageUsage")({});
export const clearLearning = () => call("clearLearning")({});

/** What drafts have learned from the company's finals (lines and edit counts), or null. */
export const watchLearning = (orgId, callback) =>
  onSnapshot(
    doc(db, "learning", `org_${orgId}`),
    (snap) => callback(snap.exists() ? snap.data() : null),
    (err) => {
      console.warn("Watching learning failed:", err);
      callback(null);
    }
  );

// ---------- export everything ----------

const cell = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
};
export const toCsv = (rows) => "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";

/** The company's data as one JSON object: settings, team, customers, jobs with their Piccolo work. */
export async function exportAll(org, team, customers, jobs) {
  const fullJobs = [];
  for (const j of jobs) {
    const base = ["users", j.ownerUid, "jobs", j.id];
    const working = await getDoc(doc(db, ...base, "working", "current")).then((s) => (s.exists() ? s.data() : null)).catch(() => null);
    const finals = await getDocs(collection(db, ...base, "finals"))
      .then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() })))
      .catch(() => []);
    fullJobs.push({ ...j, working, finals });
  }
  return {
    exportedAt: new Date().toISOString(),
    company: { id: org.id, name: org.name, defaults: org.defaults },
    team: team.map((p) => ({ uid: p.uid, name: p.displayName || null, email: p.email, role: p.role, status: p.status })),
    customers,
    jobs: fullJobs,
  };
}

export function jobsCsv(jobs, customers, team) {
  const customerName = (id) => customers.find((c) => c.id === id)?.name || "";
  const person = (uid) => team.find((p) => p.uid === uid);
  const rows = [["Job", "Customer (job)", "Location", "Customer record", "Sales status", "Piccolo", "Assigned to", "Started", "Finished"]];
  for (const j of jobs) {
    rows.push([
      j.name, j.customer || "", j.location || "", customerName(j.customerId), salesLabel(salesStatusOf(j)), j.piccoloStatus || "",
      (j.assignedTo || []).map((u) => person(u)?.displayName || person(u)?.email || u).join("; "),
      j.startedAt ? new Date(j.startedAt).toISOString() : "", j.endedAt ? new Date(j.endedAt).toISOString() : "",
    ]);
  }
  return toCsv(rows);
}
