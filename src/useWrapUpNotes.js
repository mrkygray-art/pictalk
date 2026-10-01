import { useEffect, useState } from "react";
import { watchNotes, getPendingPieces, onNoteQueueChange } from "./wrapUpStore";

/**
 * Wrap-up notes for a job: { notes: { field?, customer? }, pending: { field: [...], customer: [...] }, loaded }.
 * Combines the cloud records with pieces still waiting on this phone.
 */
export default function useWrapUpNotes(uid, jobId) {
  const [notes, setNotes] = useState(null);
  const [pending, setPending] = useState({ field: [], customer: [] });

  useEffect(() => {
    if (!uid || !jobId) return;
    return watchNotes(uid, jobId, setNotes);
  }, [uid, jobId]);

  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    const refresh = () =>
      getPendingPieces(jobId).then((items) => {
        if (!alive) return;
        setPending({
          field: items.filter((p) => p.type === "field"),
          customer: items.filter((p) => p.type === "customer"),
        });
      });
    refresh();
    const stop = onNoteQueueChange(refresh);
    return () => {
      alive = false;
      stop();
    };
  }, [jobId]);

  return { notes: notes || {}, pending, loaded: notes !== null };
}
