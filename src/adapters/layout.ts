import {moment} from 'obsidian'

import {dailyNotePath, vaultLayout} from '../core/layout'

import type {App} from 'obsidian'
import type {DailyNotesConfig, VaultLayout} from '../core/layout'
import type {PanelSettings} from '../settings'

/**
 * The Daily Notes core plugin's configuration: the single source of truth
 * for where daily notes live while the plugin is on (#6). Null when it is
 * off. The one walk into Obsidian's private internals lives here.
 */
export const dailyNotesConfig = (app: App): DailyNotesConfig => {
  const internal = (
    app as unknown as {
      internalPlugins?: {
        getPluginById?: (id: string) => {
          enabled?: boolean
          instance?: {options?: {folder?: string; format?: string}}
        } | null
      }
    }
  ).internalPlugins?.getPluginById?.('daily-notes')
  if (!internal || internal.enabled === false || !internal.instance) return null
  const options = internal.instance.options ?? {}
  return {folder: options.folder ?? '', format: options.format ?? ''}
}

/** The layout as of now: settings plus the Daily Notes plugin's say. */
export const resolveLayout = (app: App, settings: PanelSettings): VaultLayout =>
  vaultLayout(settings, dailyNotesConfig(app))

/** Today's daily note path, resolved the way the Daily Notes plugin does. */
export const todayDailyNotePath = (layout: VaultLayout, today: string): string =>
  dailyNotePath(layout, moment(today).format(layout.dailyNoteFormat))
