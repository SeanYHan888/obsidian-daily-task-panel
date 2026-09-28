import {assert, test} from 'vitest'

import {isOwnLegacyData, migrateSettings} from '../src/settings-migration'

const taskflowData = {
  dailyNotesFolder: 'Daily Notes',
  projectsFolder: 'Projects/Active',
  inboxHeading: 'Inbox',
  moveTargetHeading: 'Tasks',
  pacingMode: 'hybrid' as const,
  collapsedProjects: {'Projects/Active/colm-paper.md': true},
}

test("the old Taskflow data.json is recognised as this plugin's own", () => {
  assert.isTrue(isOwnLegacyData(taskflowData))
})

test('the unrelated TaskFlow plugin, which shares the old id, is never mistaken for ours', () => {
  assert.isFalse(isOwnLegacyData({tabs: [{label: 'Today', query: 'due today'}], language: 'en'}))
  assert.isFalse(isOwnLegacyData({projectsFolder: 'Projects'}))
  assert.isFalse(isOwnLegacyData({...taskflowData, inboxHeading: 3}))
  assert.isFalse(isOwnLegacyData(null))
  assert.isFalse(isOwnLegacyData([]))
  assert.isFalse(isOwnLegacyData('Projects/Active'))
})

test('settings pass through unchanged when there is nothing to migrate', () => {
  assert.deepEqual(migrateSettings(taskflowData), taskflowData)
})

test('the Apple-specific key becomes the machine-managed note and is dropped', () => {
  assert.deepEqual(migrateSettings({projectsFolder: 'P', appleSyncPath: 'Sync/Apple.md'}), {
    projectsFolder: 'P',
    machineNotePath: 'Sync/Apple.md',
  })
})

test('a machine-managed note already set wins over the old key', () => {
  assert.deepEqual(migrateSettings({machineNotePath: 'Sync/New.md', appleSyncPath: 'Sync/Old.md'}), {
    machineNotePath: 'Sync/New.md',
  })
})

test('nothing stored reads as no settings', () => {
  assert.deepEqual(migrateSettings(null), {})
  assert.deepEqual(migrateSettings(undefined), {})
  assert.deepEqual(migrateSettings('corrupt'), {})
})

test('a collapse toggle stored for the retired Inbox section is dropped', () => {
  const migrated = migrateSettings({collapsed: {inbox: true, upcoming: false}})
  assert.deepEqual(migrated.collapsed, {upcoming: false})
})
