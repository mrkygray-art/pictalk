import results from "./results.json";
import { FIXES, NOT_MEASURED } from "./fixes";
import "./lab.css";

const secs = (ms) => (ms == null ? "–" : ms < 1000 ? "under 1 s" : `${(ms / 1000).toFixed(1)} s`);
const day = (iso) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Public page at /lab: the offline simulator's latest results and the fixes it led to. */
export default function LabPage() {
  const sc = results.scenarios;
  const runs = sc.reduce((n, s) => n + s.runs, 0);
  const passed = sc.reduce((n, s) => n + s.passed, 0);
  const recordings = sc.reduce((n, s) => n + s.recordings, 0);
  const env = results.environment;

  return (
    <main className="lab">
      <a className="lab-back" href="/">← PicTalk</a>
      <h1>Evaluation Lab</h1>
      <p className="lab-lead">
        A simulator uses PicTalk like a field tech would. It takes photos, records voice notes, and cuts the signal at
        the worst moments. Then it checks that every recording still reaches the cloud whole and gets written down.
      </p>

      <div className="lab-tiles">
        <div className="lab-tile">
          <b>{passed} of {runs}</b>
          <span>runs passed</span>
        </div>
        <div className="lab-tile">
          <b>{recordings}</b>
          <span>recordings checked</span>
        </div>
        <div className="lab-tile">
          <b>{FIXES.length}</b>
          <span>problems found and fixed</span>
        </div>
      </div>
      <p className="lab-fine">
        Last run {day(results.ranAt)} · {env.browser.replace(/^(Headless)?Chrome\/(\d+).*/, "Chrome $2")} at {env.viewport} ·{" "}
        {env.backend} · Microphone: {env.microphone}
      </p>

      <h2>Scorecard</h2>
      <div className="lab-scroll">
        <table className="lab-table">
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Passed</th>
              <th>Signal back → written down</th>
            </tr>
          </thead>
          <tbody>
            {sc.map((s) => (
              <tr key={s.id} className={s.passed === s.runs ? "" : "lab-bad"}>
                <td>
                  <a href={`#${s.id}`}>{s.title}</a>
                </td>
                <td>
                  {s.passed} of {s.runs}
                </td>
                <td>
                  {s.recoveryMs ? `${secs(s.recoveryMs.typical)} typical · ${secs(s.recoveryMs.slowest)} slowest` : "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lab-fine">
        Times are measured on one computer with local test servers, so they show the app reacts as soon as signal
        returns, not how fast a phone network is.
      </p>

      <h2>Scenarios</h2>
      {sc.map((s) => (
        <details key={s.id} id={s.id} className="lab-scenario">
          <summary>
            <span>{s.title}</span>
            <span className={s.passed === s.runs ? "lab-ok" : "lab-warn"}>
              {s.passed} of {s.runs}
            </span>
          </summary>
          <p>
            <b>What happens:</b> {s.what}
          </p>
          <p>
            <b>What it proves:</b> {s.proves}
          </p>
          <div className="lab-scroll">
            <table className="lab-table">
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Passed</th>
                  <th>Last result</th>
                </tr>
              </thead>
              <tbody>
                {s.checks.map((c) => (
                  <tr key={c.name} className={c.passed === c.runs ? "" : "lab-bad"}>
                    <td>{c.name}</td>
                    <td>
                      {c.passed} of {c.runs}
                    </td>
                    <td>{c.detail || "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}

      <h2>Fixes log</h2>
      <p className="lab-fine">Problems the simulator caught on its first run, and what changed.</p>
      <div className="lab-scroll">
        <table className="lab-table lab-fixes">
          <thead>
            <tr>
              <th>Fix</th>
              <th>What went wrong</th>
              <th>What changed</th>
              <th>Live app affected?</th>
              <th>Before → now</th>
            </tr>
          </thead>
          <tbody>
            {FIXES.map((f) => {
              const now = f.caughtBy.split(", ").map((id) => sc.find((s) => s.id === id)).filter(Boolean);
              return (
                <tr key={f.id}>
                  <td>
                    <b>{f.id}</b>
                    <br />
                    {f.title}
                  </td>
                  <td>{f.what}</td>
                  <td>{f.fix}</td>
                  <td>{f.liveApp}</td>
                  <td>
                    {f.before}
                    <br />→ {now.map((s) => `${s.passed} of ${s.runs}`).join(", ") || "–"} passing
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Not measured yet</h2>
      <div className="lab-scroll">
        <table className="lab-table lab-notes">
          <tbody>
            {NOT_MEASURED.map(([what, why]) => (
              <tr key={what}>
                <td>
                  <b>{what}</b>
                </td>
                <td>{why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>How it works</h2>
      <p>
        The simulator (<code>lab/simulate.js</code>) builds the real app and opens it in headless Chrome at phone size,
        with a test camera photo and a test microphone. It runs against local copies of Firebase: sign-in, database,
        file storage and the Cloud Functions. “Signal off” cuts the network for both the page and the app’s offline
        copy, like airplane mode. The transcriber is a free stand-in that reports how many bytes of audio it received,
        so the lab can prove each recording was written down from the whole file. It also decodes every stored
        recording to check its length against how long the microphone was held.
      </p>
    </main>
  );
}
