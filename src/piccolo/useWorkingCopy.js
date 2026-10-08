import { useCallback, useEffect, useRef, useState } from "react";
import { watchWorking, saveWorking, markEditing } from "./piccoloStore";

const UNDO_STEPS = 20;
const SAVE_DELAY = 600; // ms after the last edit

/**
 * The user's editable copy (working/current) with autosave and undo.
 * Every edit is a function that changes a copy; it's shown at once and saved shortly after.
 * Saves go through Firestore's offline cache, so they work without signal and sync later.
 * If another device saves something newer, that wins (newest updatedAt).
 */
export default function useWorkingCopy(uid, job) {
  const jobId = job.id;
  const [server, setServer] = useState(undefined); // undefined = loading, null = none yet
  const [local, setLocal] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | waiting | saving | saved | offline | error
  const [undoCount, setUndoCount] = useState(0);
  const history = useRef([]);
  const pending = useRef(null);
  const timer = useRef(null);
  const statusOfJob = useRef(job.piccoloStatus);
  useEffect(() => {
    statusOfJob.current = job.piccoloStatus;
  }, [job.piccoloStatus]);

  useEffect(() => watchWorking(uid, jobId, setServer), [uid, jobId]);

  const working = local && (!server || (local.updatedAt || 0) >= (server.updatedAt || 0)) ? local : server;

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    setStatus(navigator.onLine ? "saving" : "offline");
    saveWorking(uid, jobId, next)
      .then(() => !pending.current && setStatus("saved"))
      .catch((err) => {
        console.warn("Saving Piccolo edits failed:", err);
        setStatus("error");
      });
  }, [uid, jobId]);

  // Save right away when leaving the job or hiding the app
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [flush]);

  const commit = useCallback(
    (next) => {
      setLocal(next);
      pending.current = next;
      setStatus("waiting");
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY);
      if (statusOfJob.current === "drafted") markEditing(uid, jobId);
    },
    [flush, uid, jobId]
  );

  /** Change the working copy: fn gets a deep copy and returns (or mutates) it. */
  const edit = useCallback(
    (fn) => {
      if (!working) return;
      const copy = structuredClone(working);
      const changed = fn(copy) ?? copy;
      history.current = [...history.current, working].slice(-UNDO_STEPS);
      setUndoCount(history.current.length);
      commit({ ...changed, editedBy: uid, updatedAt: Date.now() });
    },
    [working, commit, uid]
  );

  const undo = useCallback(() => {
    const prev = history.current.pop();
    setUndoCount(history.current.length);
    if (prev) commit({ ...prev, editedBy: uid, updatedAt: Date.now() });
  }, [commit, uid]);

  /** Replace everything (e.g. "Use Draft 2"); can be undone too. */
  const replace = useCallback(
    (data) => {
      if (working) {
        history.current = [...history.current, working].slice(-UNDO_STEPS);
        setUndoCount(history.current.length);
      }
      commit({ ...data, editedBy: uid, createdAt: working?.createdAt ?? Date.now(), updatedAt: Date.now() });
    },
    [working, commit, uid]
  );

  return { working, loaded: server !== undefined, status, edit, undo, canUndo: undoCount > 0, replace };
}
