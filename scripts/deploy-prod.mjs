// Copies a production build into Sean's live vault. The ONLY path by which
// the live vault receives Daily Task Panel builds — dev watch builds go to the dev
// vault (see esbuild.config.mjs). Run via `npm run deploy:prod`.
//
// Guards (bypass with `npm run deploy:prod -- --force`):
//   - must be on the production branch (default `main`, env DTP_PROD_BRANCH)
//   - working tree must be clean
// Then: npm test → npm run lint → npm run build → back up the current vault
// files as *.prev → copy → write .build-info → print the reload command.
// Undo with `npm run rollback:prod`.
import fs from 'fs'
import path from 'path'
import process from 'process'
import {execSync} from 'child_process'

const DEPLOYED_FILES = ['main.js', 'manifest.json', 'styles.css']
const BUILD_INFO = '.build-info'
const dir =
  process.env.DTP_PROD_PLUGIN_DIR ??
  path.join(
    process.env.HOME,
    'Library/Mobile Documents/iCloud~md~obsidian/Documents/obsidian-vault/.obsidian/plugins/daily-task-panel',
  )

const git = (args) => execSync(`git ${args}`, {encoding: 'utf8'}).trim()
const run = (cmd) => {
  console.log(`\n$ ${cmd}`)
  execSync(cmd, {stdio: 'inherit'})
}

const force = process.argv.includes('--force')
const prodBranch = process.env.DTP_PROD_BRANCH ?? 'main'
const branch = git('rev-parse --abbrev-ref HEAD')
const dirty = git('status --porcelain') !== ''

const problems = []
if (branch !== prodBranch) problems.push(`on branch "${branch}", production deploys come from "${prodBranch}"`)
if (dirty) problems.push('working tree has uncommitted changes')
if (problems.length) {
  for (const p of problems) console.error(`${force ? 'warning' : 'refusing to deploy'}: ${p}`)
  if (!force) {
    console.error('pass --force to deploy anyway: npm run deploy:prod -- --force')
    process.exit(1)
  }
}

run('npm test')
run('npm run lint')
run('npm run build')

if (!fs.existsSync('main.js')) {
  console.error('main.js not found after build')
  process.exit(1)
}

fs.mkdirSync(dir, {recursive: true})

// Keep the previous deploy so `npm run rollback:prod` is one command.
for (const file of [...DEPLOYED_FILES, BUILD_INFO]) {
  const current = path.join(dir, file)
  if (fs.existsSync(current)) fs.copyFileSync(current, `${current}.prev`)
}

for (const file of DEPLOYED_FILES) {
  fs.copyFileSync(file, path.join(dir, file))
}

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'))
const info = {
  version: manifest.version,
  commit: git('rev-parse --short HEAD'),
  branch,
  dirty,
  deployedAt: new Date().toISOString(),
}
fs.writeFileSync(path.join(dir, BUILD_INFO), JSON.stringify(info, null, 2) + '\n')

console.log(`\ndeployed ${info.version} (${info.commit}${dirty ? ', dirty' : ''}) → ${dir}`)
console.log('reload Obsidian to pick it up. `obsidian plugin:reload` can keep the old module running;')
console.log('the reliable hard cycle is:')
console.log(`  obsidian eval code="app.plugins.disablePlugin('daily-task-panel').then(()=>app.plugins.enablePlugin('daily-task-panel'))"`)

// The plugin was called Taskflow (id `taskflow`) until 2026-09-27. Its old
// folder keeps running beside the new one until it is removed by hand. The
// new plugin copies its settings on first enable, so the order matters.
const legacyDir = path.join(path.dirname(dir), 'taskflow')
if (fs.existsSync(path.join(legacyDir, 'manifest.json'))) {
  const legacy = JSON.parse(fs.readFileSync(path.join(legacyDir, 'manifest.json'), 'utf8'))
  if (legacy.author === manifest.author) {
    console.log(`\nthe pre-rename Taskflow plugin is still installed at ${legacyDir}`)
    console.log('1. enable Daily Task Panel in Settings → Community plugins (it copies Taskflow\'s settings once)')
    console.log('2. then disable Taskflow and delete that folder; rebind any hotkeys you had set on its commands')
  }
}
