import { useEffect, useState } from "react";
import Sheet from "./Sheet";
import { listMics, listMicsWithNames, savedMic, saveMic } from "./micChoice";

// Computers only (mouse/trackpad): phones pick the right mic on their own
const onComputer = () => window.matchMedia?.("(pointer: fine)").matches;

/**
 * "Microphone: <name> · Change" under Tap to Talk, shown on computers with more than
 * one mic. The choice is remembered on this device.
 */
export default function MicPicker({ disabled }) {
  const [count, setCount] = useState(0);
  const [chosen, setChosen] = useState(savedMic);
  const [mics, setMics] = useState(null); // list shown in the sheet; null = closed
  const [error, setError] = useState("");

  useEffect(() => {
    if (!onComputer() || !navigator.mediaDevices?.addEventListener) return;
    const refresh = () => listMics().then((m) => setCount(m.length)).catch(() => {});
    refresh();
    navigator.mediaDevices.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener("devicechange", refresh);
  }, [disabled]); // re-check after recording: mic names only show once permission is given

  if (count < 2) return null;

  const open = async () => {
    setError("");
    try {
      setMics(await listMicsWithNames());
    } catch {
      setError("PicTalk needs permission to use the microphone. Allow it in the browser, then try again.");
      setMics([]);
    }
  };
  const pick = (mic) => {
    saveMic(mic);
    setChosen(mic);
    setMics(null);
  };

  return (
    <>
      <p className="mic-line">
        Microphone: <strong>{chosen?.label || "Browser default"}</strong>{" "}
        <button type="button" className="text-btn inline" onClick={open} disabled={disabled}>
          Change
        </button>
      </p>
      {mics && (
        <Sheet title="Which microphone?" onClose={() => setMics(null)}>
          {error && <p className="summary-error" role="alert">{error}</p>}
          <div className="sheet-form">
            {mics.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`big-btn plain-btn mic-choice${chosen?.id === m.id ? " is-on" : ""}`}
                aria-pressed={chosen?.id === m.id}
                onClick={() => pick(m)}
              >
                {m.label}
              </button>
            ))}
            <button
              type="button"
              className={`big-btn plain-btn mic-choice${!chosen ? " is-on" : ""}`}
              aria-pressed={!chosen}
              onClick={() => pick(null)}
            >
              Browser default
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
