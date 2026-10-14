// Runs before `npm test` (the "pretest" script). Emulators from an earlier run can take a few
// seconds to let go of their ports after they're stopped; starting new ones too soon fails every
// test at once. Waits until the Firebase emulator ports are free (up to 30 s), then lets the tests start.
import net from "node:net";

// Firebase's default emulator ports (firebase.json doesn't override them): hub, logging,
// Firestore websocket, auth, firestore, storage, functions
const PORTS = [4400, 4500, 9150, 9099, 8080, 9199, 5001];
const LIMIT_MS = 30000;

const free = (port) => new Promise((resolve) => {
  const s = net.createServer();
  s.once("error", () => resolve(false));
  s.once("listening", () => s.close(() => resolve(true)));
  s.listen(port, "127.0.0.1");
});

const start = Date.now();
let busy = PORTS;
while (Date.now() - start < LIMIT_MS) {
  busy = [];
  for (const p of PORTS) if (!(await free(p))) busy.push(p);
  if (!busy.length) process.exit(0);
  if (Date.now() - start < 1000) console.log(`Waiting for emulator ports to free up: ${busy.join(", ")}`);
  await new Promise((r) => setTimeout(r, 1000));
}
console.error(`Emulator ports still in use after ${LIMIT_MS / 1000} s: ${busy.join(", ")}. Stop the running emulators (or whatever holds these ports) and try again.`);
process.exit(1);
