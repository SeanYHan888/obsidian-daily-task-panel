/**
 * The vault layout: where things live, resolved once per projection and
 * handed to everything that classifies, drops, or writes — one rule for
 * "which folder", so the halves of triage can never disagree (they once
 * did: the inbox read from the settings folder while send-back wrote to
 * the vault root when the Daily Notes plugin was off).
 */
export type VaultLayout = {
  /** Where daily notes live; '' is the vault root. */
  dailyNotesFolder: string
  /** The Daily Notes plugin's name format (moment syntax; may contain subfolders). */
  dailyNoteFormat: string
  projectsFolder: string
  archiveFolder: string
  /** The machine-managed note (core/machine-note.ts), or '' when the vault has none. */
  machineNotePath: string
  /** Heading text without `#` marks; capture outside it is not the panel's business. */
  inboxHeading: string
  /** Where moved tasks land in a project note (a kanban board may own it). */
  moveTargetHeading: string
  /** '' means the built-in scaffold. */
  projectTemplatePath: string
}

/** The core Daily Notes plugin's folder and format, or null while it is off. */
export type DailyNotesConfig = {folder: string; format: string} | null

export type LayoutSettings = Pick<
  VaultLayout,
  | 'dailyNotesFolder'
  | 'projectsFolder'
  | 'archiveFolder'
  | 'machineNotePath'
  | 'inboxHeading'
  | 'moveTargetHeading'
  | 'projectTemplatePath'
>

const DEFAULT_DAILY_FORMAT = 'YYYY-MM-DD'

const stripTrailingSlash = (folder: string): string => folder.replace(/\/$/, '')

/**
 * The Daily Notes plugin's folder and format win while it is on; the
 * settings folder is the fallback for when it is off — for reading the
 * inbox and for writing send-back alike.
 */
export const vaultLayout = (settings: LayoutSettings, dailyNotes: DailyNotesConfig): VaultLayout => ({
  dailyNotesFolder: stripTrailingSlash(dailyNotes?.folder ?? settings.dailyNotesFolder),
  dailyNoteFormat: dailyNotes?.format || DEFAULT_DAILY_FORMAT,
  projectsFolder: stripTrailingSlash(settings.projectsFolder),
  archiveFolder: stripTrailingSlash(settings.archiveFolder),
  machineNotePath: settings.machineNotePath,
  inboxHeading: settings.inboxHeading,
  moveTargetHeading: settings.moveTargetHeading,
  projectTemplatePath: settings.projectTemplatePath,
})

/** A daily note's path from its formatted name — the format may carry subfolders. */
export const dailyNotePath = (layout: VaultLayout, formattedName: string): string =>
  `${layout.dailyNotesFolder ? layout.dailyNotesFolder + '/' : ''}${formattedName}.md`

/** The panel's state before its first projection: nothing lives anywhere yet. */
export const EMPTY_LAYOUT: VaultLayout = {
  dailyNotesFolder: '',
  dailyNoteFormat: DEFAULT_DAILY_FORMAT,
  projectsFolder: '',
  archiveFolder: '',
  machineNotePath: '',
  inboxHeading: '',
  moveTargetHeading: '',
  projectTemplatePath: '',
}
