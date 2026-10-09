#!/usr/bin/env node
/**
 * build:single — vite se single-file build karke ek hi HTML file banata hai:
 *   webapp/showroom-manager-app.html
 *
 * Us file ko kisi bhi browser me khol sakte hain (file:// bhi), WhatsApp par bhej sakte hain,
 * ya kisi bhi static hosting par daal sakte hain.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const webappDir = resolve(here, '..')
const outDir = join(webappDir, 'singlefile-dist')
const target = join(webappDir, 'showroom-manager-app.html')

console.log('🔨 Single-file build ban raha hai…')

const res = spawnSync('npm', ['exec', '--', 'vite', 'build', '--config', 'vite.config.singlefile.ts'], {
  cwd: webappDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (res.status !== 0) {
  console.error('❌ vite build fail ho gaya')
  process.exit(res.status ?? 1)
}

const htmlPath = join(outDir, 'index.html')
if (!existsSync(htmlPath)) {
  console.error('❌ build output nahi mila:', htmlPath)
  process.exit(1)
}

const html = readFileSync(htmlPath, 'utf8')
const js = readFileSync(join(outDir, 'app.js'), 'utf8').replace(/<\/script/gi, '<\\/script')
const cssFile = readdirSync(outDir).find((f) => f.endsWith('.css'))
const css = cssFile ? readFileSync(join(outDir, cssFile), 'utf8') : ''

// NOTE: replacer FUNCTION use karna zaroori hai — bundle me "$&" jaise sequences hote hain
// jo string-replacement me galat insert kar dete hain.
let out = html
  .replace(/<script[^>]*src="[^"]*app\.js"[^>]*><\/script>/, () => `<script type="module">\n${js}\n</script>`)
  // sirf apna app.css inline karein (Google Fonts wala link waise hi rehne dein)
  .replace(/<link[^>]*href="\.\/app\.css"[^>]*>/, () => (css ? `<style>\n${css}\n</style>` : ''))

// boot splash hata dein (single file me pehle hi instant load hota hai)
out = out.replace(/<div id="boot">[\s\S]*?<\/div>\s*(?=<div id="root")/, '')

writeFileSync(target, out, 'utf8')

const leftovers = (out.match(/<script[^>]*src="\.\/app\.js"/g) ?? []).length
const cssLeft = (out.match(/rel="stylesheet"[^>]*href="\.\/app\.css"/g) ?? []).length
if (leftovers || cssLeft) {
  console.error(`❌ Inline karne me dikkat: ${leftovers} script aur ${cssLeft} css tag bache hain`)
  process.exit(1)
}

const sizeKb = Math.round(Buffer.byteLength(out) / 1024)
console.log(`✅ Ban gaya: ${target}  (${sizeKb} KB)`)
console.log('   Is file ko browser me khol dein — server ki zarurat nahi.')

rmSync(outDir, { recursive: true, force: true })
