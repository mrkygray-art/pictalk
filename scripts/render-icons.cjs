// Renders public/favicon.svg to the PNG app icons (192, 512, and a maskable 512 with the
// camera shrunk into Android's safe circle). Run: node scripts/render-icons.cjs
const path = require('path');
const fs = require('fs');
const sharp = require(path.join(__dirname, '..', 'functions', 'node_modules', 'sharp'));

const pub = path.join(__dirname, '..', 'public');
const svg = fs.readFileSync(path.join(pub, 'favicon.svg'), 'utf8');

// Maskable: full-bleed black square, artwork at 76% so nothing is cut off by the mask
const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<rect width="512" height="512" rx="96" fill="#000"\/>/, '');
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#000"/><g transform="translate(256 256) scale(0.76) translate(-256 -256)">${inner}</g></svg>`;

(async () => {
  await sharp(Buffer.from(svg)).resize(192, 192).png().toFile(path.join(pub, 'icon-192.png'));
  await sharp(Buffer.from(svg)).resize(512, 512).png().toFile(path.join(pub, 'icon-512.png'));
  await sharp(Buffer.from(maskable)).resize(512, 512).png().toFile(path.join(pub, 'icon-maskable-512.png'));
  console.log('icons written');
})();
