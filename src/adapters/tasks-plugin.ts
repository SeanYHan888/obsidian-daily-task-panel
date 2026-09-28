import {Notice, TFile} from 'obsidian'

import {replaceLines} from '../core/note-edit'

import type {App, EventRef} from 'obsidian'
import type {Task} from '../core/types'

/** The slice of the Tasks plugin we rely on. Its absence is a first-class state. */
type TasksPluginLike = {
  getTasks(): unknown[]
  apiV1?: {
    executeToggleTaskDoneCommand(line: string, path: string): string
  }
}

const TASKS_PLUGIN_ID = 'obsidian-tasks-plugin'

export const getTasksPlugin = (app: App): TasksPluginLike | null => {
  const plugins = (app as unknown as {plugins?: {plugins?: Record<string, unknown>}})
    .plugins?.plugins
  const tasks = plugins?.[TASKS_PLUGIN_ID] as
    | (TasksPluginLike & Record<string, unknown>)
    | undefined
  return tasks && typeof tasks.getTasks === 'function' ? tasks : null
}

/**
 * The Tasks plugin's cache-update signal. Its event name lives here with the
 * plugin id, so the whole coupling breaks in one file if internals change.
 */
export const onTasksChange = (app: App, listener: () => void): (() => void) => {
  const workspace = app.workspace as unknown as {
    on(name: string, cb: () => void): EventRef
    offref(ref: EventRef): void
  }
  const ref = workspace.on(`${TASKS_PLUGIN_ID}:cache-update`, listener)
  return () => workspace.offref(ref)
}

const isoDate = (value: unknown): string | null => {
  const moment = value as {isValid?: () => boolean; format?: (f: string) => string} | null
  if (!moment || typeof moment.format !== 'function') return null
  if (typeof moment.isValid === 'function' && !moment.isValid()) return null
  return moment.format('YYYY-MM-DD')
}

/**
 * Projects the Tasks plugin's live cache into core's task model.
 * Parent lines come from the metadata cache's list-item relations, the same
 * source the subtask hierarchy has always used.
 */
export const readTasks = (app: App): Task[] => {
  const plugin = getTasksPlugin(app)
  if (!plugin) return []

  const parentByLineByPath = new Map<string, Map<number, number>>()
  const parentLineFor = (path: string, line: number): number | undefined => {
    let byLine = parentByLineByPath.get(path)
    if (!byLine) {
      byLine = new Map()
      const file = app.vault.getAbstractFileByPath(path)
      if (file instanceof TFile) {
        for (const item of app.metadataCache.getFileCache(file)?.listItems ?? []) {
          byLine.set(item.position.start.line, item.parent)
        }
      }
      parentByLineByPath.set(path, byLine)
    }
    const parent = byLine.get(line)
    return parent != null && parent >= 0 ? parent : undefined
  }

  const tasks: Task[] = []
  for (const raw of plugin.getTasks()) {
    const t = raw as {
      description?: string
      originalMarkdown?: string
      status?: {type?: string}
      scheduledDate?: unknown
      dueDate?: unknown
      taskLocation?: {path?: string; lineNumber?: number; precedingHeader?: string | null}
    }
    const path = t.taskLocation?.path
    const line = t.taskLocation?.lineNumber
    if (path == null || line == null) continue

    const statusType = t.status?.type ?? 'TODO'
    tasks.push({
      description: t.description ?? '',
      sourceLine: t.originalMarkdown ?? '',
      filePath: path,
      line,
      open: statusType === 'TODO' || statusType === 'IN_PROGRESS',
      scheduled: isoDate(t.scheduledDate),
      due: isoDate(t.dueDate),
      heading: t.taskLocation?.precedingHeader ?? null,
      parentLine: parentLineFor(path, line),
      children: [],
    })
  }
  return tasks
}

/**
 * Completes a task through the Tasks plugin so ✅ done-dates, recurrence, and
 * Apple Reminders write-back keep working (ADR-0001) — there is deliberately no
 * degraded write path without the API. The source line is verified before
 * editing; a stale line aborts with a Notice instead of writing.
 */
export const toggleTask = async (app: App, task: Task): Promise<void> => {
  const file = app.vault.getAbstractFileByPath(task.filePath)
  if (!(file instanceof TFile)) return

  const api = getTasksPlugin(app)?.apiV1
  if (!api || typeof api.executeToggleTaskDoneCommand !== 'function') {
    new Notice('Daily task panel: Tasks plugin API unavailable — task not completed')
    return
  }
  let stale = false
  await app.vault.process(file, data => {
    const result = replaceLines(data, task.filePath, [task], bare =>
      api.executeToggleTaskDoneCommand(bare, task.filePath),
    )
    stale = result.stale > 0
    return result.data
  })
  if (stale) new Notice('Daily task panel: task moved since last refresh — refreshing instead')
}
