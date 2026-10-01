// src/micChoice.js — which microphone to record from.
// Browsers pick a mic on their own, and on a computer with several mics (Firefox
// especially) that can be the wrong one. The user's choice is remembered on this
// device and asked for by id every time; if that mic is gone, it's found again by name,
// otherwise the browser's default is used.
const KEY = 'pictalk-mic';

function saved() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}

/** The remembered mic: { id, label } or null (browser default). */
export const savedMic = saved;

export function saveMic(mic) {
  try {
    if (mic) localStorage.setItem(KEY, JSON.stringify({ id: mic.id, label: mic.label }));
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked: the choice just won't be remembered
  }
}

/** Mics on this device. Names are only filled in once the site has mic permission. */
export async function listMics() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === 'audioinput' && d.deviceId && !['default', 'communications'].includes(d.deviceId))
    .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}

/** Ask for mic permission (so names show), then list the mics. */
export async function listMicsWithNames() {
  let mics = await listMics();
  if (mics.length && mics.every((m) => /^Microphone \d+$/.test(m.label))) {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    mics = await listMics();
  }
  return mics;
}

const tryOpen = (id) => navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: id } } });

/** Open the chosen mic (or the browser default). Use instead of getUserMedia({ audio: true }). */
export async function openMic() {
  const mic = saved();
  if (mic?.id) {
    try {
      return await tryOpen(mic.id);
    } catch (err) {
      if (err?.name === 'NotAllowedError') throw err;
      // The id can change (e.g. unplugged and plugged back in): look it up by name
      const again = mic.label && (await listMics()).find((m) => m.label === mic.label);
      if (again) {
        try {
          const stream = await tryOpen(again.id);
          saveMic(again);
          return stream;
        } catch {
          // fall through to the default mic
        }
      }
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: true });
}
