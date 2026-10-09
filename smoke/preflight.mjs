#!/usr/bin/env node
/**
 * Preflight check for the smoke test.
 * Sabse common problem: webapp folder me `npm install` nahi chalaya gaya ho,
 * ya script repo root se chala diya gaya ho. Us case me:
 *   - saaf-saaf error batate hain
 *   - aur (default) zaroori packages KHUD install kar dete hain, taaki ek command se kaam ho jaye
 *
 * Auto-install band karna ho to:  SMOKE_NO_INSTALL=1 npm run smoke
 */
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const webappDir = resolve(here, '..')
const require = createRequire(import.meta.url)

const required = ['esbuild', 'jsdom', 'fake-indexeddb']
const missing = []
for (const mod of required) {
  try {
    require.resolve(mod)
  } catch {
    missing.push(mod)
  }
}

const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < 20) {
  console.error(`\n❌ Node ${process.versions.node} mila — smoke test ke liye Node 20+ chahiye (Node 22 recommended).`)
  console.error('   Node 22 install karein: https://nodejs.org  (ya  nvm install 22 && nvm use 22)\n')
  process.exit(1)
}

const install = () => {
  console.log('📦 Zaroori packages install kar rahe hain (npm install)… thoda ruk jayein')
  const res = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
    cwd: webappDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  })
  return res.status === 0
}

if (missing.length) {
  if (process.env.SMOKE_NO_INSTALL === '1') {
    console.error('\n❌ Smoke test ke liye zaroori packages nahi mile:', missing.join(', '))
    console.error('\nIse aise theek karein:\n')
    console.error('   cd webapp && npm install && npm run smoke')
    console.error('   (ya repo root se:  npm install --prefix webapp  phir  npm run smoke)\n')
    process.exit(1)
  }
  const ok = install()
  if (!ok) {
    console.error('\n❌ npm install fail ho gaya (internet/proxy check karein).')
    console.error('   Manual:  cd webapp && npm install\n')
    process.exit(1)
  }
  const stillMissing = required.filter((m) => {
    try {
      require.resolve(m)
      return false
    } catch {
      return true
    }
  })
  if (stillMissing.length) {
    console.error('\n❌ Install ke baad bhi nahi mile:', stillMissing.join(', '))
    console.error('   Manual:  cd webapp && npm install\n')
    process.exit(1)
  }
  console.log('✅ Install ho gaya\n')
}

console.log(`  (node ${process.versions.node} • packages theek hain)`)
