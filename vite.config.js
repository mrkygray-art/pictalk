import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

// After a build, write this build's id and full file list into dist/sw.js, so the
// service worker saves the whole app (lazy-loaded PDF tools too) for offline use.
function pictalkOfflineFiles() {
  let outDir
  const walk = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((f) =>
      f.isDirectory() ? walk(join(dir, f.name)) : [join(dir, f.name)])
  return {
    name: 'pictalk-offline-files',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const files = walk(outDir)
        .map((p) => '/' + relative(outDir, p).split(sep).join('/'))
        .filter((f) => f !== '/sw.js')
        .sort()
      const hash = createHash('sha256')
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)))
      const swPath = join(outDir, 'sw.js')
      const sw = readFileSync(swPath, 'utf8')
      const out = sw
        .replace("const BUILD = 'dev';", `const BUILD = '${hash.digest('hex').slice(0, 12)}';`)
        .replace('const FILES = [];', `const FILES = ${JSON.stringify(files)};`)
      if (out === sw || out.includes("BUILD = 'dev'") || out.includes('FILES = [];')) {
        throw new Error('pictalk-offline-files: placeholders not found in sw.js')
      }
      writeFileSync(swPath, out)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), pictalkOfflineFiles()],
})
