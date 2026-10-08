// Run after `vite build --mode devcloud`: refuse to continue unless dist/ points at the
// Piccolo test project only. Stops a production-configured build from reaching the test
// site (or the other way round).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DEV = "pictalk-dev-52368";
const LIVE = "pictalk-6cbff";
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(js|html)$/.test(name)) files.push(path);
  }
};
walk("dist");
const text = files.map((f) => readFileSync(f, "utf8")).join("\n");
if (text.includes(LIVE)) {
  console.error(`dist/ mentions the live project (${LIVE}). Not deploying it to the test project.`);
  process.exit(1);
}
if (!text.includes(DEV)) {
  console.error(`dist/ doesn't use the test project (${DEV}). Build with --mode devcloud.`);
  process.exit(1);
}
console.log(`dist/ uses the test project ${DEV}.`);
