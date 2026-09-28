import {TFile} from 'obsidian'

import {todayDailyNotePath} from './layout'
import {toJournalEntry} from '../core/journal'
import {plural, sourceLabel} from '../core/labels'
import {newTaskBlock} from '../core/move'
import {
  appendBlocks,
  cutIfUnchanged,
  editLabel,
  planCut,
  replaceLines,
  transformFor,
} from '../core/note-edit'

import type {App} from 'obsidian'
import type {JournalEntry, LineRecord} from '../core/journal'
import type {VaultLayout} from '../core/layout'
import type {TaskEdit} from '../core/note-edit'
import type {AddOutcome, EditOutcome, MoveOutcome} from '../core/ports'
import type {Task} from '../core/types'

/**
 * The line editor: the file lookup around core/note-edit.ts. Every write is
 * one vault.process per note with a pure step inside; a note that is gone
 * counts as stale for every task that pointed at it.
 */

/** Runs one pure step over a note's text; false when the note is missing. */
export const processNote = async (
  app: App,
  path: string,
  step: (data: string) => string,
): Promise<boolean> => {
  const file = app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile)) return false
  await app.vault.process(file, step)
  return true
}

const groupByFile = (tasks: readonly Task[]): Map<string, Task[]> => {
  const byFile = new Map<string, Task[]>()
  for (const task of tasks) {
    const list = byFile.get(task.filePath)
    if (list) list.push(task)
    else byFile.set(task.filePath, [task])
  }
  return byFile
}

export const editTasks = async (app: App, tasks: Task[], edit: TaskEdit): Promise<EditOutcome> => {
  const transform = transformFor(edit)
  const records: LineRecord[] = []
  let stale = 0
  for (const [path, fileTasks] of groupByFile(tasks)) {
    const found = await processNote(app, path, data => {
      const result = replaceLines(data, path, fileTasks, transform)
      records.push(...result.records)
      stale += result.stale
      return result.data
    })
    if (!found) stale += fileTasks.length
  }
  return {entry: toJournalEntry(editLabel(edit, records), records), stale}
}

/**
 * The one relocation shape both directions share: cut task blocks (each with
 * its subtask children) out of their source notes and land them under a
 * heading in the target note. Ordering is duplicate-safe, never lossy: per
 * source note, the blocks land first and are cut second, and the cut goes
 * through only if the source still reads as the snapshot the plan was made
 * from (core/note-edit cutIfUnchanged).
 */
const relocate = async (
  app: App,
  tasks: Task[],
  targetPath: string,
  heading: string,
  createMissing: boolean,
  label: (moved: number) => string,
): Promise<MoveOutcome> => {
  const outcome: MoveOutcome = {
    entry: null,
    moved: 0,
    duplicated: 0,
    skipped: 0,
    headingMissing: false,
    target: {path: targetPath, missing: !(app.vault.getAbstractFileByPath(targetPath) instanceof TFile)},
  }
  if (outcome.target.missing) return outcome

  const records: LineRecord[] = []
  const sources = new Map<string, Task[]>()
  for (const [path, fileTasks] of groupByFile(tasks)) {
    if (path === targetPath) outcome.skipped += fileTasks.length
    else sources.set(path, fileTasks)
  }

  for (const [path, fileTasks] of [...sources.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) {
      outcome.skipped += fileTasks.length
      continue
    }
    const snapshot = await app.vault.read(file)
    const plan = planCut(snapshot, fileTasks)
    outcome.skipped += plan.stale
    if (plan.valid.length === 0) continue

    let landed = false
    await processNote(app, targetPath, data => {
      const result = appendBlocks(data, targetPath, heading, plan.blocks, {createMissing})
      if (!result) return data
      landed = true
      records.push(...result.records)
      return result.data
    })
    if (!landed) {
      outcome.headingMissing = true
      break
    }

    let cut = false
    await app.vault.process(file, data => {
      const result = cutIfUnchanged(data, snapshot, path, plan)
      cut = result.cut
      records.push(...result.records)
      return result.data
    })
    if (cut) outcome.moved += plan.blocks.length
    else outcome.duplicated += plan.blocks.length
  }

  outcome.entry = toJournalEntry(label(outcome.moved + outcome.duplicated), records)
  return outcome
}

/** Move to project (CONTEXT.md): triage's filing edit, and drag's project drop. */
export const moveTasksToProject = (
  app: App,
  tasks: Task[],
  projectPath: string,
  targetHeading: string,
): Promise<MoveOutcome> =>
  relocate(app, tasks, projectPath, targetHeading, true, n => `moved ${plural(n)} to ${sourceLabel(projectPath)}`)

/**
 * The inverse: backlog tasks return to today's daily note under the inbox
 * heading — back into triage. A missing note or heading refuses: the panel
 * edits task lines only, it never creates or restructures daily notes.
 */
export const sendTasksBackToInbox = (
  app: App,
  tasks: Task[],
  layout: VaultLayout,
  today: string,
): Promise<MoveOutcome> =>
  relocate(
    app,
    tasks,
    todayDailyNotePath(layout, today),
    layout.inboxHeading,
    false,
    n => `sent ${plural(n)} back to To-do`,
  )

/**
 * Add task (#12): a task born straight into a project — the landing half of
 * a move without the cut. Same heading contract, same record shape, so undo
 * and staleness rules are inherited, not reimplemented.
 */
export const addTaskToProject = async (
  app: App,
  projectPath: string,
  text: string,
  targetHeading: string,
): Promise<AddOutcome> => {
  const block = newTaskBlock(text)
  const target = {path: projectPath, missing: false}
  if (!block) return {entry: null, target}
  let entry: JournalEntry | null = null
  const found = await processNote(app, projectPath, data => {
    const result = appendBlocks(data, projectPath, targetHeading, block, {createMissing: true})
    if (!result) return data
    entry = toJournalEntry(`added a task to ${sourceLabel(projectPath)}`, result.records)
    return result.data
  })
  target.missing = !found
  return {entry, target}
}
