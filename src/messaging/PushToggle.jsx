import { useEffect, useState } from "react";
import { pushState, turnOffPush, turnOnPush } from "./pushStore";

// The Alerts line on the Messages screen: phone notifications when someone messages you on a thread
const LINES = {
  off: "Alerts are off. Turn them on to get a phone notification when someone messages you.",
  on: "Alerts are on for this phone.",
  blocked: "Alerts are blocked for this site in your browser's settings. Allow notifications there, then come back.",
  install: "On iPhone, alerts work once SiteSnap is on your Home Screen: tap Share, then Add to Home Screen, and open it from there.",
  unsupported: "This browser can't show alerts.",
};

export default function PushToggle({ myId }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { pushState(myId).then(setState); }, [myId]);
  if (!state || state === "not-set-up") return null;

  const flip = async () => {
    setBusy(true);
    setError("");
    try {
      setState(await (state === "on" ? turnOffPush(myId) : turnOnPush(myId)));
    } catch (e) {
      setError(e?.message ?? "Couldn't change alerts. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="push-line">
      <p className="msg-footnote">{LINES[state]}</p>
      {(state === "on" || state === "off") && (
        <button type="button" className="text-btn" onClick={flip} disabled={busy}>
          {busy ? "One moment…" : state === "on" ? "Turn off alerts" : "Turn on alerts"}
        </button>
      )}
      {error && <p className="msg-status">{error}</p>}
    </div>
  );
}
