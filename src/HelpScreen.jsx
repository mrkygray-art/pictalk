import { useEffect, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

// Help: the quick-start PDF (public/PicTalk-Quick-Start.pdf, works offline once installed) and
// "Ask PicTalk," a chat that answers how-to and best-practice questions from the help guide
// (functions/helpGuide.js via askPicTalkHelp). Type or tap the mic (the browser's own speech
// recognition; the mic is hidden where it isn't available). The conversation lives in App's
// state, so it's still there after visiting another screen.

export const QUICK_START_PDF = "/PicTalk-Quick-Start.pdf";
const MAX_QUESTION = 500;
const SUGGESTIONS = [
  "How do I start my first job?",
  "Tips for clear voice notes",
  "How do I fix a word it got wrong?",
  "Does it work without signal?",
  "How do I get the PDF report?",
];
const ask = httpsCallable(functions, "askPicTalkHelp", { timeout: 65000 });
const Speech = typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}
function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

const errorText = (err) => {
  const code = String(err?.code || "");
  if (code.includes("resource-exhausted") || code.includes("invalid-argument")) return err.message;
  if (code.includes("unavailable") || !navigator.onLine) return "The help chat needs signal. The quick-start guide works without it.";
  return "The help chat couldn't answer right now. Please try again.";
};

export default function HelpScreen({ online, chat, setChat, onClose }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [note, setNote] = useState("");
  const rec = useRef(null);
  const heard = useRef("");
  const endRef = useRef(null);

  useEffect(() => endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }), [chat.length, busy]);
  useEffect(() => () => rec.current?.abort(), []);

  const send = async (q) => {
    const question = (q ?? text).trim();
    if (!question || busy) return;
    if (!online) return setNote("The help chat needs signal. The quick-start guide works without it.");
    setNote("");
    setText("");
    const history = chat.filter((m) => !m.error).slice(-6).map((m) => ({ role: m.role, content: m.text }));
    setChat((c) => [...c, { role: "user", text: question }]);
    setBusy(true);
    try {
      const { answer, sources } = (await ask({ question, history })).data;
      setChat((c) => [...c, { role: "assistant", text: answer, sources }]);
    } catch (err) {
      setChat((c) => [...c, { role: "assistant", text: errorText(err), error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const toggleMic = () => {
    if (rec.current) return rec.current.stop();
    if (busy) return;
    setNote("");
    heard.current = "";
    const r = new Speech();
    r.lang = navigator.language || "en-US";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      heard.current = Array.from(e.results).map((x) => x[0].transcript).join("").trim().slice(0, MAX_QUESTION);
      setText(heard.current);
    };
    r.onerror = (e) => {
      heard.current = "";
      const msg = {
        "not-allowed": "The microphone is blocked for PicTalk. Allow it in your browser settings, or type your question.",
        "service-not-allowed": "Voice questions aren't available in this browser. Type your question instead.",
        "no-speech": "I didn't hear anything. Tap the mic and try again.",
        "audio-capture": "No microphone was found. Type your question instead.",
        network: "Voice questions need signal. Type your question instead.",
      }[e.error];
      if (msg) setNote(msg);
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
      if (heard.current) send(heard.current); // send as soon as the speaker stops
    };
    try {
      r.start();
      rec.current = r;
      setListening(true);
    } catch {
      setNote("Voice questions couldn't start. Type your question instead.");
    }
  };

  return (
    <section className="help" aria-label="Help">
      <button className="link-btn" onClick={onClose}>
        <BackIcon />
        Camera
      </button>
      <h1 className="page-title">Help</h1>

      {/* No `download`: with target=_blank, an installed desktop app opened a blank window and
          only downloaded the file. Opening it shows the PDF; sw.js serves it offline. */}
      <a className="help-guide" href={QUICK_START_PDF} target="_blank" rel="noopener">
        <strong>PicTalk quick-start guide</strong>
        <span>One-page PDF: your first job in five steps, plus tips. Works without signal.</span>
      </a>

      <h2 className="help-h2">Ask PicTalk</h2>
      <p className="help-intro">Ask how to do something, or for tips on getting the best results. Type, or tap the mic and say it.</p>

      <div className="help-chat" aria-live="polite">
        {chat.length === 0 && (
          <div className="help-sugs">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" className="help-chip" onClick={() => send(s)} disabled={busy}>
                {s}
              </button>
            ))}
          </div>
        )}
        {chat.map((m, i) =>
          m.role === "user" ? (
            <p key={i} className="help-user">{m.text}</p>
          ) : (
            <div key={i} className={`help-bot${m.error ? " is-error" : ""}`}>
              <p>{m.text}</p>
              {m.sources?.length > 0 && <p className="help-src">From the guide: {m.sources.map((s) => s.title).join(" · ")}</p>}
            </div>
          )
        )}
        {busy && <p className="help-wait">Looking that up…</p>}
        <div ref={endRef} />
      </div>

      <form
        className="help-row"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          className="help-in"
          value={text}
          maxLength={MAX_QUESTION}
          placeholder={listening ? "Listening… ask your question" : "Ask a question"}
          aria-label="Your question"
          onChange={(e) => setText(e.target.value)}
          onFocus={() => rec.current?.abort()}
        />
        {Speech && (
          <button
            type="button"
            className={`help-mic${listening ? " is-on" : ""}`}
            onClick={toggleMic}
            disabled={busy}
            aria-pressed={listening}
            aria-label={listening ? "Stop listening" : "Ask by voice"}
          >
            <MicIcon />
          </button>
        )}
        <button type="submit" className="help-send" disabled={busy || !text.trim()}>
          Ask
        </button>
      </form>
      {listening && <p className="help-note">Listening. Tap the mic again to stop.</p>}
      {!online && !note && <p className="help-note">The help chat needs signal. The quick-start guide works without it.</p>}
      {note && <p className="help-note is-warn">{note}</p>}
      {chat.length > 0 && (
        <button type="button" className="text-btn" onClick={() => setChat([])} disabled={busy}>
          Start over
        </button>
      )}
    </section>
  );
}
