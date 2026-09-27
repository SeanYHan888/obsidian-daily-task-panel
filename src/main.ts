import {Notice, Plugin, normalizePath} from 'obsidian'

import {undoEntry} from './adapters/undo'
import {DEFAULT_SETTINGS, PanelSettingTab} from './settings'
import {LEGACY_PLUGIN_ID, isOwnLegacyData, migrateSettings} from './settings-migration'
import {VIEW_TYPE, PanelView} from './view'

import type {JournalEntry} from './core/journal'
import type {PanelSettings} from './settings'

const JOURNAL_DEPTH = 50

export default class DailyTaskPanelPlugin extends Plugin {
  settings: PanelSettings = {...DEFAULT_SETTINGS}
  /** Session undo journal (ADR-0001): a log of edits, in memory only. */
  private journal: JournalEntry[] = []

  async onload(): Promise<void> {
    await this.loadSettings()

    this.registerView(VIEW_TYPE, leaf => new PanelView(leaf, this))
    this.addSettingTab(new PanelSettingTab(this.app, this))
    this.addRibbonIcon('list-checks', 'Open Daily Task Panel', () => void this.activateView())
    this.addCommand({
      id: 'open-panel',
      name: 'Open panel',
      callback: () => void this.activateView(),
    })
    this.addCommand({
      id: 'undo-last-panel-action',
      name: 'Undo last panel action',
      callback: () => void this.undo(),
    })

    this.app.workspace.onLayoutReady(() => void this.activateView(false))
  }

  /**
   * Stored settings, migrated to the current shape (settings-migration.ts).
   * With nothing stored yet, the pre-rename Taskflow folder is read once and
   * its settings are saved under the new id straight away, so the carry-over
   * happens exactly once and survives removing the old plugin.
   */
  private async loadSettings(): Promise<void> {
    const stored: unknown = await this.loadData()
    const legacy = stored == null ? await this.readLegacyData() : null
    this.settings = {...DEFAULT_SETTINGS, ...migrateSettings(stored ?? legacy)}
    if (legacy != null) {
      await this.saveData(this.settings)
      new Notice(
        'Daily Task Panel: settings carried over from Taskflow. You can disable and remove the old Taskflow plugin.',
        12000,
      )
    }
  }

  /** The old plugin folder's data.json, when it exists and is recognisably ours. */
  private async readLegacyData(): Promise<unknown> {
    const path = normalizePath(`${this.app.vault.configDir}/plugins/${LEGACY_PLUGIN_ID}/data.json`)
    try {
      if (!(await this.app.vault.adapter.exists(path))) return null
      const raw: unknown = JSON.parse(await this.app.vault.adapter.read(path))
      return isOwnLegacyData(raw) ? raw : null
    } catch {
      return null
    }
  }

  pushJournal(entry: JournalEntry): void {
    this.journal.push(entry)
    if (this.journal.length > JOURNAL_DEPTH) this.journal.shift()
  }

  /** Undoes the given entry (an undo notice's own action), or the latest one. */
  async undo(entry?: JournalEntry): Promise<void> {
    const target = entry ?? this.journal[this.journal.length - 1]
    if (!target) {
      new Notice('Daily Task Panel: nothing to undo')
      return
    }
    const index = this.journal.lastIndexOf(target)
    if (index === -1) {
      new Notice('Daily Task Panel: that action was already undone')
      return
    }
    this.journal.splice(index, 1)
    const {stale} = await undoEntry(this.app, target)
    new Notice(
      stale > 0
        ? `Daily Task Panel: undid "${target.label}" — ${stale} line${stale === 1 ? '' : 's'} changed since last refresh — skipped`
        : `Daily Task Panel: undid "${target.label}"`,
    )
    // The lines just changed; the task source's signal reprojects every view.
  }

  private views(): PanelView[] {
    return this.app.workspace
      .getLeavesOfType(VIEW_TYPE)
      .map(leaf => leaf.view)
      .filter((view): view is PanelView => view instanceof PanelView)
  }

  /** A setting the projection depends on changed: every view reprojects. */
  async updateSettings(updates: Partial<PanelSettings>): Promise<void> {
    this.settings = {...this.settings, ...updates}
    await this.saveData(this.settings)
    for (const view of this.views()) view.refresh()
  }

  /** Collapse and fold state changed: every view repaints its last projection. */
  async updateUiState(updates: Partial<PanelSettings>): Promise<void> {
    this.settings = {...this.settings, ...updates}
    await this.saveData(this.settings)
    for (const view of this.views()) view.repaint()
  }

  private async activateView(reveal = true): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]
    if (existing) {
      if (reveal) await this.app.workspace.revealLeaf(existing)
      return
    }
    const leaf = this.app.workspace.getRightLeaf(false)
    if (!leaf) return
    await leaf.setViewState({type: VIEW_TYPE, active: reveal})
    if (reveal) {
      const created = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]
      if (created) await this.app.workspace.revealLeaf(created)
    }
  }
}
