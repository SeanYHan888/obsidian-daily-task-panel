import {Notice, Plugin, normalizePath} from 'obsidian'

import {createPorts} from './adapters/compose'
import {pushEntry, takeEntry, undoNotice} from './core/journal'
import {DEFAULT_SETTINGS, PanelSettingTab} from './settings'
import {LEGACY_PLUGIN_ID, isOwnLegacyData, migrateSettings} from './settings-migration'
import {VIEW_TYPE, PanelView} from './view'

import type {JournalEntry} from './core/journal'
import type {Ports} from './core/ports'
import type {PanelSettings} from './settings'

export default class DailyTaskPanelPlugin extends Plugin {
  settings: PanelSettings = {...DEFAULT_SETTINGS}
  /** Session undo journal (ADR-0001): a log of edits, in memory only; core keeps its rules. */
  private journal: JournalEntry[] = []
  private portsCache: Ports | null = null

  /** The composition root's object graph (ADR-0004): wired once per plugin, shared by every view. */
  get ports(): Ports {
    return (this.portsCache ??= createPorts(this.app, () => this.settings))
  }

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
    this.journal = pushEntry(this.journal, entry)
  }

  /** Undoes the given entry (an undo notice's own action), or the latest one. */
  async undo(entry?: JournalEntry): Promise<void> {
    const taken = takeEntry(this.journal, entry)
    this.journal = taken.journal
    if (taken.entry == null) {
      new Notice(undoNotice({reason: taken.reason}))
      return
    }
    const {stale} = await this.ports.editor.undo(taken.entry)
    new Notice(undoNotice({reason: 'undone', label: taken.entry.label, stale}))
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
