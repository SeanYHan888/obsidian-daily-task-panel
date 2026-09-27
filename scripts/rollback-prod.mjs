// Restores the previous production deploy (the *.prev copies that
// scripts/deploy-prod.mjs leaves next to the live files). Run via
// `npm run rollback:prod`. One level of undo: a second rollback is a no-op.
import fs from 'fs'
import path from 'path'
import process from 'process'

const DEPLOYED_FILES = ['main.js', 'manifest.json', 'styles.css']
const BUILD_INFO = '.build-info'
const dir =
  process.env.DTP_PROD_PLUGIN_DIR ??
  path.join(
    process.env.HOME,
    'Library/Mobile Documents/iCloud~md~obsidian/Documents/obsidian-vault/.obsidian/plugins/daily-task-panel',
  )

if (!fs.existsSync(path.join(dir, 'main.js.prev'))) {
  console.error(`nothing to roll back to in ${dir}: no main.js.prev (only one level of undo is kept)`)
  process.exit(1)
}

for (const file of DEPLOYED_FILES) {
  const prev = path.join(dir, `${file}.prev`)
  if (fs.existsSync(prev)) fs.renameSync(prev, path.join(dir, file))
}

// The current .build-info describes the build we just removed. Restore the
// previous one if it was recorded, otherwise drop it rather than mislead.
const infoPath = path.join(dir, BUILD_INFO)
let label = 'previous build (no build info recorded for it)'
if (fs.existsSync(`${infoPath}.prev`)) {
  fs.renameSync(`${infoPath}.prev`, infoPath)
  const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'))
  label = `${info.version} (${info.commit}, deployed ${info.deployedAt})`
} else {
  fs.rmSync(infoPath, {force: true})
}
console.log(`rolled back to ${label} → ${dir}`)
console.log(
  `reload Obsidian to pick it up:\n  obsidian eval code="app.plugins.disablePlugin('daily-task-panel').then(()=>app.plugins.enablePlugin('daily-task-panel'))"`,
)
