import {describe, expect, it} from 'vitest'

import {dailyNotePath, vaultLayout} from '../src/core/layout'

const settings = {
  dailyNotesFolder: 'Daily Notes/',
  projectsFolder: 'Projects/Active/',
  archiveFolder: 'Projects/Archive',
  machineNotePath: '',
  inboxHeading: 'Inbox',
  moveTargetHeading: 'Tasks',
  projectTemplatePath: '',
}

describe('vaultLayout', () => {
  it('takes the Daily Notes plugin folder and format while the plugin is on', () => {
    const layout = vaultLayout(settings, {folder: 'Journal/', format: 'YYYY/MM/MM-DD, ddd'})
    expect(layout.dailyNotesFolder).toBe('Journal')
    expect(layout.dailyNoteFormat).toBe('YYYY/MM/MM-DD, ddd')
  })

  it('falls back to the settings folder — for reading and writing alike — when the plugin is off', () => {
    const layout = vaultLayout(settings, null)
    expect(layout.dailyNotesFolder).toBe('Daily Notes')
    expect(layout.dailyNoteFormat).toBe('YYYY-MM-DD')
    expect(dailyNotePath(layout, '2026-09-27')).toBe('Daily Notes/2026-09-27.md')
  })

  it('treats a plugin left at its defaults as the vault root with the default format', () => {
    const layout = vaultLayout(settings, {folder: '', format: ''})
    expect(layout.dailyNotesFolder).toBe('')
    expect(dailyNotePath(layout, '2026-09-27')).toBe('2026-09-27.md')
  })

  it('normalizes folder settings once so every consumer sees the same key', () => {
    const layout = vaultLayout(settings, null)
    expect(layout.projectsFolder).toBe('Projects/Active')
    expect(layout.archiveFolder).toBe('Projects/Archive')
  })

  it('builds a subfolder path from a format that carries one', () => {
    const layout = vaultLayout(settings, {folder: 'Daily Notes', format: 'YYYY/MM/MM-DD, ddd'})
    expect(dailyNotePath(layout, '2026/09/09-27, Sun')).toBe('Daily Notes/2026/09/09-27, Sun.md')
  })
})
