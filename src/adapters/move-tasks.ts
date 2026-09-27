import {Notice, TFile, moment} from 'obsidian'

import {carriageReturn, sameLine, withEnding} from './lines'
import {relationsFromLines} from '../core/hierarchy'
import {toJournalEntry} from '../core/journal'
import {plural} from '../core/labels'
import {cutTaskBlocks, insertUnderHeadingAt, newTaskBlock} from '../core/move'

import type {App} from 'obsidian'
import type {JournalEntry, LineRecord} from '../core/journal'
import type {MoveOutcome} from '../core/ports'
import type {Task} from '../core/types'

type RelocateOutcome = {
  moved: number
  duplicated: number
  skipped: number
  headingMissing: boolean
  records: LineRecord[]
}

/**
 * The one relocation shape both directions share: cut task blocks (each with
 * its subtask children) out of their source notes and append them under a
 * heading in the target note. Descendants come from relations parsed out of
 * the exact content being edited — never a cache that could lag the file.
 *
 * Ordering is duplicate-safe, never lossy: per source file, blocks are
 * appended to the target first and cut from the source second, and the cut
 * re-verifies the whole source against the pre-append snapshot. A file that
 * changed in the window keeps its lines (leaving a duplicate to clean up);
 * a task whose line no longer matches what was selected is skipped entirely.
 * Every landed and cut line becomes a journal record.
 */
const relocateTaskBlocks = async (
  app: App,
  tasks: Task[],
  targetFile: TFile,
  heading: string,
  createMissing: boolean,
): Promise<RelocateOutcome> => {
  const byFile = new Map<string, Task[]>()
  let skipped = 0
  for (const task of tasks) {
    if (task.filePath === targetFile.path) {
      skipped++
      continue
    }
    byFile.set(task.filePath, [...(byFile.get(task.filePath) ?? []), task])
  }

  let moved = 0
  let duplicated = 0
  let headingMissing = false
  const records: LineRecord[] = []
  for (const [path, fileTasks] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const file = app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) {
      skipped += fileTasks.length
      continue
    }

    const snapshotLines = (await app.vault.read(file)).split('\n')
    const valid = fileTasks.filter(t => sameLine(snapshotLines[t.line], t.sourceLine))
    skipped += fileTasks.length - valid.length
    if (valid.length === 0) continue

    const {blocks, removedLines} = cutTaskBlocks(
      snapshotLines,
      valid.map(t => t.line),
      relationsFromLines(snapshotLines),
    )

    let appended = false
    await app.vault.process(targetFile, data => {
      const cr = carriageReturn(data)
      const landing = blocks.map(block => withEnding(block, cr))
      const insertion = insertUnderHeadingAt(data.split('\n'), heading, landing, {createMissing})
      if (!insertion) {
        headingMissing = true
        return data
      }
      appended = true
      insertion.inserted.forEach((text, i) =>
        records.push({kind: 'insert', file: targetFile.path, line: insertion.insertAt + i, text}),
      )
      return insertion.lines.join('\n')
    })
    if (!appended) break

    let cut = false
    await app.vault.process(file, data => {
      const lines = data.split('\n')
      if (
        lines.length !== snapshotLines.length ||
        lines.some((line, i) => line !== snapshotLines[i])
      ) {
        return data
      }
      cut = true
      return cutTaskBlocks(lines, valid.map(t => t.line), relationsFromLines(lines))
        .remaining.join('\n')
    })
    if (cut) {
      moved += blocks.length
      for (const line of removedLines) {
        records.push({kind: 'remove', file: path, line, text: snapshotLines[line]})
      }
    } else {
      duplicated += blocks.length
    }
  }

  return {moved, duplicated, skipped, headingMissing, records}
}

/** Move to project (CONTEXT.md): triage's filing edit, and drag's project drop. */
export const moveTasksToProject = async (
  app: App,
  tasks: Task[],
  projectPath: string,
  targetHeading: string,
): Promise<MoveOutcome> => {
  const projectFile = app.vault.getAbstractFileByPath(projectPath)
  if (!(projectFile instanceof TFile)) {
    new Notice(`Daily Task Panel: project note not found: ${projectPath}`)
    return {moved: 0, entry: null}
  }

  const outcome = await relocateTaskBlocks(app, tasks, projectFile, targetHeading, true)

  if (outcome.duplicated > 0) {
    new Notice(
      `Daily Task Panel: ${plural(outcome.duplicated)} copied but not cut — the source note changed mid-move; remove the originals by hand`,
    )
  }
  if (outcome.skipped > 0) {
    new Notice(
      `Daily Task Panel: ${plural(outcome.skipped)} not moved (changed since selection, or already in the target note)`,
    )
  }
  const total = outcome.moved + outcome.duplicated
  const projectName = (projectPath.split('/').pop() ?? projectPath).replace(/\.md$/, '')
  return {
    moved: total,
    entry: toJournalEntry(`moved ${plural(total)} to ${projectName}`, outcome.records),
  }
}

/**
 * Add task (#12): a task born straight into a project — the append half of a
 * move, without the cut half. Same landing contract (the move-target heading,
 * created when missing), same journal record shape, so undo depth and
 * staleness rules are inherited, not reimplemented.
 */
export const addTaskToProject = async (
  app: App,
  projectPath: string,
  text: string,
  targetHeading: string,
): Promise<JournalEntry | null> => {
  const block = newTaskBlock(text)
  if (!block) return null
  const projectFile = app.vault.getAbstractFileByPath(projectPath)
  if (!(projectFile instanceof TFile)) {
    new Notice(`Daily Task Panel: project note not found: ${projectPath}`)
    return null
  }

  const records: LineRecord[] = []
  await app.vault.process(projectFile, data => {
    const landing = block.map(lines => withEnding(lines, carriageReturn(data)))
    const insertion = insertUnderHeadingAt(data.split('\n'), targetHeading, landing, {
      createMissing: true,
    })
    if (!insertion) return data
    insertion.inserted.forEach((line, i) =>
      records.push({kind: 'insert', file: projectPath, line: insertion.insertAt + i, text: line}),
    )
    return insertion.lines.join('\n')
  })

  const projectName = (projectPath.split('/').pop() ?? projectPath).replace(/\.md$/, '')
  return toJournalEntry(`added a task to ${projectName}`, records)
}

/**
 * The Daily Notes core plugin's configuration — the single source of truth
 * for where daily notes live (#6): classification filters by the same folder
 * send-back writes to, so the two halves of triage can never disagree. Null
 * when the plugin is off. The one walk into Obsidian's private internals
 * lives here.
 */
export const dailyNotesConfig = (app: App): {folder: string; format: string} | null => {
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
  return {
    folder: (options.folder ?? '').replace(/\/$/, ''),
    format: options.format || 'YYYY-MM-DD',
  }
}

/** Today's daily note path, resolved the way the Daily Notes plugin does (the format may contain subfolders). */
const todayDailyNotePath = (app: App, today: string): string => {
  const config = dailyNotesConfig(app) ?? {folder: '', format: 'YYYY-MM-DD'}
  const name = moment(today).format(config.format)
  return `${config.folder ? config.folder + '/' : ''}${name}.md`
}

/**
 * The inverse of moveTasksToProject: backlog tasks return to today's daily
 * note under the inbox heading — back into triage. Refuses when today's note
 * or its inbox heading is missing: the panel edits task lines only, it never
 * creates or restructures notes.
 */
export const sendTasksBackToInbox = async (
  app: App,
  tasks: Task[],
  inboxHeading: string,
  today: string,
): Promise<MoveOutcome> => {
  const dailyPath = todayDailyNotePath(app, today)
  const dailyFile = app.vault.getAbstractFileByPath(dailyPath)
  if (!(dailyFile instanceof TFile)) {
    new Notice(`Daily Task Panel: today's daily note not found (${dailyPath}) — create it first`)
    return {moved: 0, entry: null}
  }

  const outcome = await relocateTaskBlocks(app, tasks, dailyFile, inboxHeading, false)

  if (outcome.headingMissing) {
    new Notice(
      `Daily Task Panel: no "${inboxHeading}" heading in today's daily note — nothing sent back`,
    )
  }
  if (outcome.duplicated > 0) {
    new Notice(
      `Daily Task Panel: ${plural(outcome.duplicated)} copied but not cut — the project note changed mid-move; remove the originals by hand`,
    )
  }
  if (outcome.skipped > 0) {
    new Notice(
      `Daily Task Panel: ${plural(outcome.skipped)} not sent back (changed since, or already in today's note)`,
    )
  }
  const total = outcome.moved + outcome.duplicated
  return {
    moved: total,
    entry: toJournalEntry(`sent ${plural(total)} back to To-do`, outcome.records),
  }
}

/** The built-in scaffold: only what the panel itself reads — a status and the move-target heading. No vault-specific frontmatter conventions (#6). */
const FALLBACK_TEMPLATE = (name: string, headingLine: string) => `---
status: later
---
# ${name}

${headingLine}
`

/**
 * Creates a project note from the configured template, or from the built-in
 * scaffold when no template is set or the note is missing — "New project"
 * never dead-ends (#6). The heading comes from the move-target setting,
 * never hardcoded. Returns the existing note if the name is already taken.
 */
export const createProjectFromTemplate = async (
  app: App,
  rawName: string,
  projectsFolder: string,
  templatePath: string,
  targetHeading: string,
  today: string,
): Promise<TFile | null> => {
  const name = rawName.replace(/[\\/:#^[\]|]/g, ' ').trim()
  if (!name) return null
  const folder = projectsFolder.replace(/\/$/, '')
  const path = `${folder}/${name}.md`

  const existing = app.vault.getAbstractFileByPath(path)
  if (existing instanceof TFile) {
    new Notice(`Daily Task Panel: project "${name}" already exists — moving into it`)
    return existing
  }
  if (folder && !app.vault.getAbstractFileByPath(folder)) {
    await app.vault.createFolder(folder)
  }

  const templateFile = templatePath ? app.vault.getAbstractFileByPath(templatePath) : null
  if (templateFile instanceof TFile) {
    const content = (await app.vault.read(templateFile))
      .replaceAll('{{title}}', name)
      .replaceAll('{{date:YYYY-MM-DD}}', today)
    return app.vault.create(path, content)
  }

  const explicitMarks = targetHeading.trim().match(/^#{1,6}(?=\s)/)?.[0]
  const headingLine = `${explicitMarks ?? '##'} ${targetHeading.replace(/^#+\s*/, '').trim()}`
  return app.vault.create(path, FALLBACK_TEMPLATE(name, headingLine))
}
