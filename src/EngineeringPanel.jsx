// Engineering Mode screens: the sync panel, the per-stop pipeline line, and the extra
// lines for the AI summary and live words. Shown only when Engineering Mode is on.
import { useEffect, useState } from "react";
import {
  useEngineering, setEngOn, engLogEntries, syncInfo, liveInfo, uploadTiming, ms, bytes, millis,
} from "./engineering";
import { syncQueue } from "./stopStore";

const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });

// Small link at the bottom of the main screen
export function EngineeringToggle() {
  const { on } = useEngineering();
  return (
    <button className="text-btn eng-toggle" onClick={() => setEngOn(!on)} aria-pressed={on}>
      {on ? "Turn off Engineering Mode" : "Engineering Mode"}
    </button>
  );
}

const STEPS = [
  ["Photo + voice", "taken on the phone"],
  ["Saved on this phone", "IndexedDB, works offline"],
  ["Uploaded", "Firebase Storage"],
  ["Record saved", "Firestore, written last"],
  ["Writing it down", "Cloud Function → Deepgram nova-3"],
  ["Words on the stop", "editable; original kept"],
  ["AI summary", "Claude, when the job ends"],
];

// Sync panel + pipeline + session log, under the header
export function EngineeringPanel({ pending, online, uid }) {
  const { on } = useEngineering();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000); // keeps "next try in" counting down
    return () => clearInterval(t);
  }, [on]);
  if (!on) return null;

  const next = syncInfo.nextRunAt ? Math.max(0, Math.round((syncInfo.nextRunAt - now) / 1000)) : null;
  const log = [...engLogEntries()].reverse().slice(0, 12);
  return (
    <section className="eng-panel" aria-label="Engineering Mode">
      <h2>Engineering Mode</h2>
      <p className="eng-fine">What PicTalk is doing under the hood, with real timings from this phone and your own records.</p>

      <ol className="eng-pipe" aria-label="How a stop is saved">
        {STEPS.map(([step, how]) => (
          <li key={step}>
            <b>{step}</b>
            <span>{how}</span>
          </li>
        ))}
      </ol>

      <h3>Sync</h3>
      <dl className="eng-grid">
        <dt>Connection</dt>
        <dd className={online ? "eng-ok" : "eng-warn"}>{online ? "Online" : "Offline: stops wait on this phone"}</dd>
        <dt>Signed in</dt>
        <dd>{uid ? "Yes (anonymous account)" : "Not yet"}</dd>
        <dt>Waiting on this phone</dt>
        <dd>{pending.length}</dd>
        <dt>Last sync</dt>
        <dd>
          {syncInfo.running ? "Running now…" : syncInfo.lastRunAt ? `${clock(syncInfo.lastRunAt)} · ${syncInfo.lastResult}` : "Not yet this session"}
        </dd>
        <dt>Next automatic try</dt>
        <dd>{next == null ? "–" : `in ${next} s (also on reconnect and when the app reopens)`}</dd>
      </dl>
      {pending.length > 0 && (
        <ul className="eng-list">
          {pending.map((p) => (
            <li key={p.id}>
              {clock(p.clientCreatedAt)} · {[p.photoBlob && `photo ${bytes(p.photoBlob.size)}`, p.audioBlob && `voice ${bytes(p.audioBlob.size)}`].filter(Boolean).join(", ")}
              {" · "}tries {p.attempts || 0}
              {p.lastError && <span className="eng-warn"> · last error: {p.lastError}</span>}
            </li>
          ))}
        </ul>
      )}
      <button className="eng-btn" onClick={() => syncQueue()} disabled={!online || syncInfo.running}>
        Sync now
      </button>

      <h3>This session</h3>
      {log.length === 0 ? (
        <p className="eng-fine">Save a stop to see each step here.</p>
      ) : (
        <ol className="eng-log">
          {log.map((e, i) => (
            <li key={`${e.at}-${i}`} className={e.kind === "error" ? "eng-warn" : undefined}>
              <span className="eng-time">{clock(e.at)}</span> <b>{e.text}</b>
              {e.detail && <span className="eng-detail">{e.detail}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// Extra line on each stop card
export function StopEngLine({ stop }) {
  const { on } = useEngineering();
  if (!on) return null;
  if (stop.isPending) {
    return (
      <div className="eng-line">
        On this phone (IndexedDB) · tries {stop.attempts || 0}
        {stop.lastError ? ` · last error: ${stop.lastError}` : ""}
      </div>
    );
  }
  const created = millis(stop.createdAt);
  const transcribed = millis(stop.transcribedAt);
  const up = uploadTiming(stop.id);
  const t = stop.transcribeTimings;
  const lines = [];
  if (created) {
    const wait = created - stop.clientCreatedAt; // phone clock vs server clock, so only roughly right
    lines.push(wait >= 0 ? `Phone → cloud: ${ms(wait)} (phone clock vs server clock)` : "Phone → cloud: under a second (this phone's clock runs ahead of the server's)");
  }
  if (up) {
    lines.push(
      [
        "Upload this session:",
        up.photoMs != null && `photo ${bytes(up.photoBytes)} in ${ms(up.photoMs)}`,
        up.audioMs != null && `voice ${bytes(up.audioBytes)} in ${ms(up.audioMs)}`,
        `record ${ms(up.recordMs)}`,
      ].filter(Boolean).join(" ")
    );
  }
  if (transcribed && created) {
    const parts = t ? ` (download ${ms(t.downloadMs)}, Deepgram ${ms(t.deepgramMs)})` : "";
    lines.push(`Uploaded → words: ${ms(transcribed - created)}${parts}`);
  }
  if (stop.audioSeconds) {
    const speed = transcribed && created ? ` · ${(stop.audioSeconds / ((transcribed - created) / 1000)).toFixed(1)}× real time` : "";
    lines.push(`${stop.audioSeconds.toFixed(1)} s of audio${speed}`);
  }
  if (stop.transcriptModel || stop.transcriptConfidence != null) {
    lines.push(
      [stop.transcriptModel, stop.transcriptConfidence != null && `confidence ${Math.round(stop.transcriptConfidence * 100)}%`]
        .filter(Boolean).join(" · ")
    );
  }
  if (stop.editedTranscript != null) lines.push("Words corrected by you (original transcript kept)");
  if (stop.status === "transcription_failed" && stop.transcriptError) lines.push(`Error: ${stop.transcriptError.slice(0, 160)}`);
  lines.push(`Status: ${stop.status || "uploaded"}`);
  return (
    <div className="eng-line">
      {lines.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );
}

// Under the AI summary on the job page
export function SummaryEngLine({ summary, perJobLimit }) {
  const { on } = useEngineering();
  if (!on || !summary) return null;
  const g = summary.generation;
  return (
    <div className="eng-line">
      <div>
        Model: {summary.model || "–"}
        {g && ` · ${ms(g.ms)} · ${g.attempts} attempt${g.attempts === 1 ? "" : "s"}`}
      </div>
      {g && (g.inputTokens != null || g.outputTokens != null) && (
        <div>
          Tokens: {g.inputTokens?.toLocaleString() ?? "–"} in · {g.outputTokens?.toLocaleString() ?? "–"} out
        </div>
      )}
      <div>
        Summaries made for this job: {summary.generationCount ?? "–"} of {perJobLimit}
      </div>
      {!g && <div>Timing and tokens are saved for summaries made from now on.</div>}
    </div>
  );
}

// Inside the wrap-up recorder
export function LiveEngLine() {
  const { on } = useEngineering();
  if (!on) return null;
  const l = liveInfo;
  return (
    <div className="eng-line eng-live">
      Live words: {l.state}
      {l.tokenMs != null && ` · token ${ms(l.tokenMs)}`}
      {l.connectMs != null && ` · connection ${ms(l.connectMs)}`}
      {l.firstWordsMs != null && ` · first words ${ms(l.firstWordsMs)} after connecting`}
      {l.reason && ` · ${l.reason}`}
    </div>
  );
}
