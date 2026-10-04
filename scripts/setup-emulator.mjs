// One-time local setup for the Firebase emulators: creates the two git-ignored
// files the Functions emulator reads, with dummy keys and the free stand-ins on.
// Run with `npm run setup:emulator`. Never overwrites a file that already exists.
import { copyFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

const files = [
  ['functions/.secret.local.example', 'functions/.secret.local'],
  ['functions/.env.local.example', 'functions/.env.local'],
]
for (const [from, to] of files) {
  if (existsSync(to)) console.log(`kept     ${to} (already exists)`)
  else { copyFileSync(from, to); console.log(`created  ${to}`) }
}

if (!existsSync('functions/node_modules')) {
  console.log('installing functions dependencies…')
  execSync('npm install', { cwd: 'functions', stdio: 'inherit' })
}

try { execSync('java -version', { stdio: 'ignore' }) }
catch { console.log('\nNote: the emulators need Java 11+ (https://adoptium.net).') }

console.log(`
Next, in two terminals:
  firebase emulators:start --only auth,firestore,storage,functions
  npm run dev:emulators
Emulator UI: http://127.0.0.1:4000`)
