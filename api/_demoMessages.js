// Sample messages for the guest demo (docs/guest-demo.md), so every feed tab has something to show the demo guest:
// For Me (the guest is in To), CC (the guest is CC'd), Sent (the guest started it) and All Project (everyone else's).
// Loaded and removed from /admin/demo-authorize (owner only). People are the demo staging people
// (api/_demoScenarios.js DEMO_PEOPLE), looked up in each project's Procore directory with the guest's sign-in (by
// email, else by full name: a view-only guest gets Procore's short directory, which has no emails), so their
// Procore ids match the real directory; a thread whose people aren't on the project is skipped.
// Threads: procoreProjects/{key}/conversations/sample-{id} (sample: true), messages sample-{id}-{n}. Each message
// goes through the app's own onConversationMessage function like a real one (feed card, to-dos for the people in
// To), so they're written oldest first, a moment apart, with times from the last half hour.
import { DEMO_PEOPLE, fullName } from "./_demoScenarios.js";
import { firestore } from "./_firestore.js";
import { getWithToken, guestAuthInfo, guestTokens } from "./_demo.js";

const G = "guest";
// [who, text, minutes ago, quick reply code?]; who is a DEMO_PEOPLE key or G
export const SAMPLE_THREADS = {
  HP: [
    { id: "hp-forme-1", from: "marcus", to: [G], cc: ["dana"], msgs: [
      ["marcus", "Can you check the pour log for the east footings? Pacific Structural needs the batch tickets before Tom signs off on Thursday.", 28],
    ] },
    { id: "hp-forme-2", from: "dana", to: [G, "luis"], msgs: [
      ["dana", "Rebar delivery moved to 7 AM tomorrow. Luis, please have the crew ready to unload at the north gate. Guest, keep an eye on the gate log.", 24],
      ["luis", "Crew will be there at 6:45.", 22, "on_it"],
    ] },
    { id: "hp-cc-1", from: "tom", to: ["marcus"], cc: [G, "dana"], msgs: [
      ["tom", "Special inspection on grid lines A through C passed. Grid D needs two more stirrups before I can sign it.", 20],
      ["marcus", "Luis is adding them this afternoon. I'll send photos when they're tied.", 18, "on_it"],
    ] },
    { id: "hp-sent-1", from: G, to: ["alicia"], msgs: [
      [G, "Is the temporary power pole at the trailer ready for the inspector this week?", 15],
      ["alicia", "Yes, inspection is set for Wednesday at 10. I'll be on site.", 12, "done"],
    ] },
    { id: "hp-all-1", from: "jenna", to: ["marcus"], msgs: [
      ["jenna", "The conduit stub-ups for the gate card readers are in the wrong spot on the slab drawing. Can we walk it before the pour?", 10],
      ["marcus", "Meet me at the gate at 2.", 8],
    ] },
  ],
  WG: [
    { id: "wg-forme-1", from: "dana", to: [G], cc: ["hannah"], msgs: [
      ["dana", "Hannah asked for an updated look-ahead for the dock doors. Can you pull the next two weeks from the schedule and send it to her?", 27],
    ] },
    { id: "wg-forme-2", from: "carlos", to: [G, "marcus"], msgs: [
      ["carlos", "We're held up on the north office wall. Sprinkler mains are still not in above the ceiling line, so we can't board it.", 23, "delayed"],
    ] },
    { id: "wg-cc-1", from: "ray", to: ["alicia"], cc: [G], msgs: [
      ["ray", "My sprinkler main and your cable tray are fighting for the same space at grid 14. Who moves?", 21],
      ["alicia", "We can drop the tray 6 inches. I'll mark it up tomorrow morning.", 19, "on_it"],
    ] },
    { id: "wg-cc-2", from: "hannah", to: ["dana"], cc: [G, "marcus"], msgs: [
      ["hannah", "Our racking vendor wants to start the week of the 3rd. Is the slab sealer cured by then?", 16],
    ] },
    { id: "wg-sent-1", from: G, to: ["jenna"], msgs: [
      [G, "Do you have the camera layout for the loading dock yet? The owner wants to see coverage of every door.", 14],
      ["jenna", "Sending the marked-up drawing this afternoon.", 11, "on_it"],
    ] },
    { id: "wg-all-1", from: "marcus", to: ["ray", "carlos"], msgs: [
      ["marcus", "Ceiling inspection for the office area is Friday. Everything above the ceiling has to be done by Thursday night.", 9],
      ["ray", "Sprinkler heads will be in Wednesday.", 7, "on_it"],
    ] },
  ],
  LV: [
    { id: "lv-forme-1", from: "priya", to: [G], cc: ["dana"], msgs: [
      ["priya", "Punch walk with the district is Monday at 9. Can you make sure the room list for the B wing is up to date?", 29],
    ] },
    { id: "lv-forme-2", from: "alan", to: [G, "priya"], msgs: [
      ["alan", "The library smoke detector is still beeping. Teachers move back in next week, so this has to be fixed first.", 25],
      ["priya", "Alicia is on it today.", 23],
    ] },
    { id: "lv-cc-1", from: "nikki", to: ["priya"], cc: [G], msgs: [
      ["nikki", "Touch-up paint in rooms 104 to 110 is done. Room 111 still has the wall patch drying.", 20, "done"],
    ] },
    { id: "lv-sent-1", from: G, to: ["ray"], msgs: [
      [G, "The drinking fountain in the B wing hallway has low pressure. Can you take a look before the punch walk?", 17],
      ["ray", "Found a partly closed stop valve. Fixed and tested.", 13, "done"],
    ] },
    { id: "lv-all-1", from: "jenna", to: ["priya", "alan"], msgs: [
      ["jenna", "Door access training for the office staff is set for Tuesday at 3 in the main office.", 10],
      ["alan", "Thanks, I'll let the principal know.", 6],
    ] },
  ],
};

const REPLY_LABEL = { done: "Marked done", on_it: "On it", delayed: "Delayed", need_info: "Needs info" };

// "HP:373715,WG:373716,…" → { "373715": "HP", … } (the codes from demo staging)
export function projectCodes(env = process.env) {
  const out = {};
  for (const part of String(env.DEMO_PROJECT_IDS ?? "").split(",")) {
    const [code, id] = part.split(":").map((x) => x?.trim());
    if (code && /^\d+$/.test(id ?? "")) out[id] = code.toUpperCase();
  }
  return out;
}

let wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const setWait = (fn) => { wait = fn; };

const norm = (v) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

// The project's people, findable by email or by full name
async function directory(cfg, at, p) {
  const users = await getWithToken(cfg, at, `/rest/v1.0/projects/${p.projectId}/users`, { companyId: p.companyId, query: { per_page: 300 } });
  const found = new Map();
  for (const u of Array.isArray(users) ? users : []) {
    const name = u.name || [u.first_name, u.last_name].filter(Boolean).join(" ");
    const person = { procoreUserId: String(u.id), name, company: u.vendor?.name ?? "", title: u.job_title ?? "" };
    if (u.email_address) found.set(norm(u.email_address), person);
    if (name) found.set(`name:${norm(name)}`, person);
  }
  return found;
}

const threadsCol = (db, key) => db.collection(`procoreProjects/${key}/conversations`);

async function removeIn(db, key) {
  const docs = (await threadsCol(db, key).where("sample", "==", true).get()).docs;
  const members = (await db.collection(`procoreProjects/${key}/members`).get()).docs;
  for (const d of docs) {
    const refs = [...(await d.ref.collection("messages").get()).docs.map((m) => m.ref), ...members.map((m) => m.ref.collection("reads").doc(d.id)), d.ref];
    for (let i = 0; i < refs.length; i += 400) {
      const b = db.batch();
      refs.slice(i, i + 400).forEach((r) => b.delete(r));
      await b.commit();
    }
  }
  return docs.length;
}

/** Removes every sample thread from the demo projects. Returns how many. */
export async function removeSampleMessages() {
  const info = await guestAuthInfo();
  const db = await firestore();
  let n = 0;
  for (const p of info?.projects ?? []) n += await removeIn(db, `${p.companyId}_${p.projectId}`);
  return n;
}

/** Loads the sample threads into each demo project (replacing earlier samples). Returns { threads, skipped }. */
export async function loadSampleMessages(cfg) {
  const info = await guestAuthInfo();
  if (!info?.hasTokens) throw new Error("Authorize the guest first.");
  const { at, guestUserId } = await guestTokens(cfg);
  const codes = projectCodes();
  const db = await firestore();
  const guest = { procoreUserId: String(guestUserId), name: "Guest", company: "", title: "" };
  let threads = 0;
  const skipped = [];
  for (const p of info.projects ?? []) {
    const key = `${p.companyId}_${p.projectId}`;
    const list = SAMPLE_THREADS[codes[String(p.projectId)]];
    if (!list) continue;
    await removeIn(db, key);
    const dir = await directory(cfg, at, p);
    const who = (k) => (k === G ? guest : (() => { const d = DEMO_PEOPLE.find((x) => x.key === k); return d ? dir.get(norm(d.email_address)) ?? dir.get(`name:${norm(fullName(d))}`) ?? null : null; })());
    for (const t of list) {
      const people = [t.from, ...t.to, ...(t.cc ?? []), ...t.msgs.map((m) => m[0])].map(who);
      if (people.some((x) => !x)) {
        const missing = [t.from, ...t.to, ...(t.cc ?? [])].filter((k) => !who(k)).map((k) => fullName(DEMO_PEOPLE.find((x) => x.key === k)));
        skipped.push(`${p.name}: ${t.id} (not on the project: ${[...new Set(missing)].join(", ")})`);
        continue;
      }
      const tagged = t.to.map(who);
      const cc = (t.cc ?? []).map(who);
      const start = Date.now() - t.msgs[0][2] * 60_000;
      const ref = threadsCol(db, key).doc(`sample-${t.id}`);
      await ref.set({
        createdBy: who(t.from), tagged, taggedIds: tagged.map((x) => x.procoreUserId), cc, ccIds: cc.map((x) => x.procoreUserId),
        status: "open", createdAt: start, lastActivityAt: start, sample: true,
      });
      for (const [i, [k, text, ago, code]] of t.msgs.entries()) {
        const a = who(k);
        const at2 = Date.now() - ago * 60_000;
        await ref.collection("messages").doc(`sample-${t.id}-${i + 1}`).set({
          authorId: a.procoreUserId, authorName: a.name, text, transcript: "", transcriptStatus: "none", photos: [],
          voicePath: null, voiceType: null, aiDescription: null, clientCreatedAt: at2, createdAt: at2,
          ...(code ? { status: { code, label: REPLY_LABEL[code] ?? code } } : {}),
        });
        await wait(400); // oldest first, so the message function sees them in order
      }
      threads++;
    }
  }
  return { threads, skipped };
}
