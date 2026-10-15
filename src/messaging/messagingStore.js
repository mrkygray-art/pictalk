// SiteSnap messaging data: a Procore project's conversations, their messages, and what I've read.
// Firestore (rules: only the project's members read; people write only as themselves):
//   procoreProjects/{key}/conversations/{cid}            key = {companyId}_{projectId}
//   procoreProjects/{key}/conversations/{cid}/messages/{mid}
//   procoreProjects/{key}/members/{me}/reads/{cid}      { lastReadAt }
// Storage: messages/{key}/{cid}/{mid}/photo-{n}.{ext} and voice.{ext}.
// Sending is offline-first, like stops: a message is saved on this phone (IndexedDB, with its photos and
// voice note) and uploaded when there's signal; files first, then the Firestore docs.
import {
  collection, doc, getDoc, limit, onSnapshot, orderBy, query, setDoc, updateDoc, where, arrayUnion, writeBatch,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { del, get, keys, set } from "idb-keyval";
import { auth, db, storage, functions } from "../firebase";
import { baseType, extFor } from "../stopStore";

const QUEUE = "pending-message:";
const FEED_SIZE = 60;

export const projectKey = (p) => (p ? `${p.companyId}_${p.projectId}` : null);
const convCol = (key) => collection(db, "procoreProjects", key, "conversations");
const convDoc = (key, cid) => doc(db, "procoreProjects", key, "conversations", cid);
const msgCol = (key, cid) => collection(db, "procoreProjects", key, "conversations", cid, "messages");

// ---------- reading ----------

/** tab: "forMe" (tagged, open) | "cc" (CC'd, open or closed) | "all" | "mine" (Sent). callback(list, error) */
export function watchFeed(key, tab, me, callback) {
  const base = convCol(key);
  const q = tab === "forMe"
    ? query(base, where("taggedIds", "array-contains", me), where("status", "==", "open"), orderBy("lastActivityAt", "desc"), limit(FEED_SIZE))
    : tab === "cc"
      ? query(base, where("ccIds", "array-contains", me), orderBy("lastActivityAt", "desc"), limit(FEED_SIZE))
      : tab === "mine"
      ? query(base, where("createdBy.procoreUserId", "==", me), orderBy("lastActivityAt", "desc"), limit(FEED_SIZE))
      : query(base, orderBy("lastActivityAt", "desc"), limit(FEED_SIZE));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() })), null), (err) => callback(null, err));
}

export const watchConversation = (key, cid, callback) =>
  onSnapshot(convDoc(key, cid), (d) => callback(d.exists() ? { id: d.id, ...d.data() } : null), () => callback(null));

export const watchMessages = (key, cid, callback) =>
  onSnapshot(query(msgCol(key, cid), orderBy("clientCreatedAt", "asc")), (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => callback([]));

/** cid -> lastReadAt (ms) for me in this project */
export const watchReads = (key, me, callback) =>
  onSnapshot(collection(db, "procoreProjects", key, "members", me, "reads"), (snap) => {
    callback(new Map(snap.docs.map((d) => [d.id, d.data().lastReadAt ?? 0])));
  }, () => callback(new Map()));

export const markRead = (key, me, cid) =>
  setDoc(doc(db, "procoreProjects", key, "members", me, "reads", cid), { lastReadAt: Date.now() }).catch(() => {});

/** Unread for me: I'm tagged, someone else wrote last, after I last opened it */
export const isUnread = (c, me, reads) =>
  (c.taggedIds ?? []).includes(me) && c.status !== "closed"
  && (c.lastMessage?.authorId ?? c.createdBy?.procoreUserId) !== me
  && (c.lastActivityAt ?? 0) > (reads.get(c.id) ?? 0);

/**
 * The picker's list split into To (tagged: responsible, get to-dos and alerts) and CC (kept in the loop: a CC
 * tab, no to-dos, no alerts). Picked people carry cc: true when switched to CC; the flag isn't stored.
 */
export function splitRecipients(list) {
  const plain = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "cc"));
  return { tagged: list.filter((r) => !r.cc).map(plain), cc: list.filter((r) => r.cc).map(plain) };
}

/** CC'd people who aren't also on the To line (someone added as To later stays To) */
export const ccOf = (c) => (c?.cc ?? []).filter((p) => !(c.taggedIds ?? []).includes(p.procoreUserId));

/** Open tasks in a conversation that are for me */
export const myTasks = (c, me) => (c.openTasks ?? []).filter((t) => (t.assigneeIds ?? []).includes(me));

const urls = new Map();
export async function fileUrl(path) {
  if (!path) return null;
  if (!urls.has(path)) urls.set(path, getDownloadURL(ref(storage, path)).catch(() => null));
  return urls.get(path);
}

// ---------- changing a conversation ----------

/**
 * Close or reopen, with a line in the thread ("Closed by Tia") so the other people get the unread alert.
 * One batch: the rules check the conversation as it will be after it.
 */
export function setStatus(key, cid, status, me) {
  const now = Date.now();
  const batch = writeBatch(db);
  batch.update(convDoc(key, cid), { status, statusBy: me.procoreUserId, statusAt: now });
  batch.set(doc(msgCol(key, cid), newId()), {
    authorId: me.procoreUserId, authorName: me.name, text: "", transcript: "", transcriptStatus: "none", photos: [],
    voicePath: null, voiceType: null, aiDescription: null, event: status === "closed" ? "closed" : "reopened",
    clientCreatedAt: now, createdAt: now,
  });
  return batch.commit();
}

/** Add people to a conversation, To or CC (picked people with cc: true). Someone already on it stays as they are. */
export function addPeople(key, conversation, people) {
  const known = new Set([...(conversation.taggedIds ?? []), ...(conversation.ccIds ?? [])]);
  const { tagged, cc } = splitRecipients(people.filter((p) => !known.has(p.procoreUserId)));
  const update = {};
  if (tagged.length) Object.assign(update, { tagged: arrayUnion(...tagged), taggedIds: arrayUnion(...tagged.map((p) => p.procoreUserId)) });
  if (cc.length) Object.assign(update, { cc: arrayUnion(...cc), ccIds: arrayUnion(...cc.map((p) => p.procoreUserId)) });
  if (!Object.keys(update).length) return Promise.resolve();
  return updateDoc(convDoc(key, conversation.id), update);
}

export const setTask = (key, cid, mid, taskId, status) =>
  httpsCallable(functions, "setMessageTask")({ key, cid, mid, taskId, status });

// ---------- the composer: upload now (when online) for words and descriptions ----------

export const newId = () => crypto.randomUUID();
export const voicePathFor = (key, cid, mid, type) => `messages/${key}/${cid}/${mid}/voice.${extFor(type)}`;
export const photoPathFor = (key, cid, mid, n, type) => `messages/${key}/${cid}/${mid}/photo-${n}.${extFor(type)}`;

export async function uploadFile(path, blob) {
  await uploadBytes(ref(storage, path), blob, { contentType: baseType(blob.type) });
  return path;
}

export async function transcribeVoice(key, path, type) {
  const r = await httpsCallable(functions, "transcribeMessageVoice", { timeout: 120000 })({ key, path, type: baseType(type) });
  return r.data?.text ?? "";
}

export async function describePhoto(key, path, words) {
  const r = await httpsCallable(functions, "describeMessagePhoto", { timeout: 120000 })({ key, path, words });
  return r.data?.text ?? "";
}

// ---------- sending (queued on this phone until it's uploaded) ----------

const listeners = new Set();
export function onQueueChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const notify = () => listeners.forEach((fn) => fn());

/** Remove a message that can't be sent (the person decides; it never leaves this phone) */
export async function discardPending(mid) {
  await del(QUEUE + mid);
  notify();
}

/** Why a waiting message hasn't gone: "" (sending), "signal", "refused", or "other" (queued by someone else) */
export function pendingReason(m, myId) {
  if (m.me?.procoreUserId && myId && String(m.me.procoreUserId) !== String(myId)) return "other";
  if (!m.lastError) return "";
  return /permission-denied/.test(m.lastError) ? "refused" : "signal";
}

/** The line under a waiting message, in plain words */
export function pendingLine(m, myId) {
  const why = pendingReason(m, myId);
  if (why === "other") return `Waiting for ${m.me?.name ?? "the person who wrote it"} to sign in on this browser to send it.`;
  if (why === "refused") return "Couldn't send: SiteSnap refused it. Remove it and send it again.";
  if (why === "signal") return "Not sent yet. It'll try again when there's signal.";
  return "Sending…";
}

export async function pendingMessages() {
  const ids = (await keys()).filter((k) => typeof k === "string" && k.startsWith(QUEUE));
  return (await Promise.all(ids.map((k) => get(k)))).filter(Boolean).sort((a, b) => a.clientCreatedAt - b.clientCreatedAt);
}

/**
 * Queue a message. newConversation = { tagged, cc? } starts one; otherwise cid is an existing conversation.
 * photos: [{ blob, path? }] (path when already uploaded), voice: { blob, path? } | null,
 * status: a quick reply { code, label, reason?, newDate? } | null (on its own, it's a one-tap answer).
 */
export async function queueMessage({ key, cid, mid = newId(), me, newConversation = null, text = "", transcript = "", transcriptDone = false, photos = [], voice = null, aiDescription = null, status = null }) {
  const entry = {
    key, cid, mid, me, newConversation, text, transcript, transcriptDone, aiDescription, status,
    photos: photos.map((p, i) => ({ blob: p.blob, path: p.path ?? photoPathFor(key, cid, mid, i + 1, p.blob.type), uploaded: !!p.path })),
    voice: voice ? { blob: voice.blob, path: voice.path ?? voicePathFor(key, cid, mid, voice.blob.type), type: baseType(voice.blob.type), uploaded: !!voice.path } : null,
    clientCreatedAt: Date.now(),
    attempts: 0,
  };
  await set(QUEUE + mid, entry);
  notify();
  syncMessages();
  return entry;
}

let syncing = null;
export function syncMessages() {
  if (!syncing) syncing = run().finally(() => { syncing = null; });
  return syncing;
}

async function run() {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  // Only the person who wrote a message sends it: one queued before switching accounts waits for them
  const claims = auth.currentUser ? (await auth.currentUser.getIdTokenResult().catch(() => null))?.claims : null;
  const myId = claims?.procoreUserId ? String(claims.procoreUserId) : null;
  for (const m of await pendingMessages()) {
    if (!myId || String(m.me?.procoreUserId) !== myId) continue;
    try {
      for (const p of m.photos) if (!p.uploaded) { await uploadFile(p.path, p.blob); p.uploaded = true; await set(QUEUE + m.mid, m); }
      if (m.voice && !m.voice.uploaded) { await uploadFile(m.voice.path, m.voice.blob); m.voice.uploaded = true; await set(QUEUE + m.mid, m); }
      const now = Date.now();
      if (m.newConversation) {
        const existing = await getDoc(convDoc(m.key, m.cid)).catch(() => null);
        if (!existing?.exists()) {
          await setDoc(convDoc(m.key, m.cid), {
            createdBy: m.me,
            tagged: m.newConversation.tagged,
            taggedIds: m.newConversation.tagged.map((t) => t.procoreUserId),
            // CC: kept in the loop (their CC tab), never to-dos or alerts
            ...(m.newConversation.cc?.length ? { cc: m.newConversation.cc, ccIds: m.newConversation.cc.map((t) => t.procoreUserId) } : {}),
            status: "open",
            createdAt: m.clientCreatedAt,
            lastActivityAt: m.clientCreatedAt,
            // the Procore record this thread follows (voice + photo -> Procore record)
            ...(m.newConversation.procore ? { procore: m.newConversation.procore } : {}),
          });
        }
      }
      await setDoc(doc(msgCol(m.key, m.cid), m.mid), {
        authorId: m.me.procoreUserId,
        authorName: m.me.name,
        text: m.text.trim(),
        transcript: m.transcript.trim(),
        // no words yet for a voice note recorded without signal: the server writes them down
        transcriptStatus: m.voice ? (m.transcriptDone ? "done" : "pending") : "none",
        photos: m.photos.map((p) => ({ path: p.path })),
        voicePath: m.voice?.path ?? null,
        voiceType: m.voice?.type ?? null,
        aiDescription: m.aiDescription?.trim() || null,
        // a quick reply (src/messaging/quickReplies.js): { code, label, reason?, newDate? }
        ...(m.status ? { status: m.status } : {}),
        clientCreatedAt: m.clientCreatedAt,
        createdAt: now,
      });
      await del(QUEUE + m.mid);
      notify();
    } catch (err) {
      m.attempts = (m.attempts ?? 0) + 1;
      m.lastError = String(err?.code ?? err?.message ?? err).slice(0, 200);
      await set(QUEUE + m.mid, m);
      notify();
      if (err?.code === "permission-denied") continue; // try the rest; this one shows "Not sent"
      break; // probably no signal: try again later, in order
    }
  }
}

export function startMessageSync() {
  const go = () => syncMessages();
  window.addEventListener("online", go);
  document.addEventListener("visibilitychange", go);
  const t = setInterval(go, 60000);
  go();
  return () => {
    window.removeEventListener("online", go);
    document.removeEventListener("visibilitychange", go);
    clearInterval(t);
  };
}
