// Builds api/_demoSeedPhotos.js: one JPEG (base64) per photo in api/_demoSeedData.js PHOTOS, for the sandbox demo
// seed to upload to Procore. Each is a simple drawn jobsite scene (an illustration we made, so there are no rights
// questions and no real job sites), with a small "Illustration · SiteSnap demo data" label. A real photo at
// demo-assets/seed/<key>.jpg (or .jpeg / .png) wins. Kept out of public/ on purpose (the service worker precaches it).
// Run: npm run build:seed-photos   (then commit api/_demoSeedPhotos.js)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PHOTOS } from "../api/_demoSeedData.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharp = createRequire(import.meta.url)(path.join(root, "functions", "node_modules", "sharp"));
const assets = path.join(root, "demo-assets", "seed");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Shared bits
const sky = (top = "#9cc3e0", bottom = "#d9e8f2") => `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="1024" height="768" fill="url(#sky)"/>`;
const room = (wall = "#d8d2c6", floor = "#8d877c") => `<rect width="1024" height="768" fill="${wall}"/><polygon points="0,560 1024,560 1024,768 0,768" fill="${floor}"/><line x1="0" y1="560" x2="1024" y2="560" stroke="#6e695f" stroke-width="4"/>`;
const ceiling = () => `<rect width="1024" height="768" fill="#4b4f55"/><rect y="0" width="1024" height="90" fill="#3a3d42"/>${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${i * 180 - 20}" y="10" width="14" height="80" fill="#2c2f33"/>`).join("")}`;
const ring = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#ff3b30" stroke-width="9" stroke-dasharray="26 12"/>`;
const tag = (x, y, text) => `<g><rect x="${x}" y="${y}" width="${text.length * 17 + 36}" height="54" rx="10" fill="#ff3b30"/><text x="${x + 18}" y="${y + 37}" font-size="30" font-weight="800" fill="#fff">${esc(text)}</text></g>`;
const label = `<rect x="0" y="716" width="1024" height="52" fill="#000" fill-opacity=".55"/><text x="24" y="751" font-size="24" fill="#f5efe6">Illustration · SiteSnap demo data · fictional</text>`;

const SCENES = {
  rebar: () => `${sky()}<rect y="430" width="1024" height="338" fill="#a08c6e"/>
    <rect x="80" y="300" width="860" height="300" fill="#8a7a62" stroke="#5e5240" stroke-width="10"/>
    ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => `<line x1="${110 + i * 80}" y1="310" x2="${110 + i * 80}" y2="590" stroke="#7a3e1d" stroke-width="12"/>`).join("")}
    ${[0, 1, 2, 3].map((i) => `<line x1="90" y1="${340 + i * 70}" x2="${i === 2 ? 760 : 930}" y2="${340 + i * 70}" stroke="#8b4a24" stroke-width="12"/>`).join("")}
    <line x1="820" y1="480" x2="930" y2="480" stroke="#8b4a24" stroke-width="12"/>${ring(790, 480, 70)}${tag(620, 600, "No lap splice")}
    <rect x="40" y="200" width="70" height="120" fill="#f2b705"/><text x="52" y="270" font-size="40" font-weight="800" fill="#1f1a14">C</text>`,
  slabedge: () => `${sky("#b9cfe0", "#e8eef2")}<polygon points="0,460 760,420 760,500 0,560" fill="#b9b4aa"/><polygon points="0,560 760,500 760,768 0,768" fill="#7b766d"/>
    ${[60, 220, 380, 540, 700].map((x, i) => `<rect x="${x}" y="${330 - i * 8}" width="14" height="${150 - i * 4}" fill="#f2b705"/>`).join("")}
    <line x1="60" y1="345" x2="380" y2="321" stroke="#f2b705" stroke-width="12"/><line x1="60" y1="405" x2="380" y2="381" stroke="#f2b705" stroke-width="12"/>
    <line x1="540" y1="309" x2="714" y2="296" stroke="#f2b705" stroke-width="12"/>${ring(465, 360, 95)}${tag(380, 520, "Guardrail removed")}
    <rect x="770" y="420" width="254" height="348" fill="#cfd9e2" fill-opacity=".6"/>`,
  cords: () => `${room("#cfc8bb", "#9a948a")}<rect x="380" y="120" width="260" height="440" fill="#b9b2a5" stroke="#8b847a" stroke-width="6"/>
    <path d="M0,640 C200,560 260,720 480,640 S760,560 1024,660" fill="none" stroke="#f26b1d" stroke-width="16"/>
    <path d="M0,690 C180,650 300,760 520,690 S820,620 1024,700" fill="none" stroke="#2b7de9" stroke-width="14"/>
    <rect x="460" y="600" width="90" height="56" rx="8" fill="#333"/>${ring(505, 650, 110)}${tag(60, 470, "Trip hazard")}`,
  conduit: () => `${ceiling()}<rect x="0" y="230" width="1024" height="170" fill="#c7cbd1" stroke="#8a9099" stroke-width="6"/>
    ${[120, 360, 600, 840].map((x) => `<line x1="${x}" y1="230" x2="${x}" y2="400" stroke="#a9aeb6" stroke-width="4"/>`).join("")}
    <text x="40" y="330" font-size="36" font-weight="800" fill="#5b616a">12" SUPPLY DUCT ROUTE</text>
    <line x1="380" y1="90" x2="640" y2="700" stroke="#9aa3ad" stroke-width="26"/><line x1="430" y1="90" x2="690" y2="700" stroke="#9aa3ad" stroke-width="26"/>
    ${ring(540, 320, 120)}${tag(640, 470, "Conduit in duct path")}`,
  hangers: () => `${ceiling()}<rect x="40" y="300" width="944" height="150" fill="#c7cbd1" stroke="#8a9099" stroke-width="6"/>
    ${[110, 470, 900].map((x) => `<line x1="${x}" y1="90" x2="${x}" y2="300" stroke="#d0d4da" stroke-width="8"/><rect x="${x - 40}" y="445" width="80" height="12" fill="#d0d4da"/>`).join("")}
    <line x1="110" y1="520" x2="470" y2="520" stroke="#ffcc00" stroke-width="6"/><text x="200" y="570" font-size="36" font-weight="800" fill="#ffcc00">10 ft (spec 8 ft)</text>
    <line x1="110" y1="500" x2="110" y2="540" stroke="#ffcc00" stroke-width="6"/><line x1="470" y1="500" x2="470" y2="540" stroke="#ffcc00" stroke-width="6"/>${tag(560, 600, "Hanger spacing")}`,
  dust: () => `${room("#e4ded2", "#a49d90")}<rect x="300" y="110" width="420" height="450" fill="#6d675d"/><rect x="330" y="140" width="360" height="420" fill="#8e877b"/>
    ${Array.from({ length: 70 }, (_, i) => `<circle cx="${320 + ((i * 97) % 600)}" cy="${150 + ((i * 53) % 500)}" r="${3 + (i % 5)}" fill="#f4f1ea" fill-opacity=".8"/>`).join("")}
    ${ring(510, 330, 210)}${tag(40, 600, "No containment")}`,
  extinguisher: () => `${room("#d6d0c4", "#8f897e")}<polygon points="600,560 1024,320 1024,560" fill="#b7b0a3"/>${[0, 1, 2, 3, 4].map((i) => `<line x1="${640 + i * 80}" y1="${540 - i * 45}" x2="${1024}" y2="${540 - i * 45}" stroke="#8b847a" stroke-width="6"/>`).join("")}
    <rect x="250" y="200" width="200" height="300" rx="10" fill="#c0392b"/><rect x="270" y="220" width="160" height="260" fill="#f2efe8"/><rect x="330" y="300" width="40" height="18" fill="#555"/>
    <text x="260" y="180" font-size="30" font-weight="800" fill="#c0392b">FIRE EXTINGUISHER</text><text x="780" y="200" font-size="44" font-weight="800" fill="#1f1a14">STAIR 2</text>
    ${ring(350, 360, 150)}${tag(140, 600, "Bracket empty")}`,
  levelfive: () => `<defs><linearGradient id="wall" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#eeeae2"/><stop offset="1" stop-color="#d8d3c8"/></linearGradient></defs>
    <rect width="1024" height="768" fill="url(#wall)"/><polygon points="0,600 1024,600 1024,768 0,768" fill="#9f998e"/>
    <rect x="0" y="0" width="120" height="768" fill="#fff8e1" fill-opacity=".55"/><text x="420" y="300" font-size="44" font-weight="800" fill="#6b665c">LEVEL 5 · EAST WALL</text>
    <g><rect x="380" y="380" width="380" height="54" rx="10" fill="#30a14e"/><text x="398" y="417" font-size="30" font-weight="800" fill="#fff">Ready for paint check</text></g>`,
  texture: () => `${room("#e2dcd0", "#9a948a")}<rect x="600" y="120" width="240" height="440" fill="#7b5a3c" stroke="#5e4430" stroke-width="8"/><circle cx="810" cy="350" r="12" fill="#d4af37"/>
    <rect x="390" y="230" width="170" height="190" fill="#ece7dc"/>${Array.from({ length: 40 }, (_, i) => `<circle cx="${80 + ((i * 131) % 480)}" cy="${120 + ((i * 71) % 420)}" r="5" fill="#cfc8bb"/>`).join("")}
    ${ring(475, 325, 135)}${tag(120, 600, "Texture mismatch")}`,
  paint: () => `${room("#b9cfc4", "#8f897e")}<ellipse cx="520" cy="320" rx="130" ry="90" fill="#e9e5dc"/>
    <text x="40" y="90" font-size="40" font-weight="800" fill="#3d5348">OFFICE 101 · NORTH WALL</text>${ring(520, 320, 165)}${tag(560, 520, "Paint holiday")}`,
  camera: () => `${room("#d9d3c7", "#8f897e")}<rect y="0" width="1024" height="70" fill="#f1efe9"/>
    <rect x="470" y="250" width="40" height="70" fill="#e5e5e5"/><ellipse cx="490" cy="345" rx="70" ry="45" fill="#2b2b2b"/><circle cx="490" cy="350" r="20" fill="#5a7da8"/>
    <line x1="660" y1="70" x2="660" y2="300" stroke="#ffcc00" stroke-width="6"/><text x="680" y="190" font-size="34" font-weight="800" fill="#1f1a14">1 ft low</text>
    <line x1="420" y1="160" x2="560" y2="160" stroke="#30a14e" stroke-width="6" stroke-dasharray="14 8"/><text x="380" y="140" font-size="26" fill="#30a14e">drawing height</text>
    ${ring(490, 330, 110)}${tag(120, 600, "Mounting height off")}`,
  pallets: () => `${room("#cbc4b6", "#8a847a")}<rect x="620" y="110" width="300" height="450" fill="#5c6670"/><text x="660" y="90" font-size="34" font-weight="800" fill="#1f1a14">DOOR B</text>
    ${[0, 1].map((p) => `<rect x="${110 + p * 230}" y="510" width="210" height="34" fill="#a7743f"/>${[0, 1, 2].map((c) => [0, 1].map((r) => `<rect x="${120 + p * 230 + c * 66}" y="${430 - r * 80}" width="58" height="80" rx="6" fill="#f2f0ea" stroke="#9a9488" stroke-width="3"/>`).join("")).join("")}`).join("")}
    ${tag(110, 280, "Should be at Door A")}`,
};

function svgFor(key) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768" font-family="Segoe UI, Arial, sans-serif">${SCENES[key]()}${label}</svg>`;
}

const out = {};
const used = [];
for (const key of Object.keys(PHOTOS)) {
  if (!SCENES[key]) throw new Error(`No scene for photo ${key}`);
  const real = ["jpg", "jpeg", "png"].map((e) => path.join(assets, `${key}.${e}`)).find((f) => fs.existsSync(f));
  const buf = real
    ? await sharp(real).rotate().resize(1280, 1280, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer()
    : await sharp(Buffer.from(svgFor(key))).jpeg({ quality: 70 }).toBuffer();
  out[key] = buf.toString("base64");
  used.push(`${key}: ${real ? path.basename(real) : "illustration"} (${Math.round(buf.length / 1024)} KB)`);
  if (process.argv.includes("--preview")) fs.writeFileSync(path.join(process.argv[process.argv.indexOf("--preview") + 1], `${key}.jpg`), buf);
}
fs.writeFileSync(path.join(root, "api", "_demoSeedPhotos.js"), `// Generated by scripts/build-seed-photos.mjs: one JPEG (base64) per sandbox demo seed photo. Don't edit by hand.
// ${used.join("; ")}
export const SEED_PHOTOS = ${JSON.stringify(out, null, 1)};
`);
console.log(used.join("\n"));
