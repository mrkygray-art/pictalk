// src/liveTranscribe.js — live (streaming) transcription with Deepgram
// The phone asks the getDeepgramStreamToken Cloud Function for a short-lived token, then
// opens Deepgram's /v1/listen WebSocket directly and streams audio chunks to it.
// The Deepgram API key never reaches the phone. A connection is opened per recording
// stretch: Pause closes it (no charge for silence), Continue opens a new one.
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { engLog, setLiveInfo, ms } from './engineering';

const getToken = httpsCallable(functions, 'getDeepgramStreamToken', { timeout: 15000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Open one live connection. Callbacks:
 *   onInterim(text)  — words still being worked out ("" clears them)
 *   onFinal(text)    — finished words
 *   onUtteranceEnd() — the speaker paused: start a new paragraph
 *   onDrop()         — the connection ended unexpectedly
 * Returns { send(blob), finish() }; finish() asks Deepgram to flush its last words and
 * waits briefly for them. Throws if the connection can't be opened.
 */
export async function openLiveStream({ onInterim, onFinal, onUtteranceEnd, onDrop }) {
  setLiveInfo({ state: 'connecting', tokenMs: null, connectMs: null, firstWordsMs: null, reason: '' });
  const fail = (reason) => {
    setLiveInfo({ state: 'offline', reason });
    engLog('error', 'Live words unavailable; the recording is transcribed after you finish', reason);
    return new Error(reason);
  };
  if (import.meta.env.DEV && window.__pictalkFailStream) throw fail('live stream disabled for this test');
  if (!navigator.onLine) throw fail('offline');
  const t0 = performance.now();
  let data;
  try {
    ({ data } = await getToken());
  } catch (err) {
    throw fail(`token request failed: ${err?.code || err?.message || err}`);
  }
  const tokenMs = performance.now() - t0;
  setLiveInfo({ tokenMs });
  if (data.fake) {
    setLiveInfo({ state: 'live', connectMs: 0 });
    engLog('live', 'Live words connected (emulator stand-in)', `token ${ms(tokenMs)}`);
    return fakeStream({ onInterim, onFinal, onUtteranceEnd });
  }

  const params = new URLSearchParams({
    model: data.model,
    interim_results: 'true', // gray words while speaking
    smart_format: 'true',
    endpointing: '300', // finish words after a short pause
    utterance_end_ms: '1000', // paragraph break after a longer pause
  });
  (data.keyterms || []).forEach((t) => params.append('keyterm', t));

  // Browsers can't set an Authorization header on a WebSocket; the temporary token goes
  // in the Sec-WebSocket-Protocol header instead.
  const t1 = performance.now();
  const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ['bearer', data.token]);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(fail('connect timeout')), 8000);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = () => { clearTimeout(timer); reject(fail('connect failed')); };
  });
  const opened = performance.now();
  setLiveInfo({ state: 'live', connectMs: opened - t1 });
  engLog('live', 'Live words connected', `token ${ms(tokenMs)} · connection ${ms(opened - t1)} · ${data.model}`);
  let firstWords = true;

  let closing = false;
  let markClosed;
  const closed = new Promise((r) => { markClosed = r; });
  ws.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type === 'Results') {
      const text = msg.channel?.alternatives?.[0]?.transcript || '';
      if (text && firstWords) {
        firstWords = false; // from the connection opening, so it includes the time before you spoke
        setLiveInfo({ firstWordsMs: performance.now() - opened });
      }
      if (msg.is_final) {
        onInterim('');
        if (text) onFinal(text);
      } else {
        onInterim(text);
      }
    } else if (msg.type === 'UtteranceEnd') {
      onUtteranceEnd();
    }
  };
  ws.onerror = () => {};
  ws.onclose = () => {
    markClosed();
    if (!closing) {
      setLiveInfo({ state: 'offline', reason: 'connection dropped' });
      engLog('error', 'Live words dropped; the recording is transcribed after you finish');
      onDrop();
    }
  };

  return {
    send(blob) {
      if (ws.readyState === WebSocket.OPEN && blob.size) ws.send(blob);
    },
    async finish() {
      closing = true;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'CloseStream' })); // flush the last words, then close
        await Promise.race([closed, sleep(3000)]);
      }
      try { ws.close(); } catch { /* already closed */ }
      setLiveInfo({ state: 'idle' });
    },
  };
}

// Emulator-only stand-in, used when the token function says so (it only does in the
// Functions emulator). Plays a short pretend transcript word by word.
function fakeStream({ onInterim, onFinal, onUtteranceEnd }) {
  const lines = ['Panel door is loose', 'and the hinge is rusted', 'Customer wants it replaced this month'];
  let line = 0;
  let word = 0;
  let stopped = false;
  const tick = setInterval(() => {
    if (stopped || line >= lines.length) return;
    const words = lines[line].split(' ');
    word++;
    if (word < words.length) {
      onInterim(words.slice(0, word).join(' '));
    } else {
      onInterim('');
      onFinal(`${lines[line]}.`);
      if (line % 2 === 1) onUtteranceEnd();
      line++;
      word = 0;
    }
  }, 250);
  return {
    send() {},
    async finish() {
      stopped = true;
      clearInterval(tick);
      onInterim('');
    },
  };
}
