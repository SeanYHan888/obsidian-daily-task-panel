import {PluginSettingTab, Setting} from 'obsidian'

import type {App, SettingDefinitionItem} from 'obsidian'
import type {PacingMode} from './core/types'
import type DailyTaskPanelPlugin from './main'

import type {SectionKey} from './core/types'

export type {SectionKey} from './core/types'

export type PanelSettings = {
  dailyNotesFolder: string
  projectsFolder: string
  archiveFolder: string
  /** Optional: a note some sync tool rewrites (see core/machine-note.ts). '' = none. */
  machineNotePath: string
  inboxHeading: string
  moveTargetHeading: string
  /** Optional: '' falls back to the built-in project scaffold. */
  projectTemplatePath: string
  /** Which pacing signals render: wip | deadline | hybrid (both + pressing). */
  pacingMode: PacingMode
  wipLimit: number
  /** Hybrid only: days before a deadline that the header offers → now; 0 waits for arrival. */
  pressWindow: number
  collapsed: Partial<Record<SectionKey, boolean>>
  /** Folded project groups, keyed by project note path. */
  collapsedProjects: Record<string, boolean>
}

export const DEFAULT_SETTINGS: PanelSettings = {
  dailyNotesFolder: 'Daily Notes',
  projectsFolder: 'Projects/Active',
  archiveFolder: 'Projects/Archive',
  machineNotePath: '',
  inboxHeading: 'Inbox',
  moveTargetHeading: 'Tasks',
  projectTemplatePath: '',
  // Hybrid preserves pre-mode behavior: both signals on, plus the pressing loop.
  pacingMode: 'hybrid',
  wipLimit: 3,
  pressWindow: 7,
  collapsed: {},
  collapsedProjects: {},
}


type TextKey = {[K in keyof PanelSettings]: PanelSettings[K] extends string ? K : never}[keyof PanelSettings]
type NumberKey = 'wipLimit' | 'pressWindow'

type TextSetting = {
  kind: 'text'
  key: TextKey
  name: string
  desc: string
  placeholder: string
  /** Optional fields may be blanked; required ones fall back to the default. */
  optional?: boolean
  /** Extra words settings search should find this by. */
  aliases?: string[]
}

type NumberSetting = {
  kind: 'number'
  key: NumberKey
  name: string
  desc: string
  min: number
  aliases?: string[]
}

type DropdownSetting = {
  kind: 'dropdown'
  key: 'pacingMode'
  name: string
  desc: string
  options: Record<PacingMode, string>
  aliases?: string[]
}

type SettingSpec = TextSetting | NumberSetting | DropdownSetting

/**
 * Every setting, once. Obsidian 1.13+ renders the tab from these as
 * declarative definitions (so they appear in settings search); older
 * versions get the same list rendered imperatively by display().
 */
const SETTINGS: SettingSpec[] = [
  {
    kind: 'text',
    key: 'dailyNotesFolder',
    name: 'Daily notes folder',
    desc: 'Where daily notes live when the core Daily Notes plugin is off — for reading the inbox and for sending tasks back alike. While the plugin is on, its folder and date format are used.',
    placeholder: DEFAULT_SETTINGS.dailyNotesFolder,
    aliases: ['journal', 'inbox folder'],
  },
  {
    kind: 'text',
    key: 'projectsFolder',
    name: 'Projects folder',
    desc: 'Notes in this folder are projects. A task belongs to a project because its line lives in that note.',
    placeholder: DEFAULT_SETTINGS.projectsFolder,
    aliases: ['backlog'],
  },
  {
    kind: 'text',
    key: 'archiveFolder',
    name: 'Archive folder',
    desc: 'Where retired project notes go when marked done or dropped.',
    placeholder: DEFAULT_SETTINGS.archiveFolder,
    aliases: ['done', 'dropped', 'retire'],
  },
  {
    kind: 'text',
    key: 'machineNotePath',
    name: 'Machine-managed note',
    desc: 'Optional. A note some sync tool rewrites on its own (for example an Apple Reminders sync). Its dated reminders appear; its scheduled time blocks do not; its rows allow check-off only. Leave blank if no tool owns a note.',
    placeholder: 'Sync/Reminders.md',
    optional: true,
    aliases: ['sync', 'reminders', 'read-only'],
  },
  {
    kind: 'text',
    key: 'inboxHeading',
    name: 'Inbox heading',
    desc: "Only tasks under this daily-note heading count as capture; they appear at the tail of the panel's To-do section. Plain text match — any language works.",
    placeholder: DEFAULT_SETTINGS.inboxHeading,
    aliases: ['capture', 'triage'],
  },
  {
    kind: 'text',
    key: 'projectTemplatePath',
    name: 'Project template',
    desc: 'Optional. Note used by "New project"; {{title}} and {{date:YYYY-MM-DD}} are filled in. Leave blank to use a built-in scaffold.',
    placeholder: 'Templates/project.md',
    optional: true,
    aliases: ['new project'],
  },
  {
    kind: 'text',
    key: 'moveTargetHeading',
    name: 'Move-target heading',
    desc: 'Where moved tasks land in a project note. Configurable so a project note can double as a kanban board.',
    placeholder: DEFAULT_SETTINGS.moveTargetHeading,
    aliases: ['kanban', 'move to project'],
  },
  {
    kind: 'dropdown',
    key: 'pacingMode',
    name: 'Project pacing',
    desc: 'How projects are paced. Capacity shows a badge counting projects in "now" against the limit. Deadlines gives each project a date, sorted soonest first. Hybrid shows both and offers "→ now" on projects whose deadline is close but not yet committed. Switching is lossless — statuses and deadlines stay in each note.',
    options: {
      hybrid: 'Hybrid (capacity + deadlines)',
      wip: 'Capacity only',
      deadline: 'Deadlines only',
    },
    aliases: ['capacity', 'deadlines', 'hybrid', 'wip'],
  },
  {
    kind: 'number',
    key: 'wipLimit',
    name: 'Work-in-progress limit',
    desc: 'Projects allowed in "now" before the badge warns. Warns, never blocks.',
    min: 1,
    aliases: ['wip', 'capacity', 'now'],
  },
  {
    kind: 'number',
    key: 'pressWindow',
    name: 'Deadline attention window',
    desc: 'Hybrid pacing only: days before a project deadline that its header offers "→ now". Set it to zero to wait until the deadline arrives. The fallback for projects without a start date — a project with one presses from its start day instead.',
    min: 0,
    aliases: ['pressing', 'now'],
  },
]

const specFor = (key: string): SettingSpec | undefined => SETTINGS.find(s => s.key === key)

/**
 * A raw edit as the setting it stands for: text trimmed (a blank required
 * field falls back to its default), numbers whole and in range. Null when
 * the edit is not yet a valid value — the stored one stays.
 */
const settingValue = (spec: SettingSpec, raw: unknown): PanelSettings[SettingSpec['key']] | null => {
  if (spec.kind === 'text') {
    const text = typeof raw === 'string' ? raw.trim() : ''
    return text || (spec.optional ? '' : spec.placeholder)
  }
  if (spec.kind === 'number') {
    const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10)
    return Number.isInteger(n) && n >= spec.min ? n : null
  }
  return typeof raw === 'string' && raw in spec.options ? raw : null
}

export class PanelSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: DailyTaskPanelPlugin,
  ) {
    super(app, plugin)
  }

  /** Obsidian 1.13+: the tab, declaratively — rendered and indexed for settings search. */
  getSettingDefinitions(): SettingDefinitionItem[] {
    return SETTINGS.map((spec): SettingDefinitionItem => {
      const base = {name: spec.name, desc: spec.desc, aliases: spec.aliases}
      switch (spec.kind) {
        case 'text':
          return {...base, control: {type: 'text', key: spec.key, placeholder: spec.placeholder}}
        case 'number':
          return {
            ...base,
            control: {
              type: 'number',
              key: spec.key,
              min: spec.min,
              step: 1,
              validate: value =>
                Number.isInteger(value) && value >= spec.min
                  ? undefined
                  : `A whole number, ${spec.min} or more`,
            },
          }
        case 'dropdown':
          return {...base, control: {type: 'dropdown', key: spec.key, options: spec.options}}
      }
    })
  }

  getControlValue(key: string): unknown {
    return this.plugin.settings[key as keyof PanelSettings]
  }

  /** Every change goes through the plugin, so every open panel reprojects. */
  async setControlValue(key: string, value: unknown): Promise<void> {
    const spec = specFor(key)
    if (!spec) return
    const next = settingValue(spec, value)
    if (next != null) await this.plugin.updateSettings({[spec.key]: next})
  }

  /** Obsidian before 1.13 (minAppVersion is 1.7.2): the same settings, rendered by hand. */
  display(): void {
    this.containerEl.empty()
    for (const spec of SETTINGS) {
      const setting = new Setting(this.containerEl).setName(spec.name).setDesc(spec.desc)
      if (spec.kind === 'dropdown') {
        setting.addDropdown(dropdown =>
          dropdown
            .addOptions(spec.options)
            .setValue(this.plugin.settings[spec.key])
            .onChange(value => this.setControlValue(spec.key, value)),
        )
      } else {
        setting.addText(input =>
          input
            .setPlaceholder(spec.kind === 'text' ? spec.placeholder : '')
            .setValue(String(this.plugin.settings[spec.key]))
            .onChange(value => this.setControlValue(spec.key, value)),
        )
      }
    }
  }
}
