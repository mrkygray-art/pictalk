// PicTalk Evaluation Lab — the offline scenarios lab/simulate.js runs.
// Each run(phone, tools) drives one fresh phone and returns { checks, recoveryMs?, recordings? }.
// "Signal OFF" cuts the network for the page and the app's service worker (like airplane mode).

const isFinal = (s) => ['transcribed', 'no_speech', 'transcription_failed'].includes(s.status);

/** Wait for a wrap-up note's pieces to finish, then check each one was written down whole. */
async function checkNote(phone, t, type, expected, onlineAt) {
  const p = `users/${phone.uid}/jobs/${await phone.jobId()}/wrapUpNotes/${type}`;
  const note = await t.until(async () => {
    const d = await t.getDoc(p);
    return d && (d.segments || []).length >= expected.length && d.segments.every(isFinal) ? d : null;
  }, 120000);
  const recoveryMs = note && onlineAt ? Date.now() - onlineAt : null;
  const segs = (note || (await t.getDoc(p)) || {}).segments || [];
  const out = [];
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i];
    const s = segs[i];
    if (!s) { out.push({ ok: false, why: 'piece missing' }); continue; }
    const size = await t.fileSize(s.audioPath);
    const secs = await phone.audioSeconds(s.audioPath);
    const whole = secs != null && secs >= e.heldSec - 1.0;
    let ok = s.status === 'transcribed' && whole;
    let why = `${s.source} words, ${secs?.toFixed(1)} s of ${e.heldSec.toFixed(1)} s on file`;
    if (e.needsFullFile) {
      // Signal was lost while recording: the live words are incomplete, so the whole
      // file must be written down after upload ("batch"), not the live words kept.
      const fromFile = s.source === 'batch' && t.standInBytes(s.transcript) === size;
      ok = ok && fromFile;
      if (!fromFile) why = s.source === 'live' ? 'kept only the live words heard before the signal dropped' : `written from ${t.standInBytes(s.transcript)} of ${size} bytes`;
    }
    out.push({ ok, why });
  }
  return { results: out, recoveryMs, text: note?.text || '' };
}

const SCENARIOS = [
  {
    id: 'offline-before',
    title: 'No signal from the start',
    what: 'Signal off before the job starts. Two stops (photo + voice) saved, then signal returns.',
    proves: 'Stops saved with no signal upload and get written down when it comes back.',
    async run(phone, t) {
      await phone.launch();
      await phone.setOffline(true);
      await phone.startJob();
      const expected = [];
      for (let i = 0; i < 2; i++) expected.push({ heldSec: await phone.stop({ talkMs: 2500 }) });
      await t.sleep(3000);
      const body = await phone.page.evaluate(() => document.body.innerText);
      const waitingBefore = await phone.waiting();
      await phone.setOffline(false);
      const r = await t.waitAndCheckStops(phone, expected, Date.now());
      r.checks.unshift({ name: 'App shows the stops as saved on this phone while offline', ok: waitingBefore === 2 && /on this phone/i.test(body), detail: `${waitingBefore} waiting` });
      return r;
    },
  },
  {
    id: 'offline-mid-recording',
    title: 'Signal lost mid-recording',
    what: 'Signal drops 1.2 s into a 4 s voice note; the stop is saved offline; signal returns.',
    proves: 'Losing signal while talking doesn’t cut the recording short.',
    async run(phone, t) {
      await phone.launch();
      await phone.startJob();
      const heldSec = await phone.stop({ talkMs: 4000, during: async () => { await t.sleep(1200); await phone.setOffline(true); } });
      await t.sleep(3000);
      await phone.setOffline(false);
      return t.waitAndCheckStops(phone, [{ heldSec }], Date.now());
    },
  },
  {
    id: 'offline-mid-upload',
    title: 'Signal lost mid-upload',
    what: 'The photo uploads, then the signal drops the moment the voice note starts uploading. Signal returns 5 s later.',
    proves: 'A half-finished upload retries cleanly: no missing voice note, no duplicate stop, no stray files.',
    async run(phone, t) {
      await phone.launch();
      await phone.startJob();
      const page = phone.page;
      let cut = false;
      await page.setRequestInterception(true);
      page.on('request', async (req) => {
        const url = decodeURIComponent(req.url());
        if (!cut && req.method() === 'POST' && url.includes(':9199/') && url.includes('name=voice/')) {
          cut = true;
          await phone.setOffline(true);
          return req.abort('internetdisconnected');
        }
        return req.continue();
      });
      const heldSec = await phone.stop({ talkMs: 2500 });
      await t.until(async () => cut, 15000);
      await t.sleep(5000);
      await phone.setOffline(false);
      const r = await t.waitAndCheckStops(phone, [{ heldSec }], Date.now());
      r.checks.unshift({ name: 'Upload was cut mid-way', ok: cut });
      return r;
    },
  },
  {
    id: 'drop-live',
    title: 'Live words drop mid-sentence',
    what: 'Wrap-up notes: field notes recorded with live words the whole way (control); customer comments lose signal 2 s in, keep recording 2 s, then Done. Signal returns.',
    proves: 'When live words drop, the full recording is written down after upload, so no words are lost.',
    async run(phone, t) {
      await phone.launch();
      await phone.startJob();
      await phone.stop({ talkMs: null }); // photo-only stop
      await phone.button('End Job');
      await phone.waitText('Wrap-up notes');

      // Control: live words stay connected the whole time
      await phone.button('Add field notes');
      await phone.page.waitForSelector('.recorder');
      let t0 = Date.now();
      await t.sleep(3500);
      await phone.click('button[aria-label="Done"]');
      const fieldHeld = (Date.now() - t0) / 1000;
      await phone.page.waitForSelector('#wrapup-field', { timeout: 20000 });

      // Signal drops mid-sentence
      await phone.button('Add customer comments');
      await phone.button('Start recording');
      t0 = Date.now();
      await t.sleep(2000);
      await phone.setOffline(true);
      await t.sleep(2000);
      await phone.click('button[aria-label="Done"]');
      const custHeld = (Date.now() - t0) / 1000;
      await t.sleep(3000);
      await phone.setOffline(false);
      const onlineAt = Date.now();

      const field = await checkNote(phone, t, 'field', [{ heldSec: fieldHeld }], null);
      const cust = await checkNote(phone, t, 'customer', [{ heldSec: custHeld, needsFullFile: true }], onlineAt);
      return {
        recoveryMs: cust.recoveryMs,
        recordings: 2,
        checks: [
          { name: 'Connected the whole time: live words kept', ok: field.results[0]?.ok, detail: field.results[0]?.why },
          { name: 'Signal dropped: whole recording written down after upload', ok: cust.results[0]?.ok, detail: cust.results[0]?.why },
          { name: 'Nothing left waiting on the phone', ok: (await phone.waiting()) === 0 },
        ],
      };
    },
  },
  {
    id: 'flaky-signal',
    title: 'Flaky signal through a full job',
    what: 'Signal flips off and on every 3 s while ten stops are taken (the demo limit), then stays on.',
    proves: 'Patchy signal doesn’t lose, double, or reorder stops.',
    async run(phone, t) {
      await phone.launch();
      await phone.startJob();
      let flipping = true;
      const flipper = (async () => {
        while (flipping) {
          await t.sleep(3000);
          if (flipping) await phone.setOffline(!phone.offline);
        }
      })();
      const expected = [];
      for (let i = 0; i < 10; i++) expected.push({ heldSec: await phone.stop({ talkMs: 1500 }) });
      flipping = false;
      await flipper;
      await phone.setOffline(false);
      return t.waitAndCheckStops(phone, expected, Date.now(), { heldOffline: false }); // stops upload in the on-stretches
    },
  },
  {
    id: 'restart-offline',
    title: 'App closed and reopened with no signal',
    what: 'Two stops saved offline, the app is closed, then reopened still offline. Signal returns later.',
    proves: 'Waiting stops survive closing the app, and the app opens with no signal.',
    async run(phone, t) {
      await phone.launch();
      await phone.waitForOfflineCopy();
      await phone.startJob();
      await phone.setOffline(true);
      const expected = [];
      for (let i = 0; i < 2; i++) expected.push({ heldSec: await phone.stop({ talkMs: 2000 }) });
      await t.sleep(1000);
      await phone.page.close();

      await phone.open();
      let opened = false;
      try {
        await phone.page.goto(t.BASE + '/', { waitUntil: 'load', timeout: 15000 });
        await phone.waitText('Saving to', 15000);
        opened = true;
      } catch { /* checked below */ }
      const waiting = opened ? await phone.waiting() : null;
      await phone.setOffline(false);
      const r = await t.waitAndCheckStops(phone, expected, Date.now());
      r.checks.unshift(
        { name: 'Reopened with no signal (job still open)', ok: opened },
        { name: 'Waiting stops still on the phone after reopening', ok: waiting === 2, detail: `${waiting} waiting` },
      );
      return r;
    },
  },
  {
    id: 'open-offline',
    title: 'Opening the app in airplane mode',
    what: 'One visit with signal, then airplane mode; the app is opened fresh.',
    proves: 'The app opens with no signal and has every file it needs, including the PDF tools.',
    async run(phone, t) {
      await phone.launch();
      await phone.waitForOfflineCopy();
      const cached = await phone.page.evaluate(async () => {
        const out = new Set();
        for (const n of await caches.keys()) for (const k of await (await caches.open(n)).keys()) out.add(new URL(k.url).pathname);
        return [...out];
      });
      const missing = t.distFiles.filter((f) => !cached.includes(f));
      await phone.setOffline(true);
      await phone.open();
      let opened = false;
      try {
        await phone.page.goto(t.BASE + '/', { waitUntil: 'load', timeout: 15000 });
        await phone.waitText('Start New Job', 15000);
        opened = true;
      } catch { /* checked below */ }
      const networkOff = await phone.page.evaluate(() => fetch(`/lab-probe-${Date.now()}`).then(() => false, () => true));
      return {
        checks: [
          { name: 'Network really off (page and service worker)', ok: networkOff },
          { name: 'App opens with no signal', ok: opened },
          { name: 'Every app file saved on the phone', ok: !missing.length, detail: missing.length ? `missing ${missing.join(', ')}` : `${t.distFiles.length} files` },
        ],
      };
    },
  },
];

module.exports = { SCENARIOS };
