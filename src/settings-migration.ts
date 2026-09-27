import type {PanelSettings} from './settings'

/**
 * Settings carried across the two renames this plugin has been through. Pure,
 * so the rules are testable without Obsidian: main.ts does the file reads.
 *
 * 1. `appleSyncPath` became `machineNotePath` when the machine-managed note
 *    stopped being Apple-specific.
 * 2. The plugin was called Taskflow (id `taskflow`) until 2026-09-27. A new
 *    id means a new plugin folder, so a fresh install starts with no
 *    data.json; the old folder's copy is read once instead. The directory
 *    also has an unrelated plugin with id `taskflow`, so the old file is
 *    taken only when it is recognisably ours.
 */

/** The previous plugin id — its folder is where pre-rename settings live. */
export const LEGACY_PLUGIN_ID = 'taskflow'

type Stored = Partial<PanelSettings> & {appleSyncPath?: string}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * True when a data.json was written by this plugin under its old name: it
 * holds the three path settings only this plugin has, all as strings.
 */
export const isOwnLegacyData = (raw: unknown): boolean =>
  isRecord(raw) &&
  typeof raw.projectsFolder === 'string' &&
  typeof raw.inboxHeading === 'string' &&
  typeof raw.moveTargetHeading === 'string'

/**
 * Stored settings in, current-shape settings out: renamed keys moved, the
 * old keys dropped. Anything that isn't an object reads as nothing stored.
 */
export const migrateSettings = (raw: unknown): Partial<PanelSettings> => {
  if (!isRecord(raw)) return {}
  const {appleSyncPath, ...rest} = raw as Stored
  if (appleSyncPath != null && rest.machineNotePath == null) rest.machineNotePath = appleSyncPath
  return rest
}
