import {dropIntent} from './drop'
import {flattenTaskTree} from './hierarchy'
import {plural} from './labels'
import {editableTasks} from './machine-note'
import {commitStatus, moveProject, organizeProjects, setProjectDate} from './project-commands'
import {postponeAnchor, resolveQuickDate, resolveRelativeDate, taskWords} from './schedule'
import {retirePlan} from './sections'

import type {DropTarget} from './drop'
import type {JournalEntry} from './journal'
import type {ProjectDateEdit} from './labels'
import type {VaultLayout} from './layout'
import type {MenuAction} from './menus'
import type {Ports} from './ports'
import type {PacingMode, ProjectMeta, SectionKey, Sections, Task} from './types'

/**
 * Panel actions: every act the panel offers, performed as one use case —
 * guard, resolve dates against the projection it was offered on, write
 * through the ports, name the outcome. Buttons, chips, drops and menu items
 * all speak MenuAction (core/menus.ts) at one of three subjects, and the
 * shell (view.ts) does only what a shell can: mount, render a menu, jump to
 * a note, show a notice, keep UI state.
 *
 * The clock is the projection's: `today` is the day the panel was last
 * drawn for, so a menu and the act it triggers agree even across midnight.
 */

export type Subject =
  | {kind: 'tasks'; tasks: Task[]}
  | {kind: 'project'; project: ProjectMeta}
  | {kind: 'section'; key: SectionKey}

/** The one way to pick a project or start a new one; the name typed so far rides along. */
export type ProjectChoice = {kind: 'project'; project: ProjectMeta} | {kind: 'new'; name?: string}

/** What the actions ask the user; the shell answers with modals, tests with a script. */
export type Prompter = {
  askText(opts: {title: string; placeholder: string; submitLabel: string; value?: string}): Promise<string | null>
  askDate(opts: {defaultDate: string; title: string; submitLabel: string}): Promise<string | null>
  confirm(opts: {title: string; body: string; confirmLabel: string}): Promise<boolean>
  pickProject(projects: ProjectMeta[]): Promise<ProjectChoice | null>
}

export type ActionContext = {
  ports: Ports
  prompter: Prompter
  /** The projection the act was offered on, and the day it was drawn for. */
  sections: Sections | null
  today: string
  layout: VaultLayout
  pacingMode: PacingMode
  wipLimit: number
}

/** The acts only the shell can finish: a jump, select mode, a fold, a menu. */
export type UiEffect =
  | {kind: 'open'; path: string; line?: number}
  | {kind: 'select'; task: Task}
  | {kind: 'toggle-select'}
  | {kind: 'fold-all'; folded: boolean}
  /** The note moved; the shell carries its fold toggle to the new path. */
  | {kind: 'project-renamed'; from: string; to: string}
  /** A drop that needs a date chosen: the shell opens the start menu for these tasks. */
  | {kind: 'schedule-menu'; tasks: Task[]}

export type ActionResult = {
  /** A line edit's undoable record; its label is the notice. */
  entry: JournalEntry | null
  /** What to tell the user when nothing is journaled; null when silence is right. */
  notice: string | null
  effect: UiEffect | null
}

const NOTHING: ActionResult = {entry: null, notice: null, effect: null}
const journaled = (entry: JournalEntry | null): ActionResult => ({...NOTHING, entry})
const noticed = (notice: string | null): ActionResult => ({...NOTHING, notice})
const effect = (effect: UiEffect): ActionResult => ({...NOTHING, effect})

/** One entry for a per-task act repeated over a selection. */
const merged = (entries: (JournalEntry | null)[], label: (n: number) => string): JournalEntry | null => {
  const records = entries.flatMap(e => e?.records ?? [])
  const count = entries.filter(e => e != null).length
  return records.length === 0 ? null : {label: count === 1 ? entries.find(e => e)!.label : label(count), records}
}

/** The move flow: pick a project or name a new one, then move the editable rows there. */
const moveToProject = async (ctx: ActionContext, tasks: Task[]): Promise<ActionResult> => {
  if (tasks.length === 0) return NOTHING
  const choice = await ctx.prompter.pickProject(ctx.ports.projects.read())
  if (!choice) return NOTHING
  if (choice.kind === 'project') {
    return journaled((await ctx.ports.editor.moveToProject(tasks, choice.project.path)).entry)
  }
  const name = await ctx.prompter.askText({
    title: 'New project',
    placeholder: 'Project name',
    value: choice.name,
    submitLabel: 'Create and move',
  })
  if (!name) return NOTHING
  const path = await ctx.ports.projects.create(name, ctx.today)
  if (!path) return NOTHING
  return journaled((await ctx.ports.editor.moveToProject(tasks, path)).entry)
}

const performOnTasks = async (
  ctx: ActionContext,
  all: Task[],
  action: MenuAction,
): Promise<ActionResult> => {
  const {editor, tasks: source} = ctx.ports
  // The read-only guard's one home for acts (ADR-0003): a machine-managed
  // row survives check-off and the jump, and nothing else.
  const tasks = editableTasks(all, ctx.layout)
  const first = all[0]
  switch (action.type) {
    case 'open-note':
      return first ? effect({kind: 'open', path: first.filePath, line: first.line}) : NOTHING
    case 'select':
      return first ? effect({kind: 'select', task: first}) : NOTHING
    case 'complete':
      for (const task of all) await source.toggle(task)
      return NOTHING
  }
  if (tasks.length === 0) return NOTHING
  const reschedule = async (date: string) => journaled(await editor.reschedule(tasks, date, ctx.today))
  switch (action.type) {
    case 'schedule':
      return reschedule(resolveQuickDate(action.kind, ctx.today))
    case 'postpone': {
      // The relative pair counts from one anchor, so the menu offers it to one row.
      const anchor = postponeAnchor(tasks[0], ctx.today)
      return anchor == null ? NOTHING : reschedule(resolveRelativeDate(action.kind, anchor))
    }
    case 'pick-date': {
      const date = await ctx.prompter.askDate({
        defaultDate: ctx.today,
        title: 'Start on',
        submitLabel: 'Set start',
      })
      return date ? reschedule(date) : NOTHING
    }
    case 'remove-date':
      return journaled(await editor.unschedule(tasks))
    case 'pick-due-date': {
      const task = tasks[0]
      const date = await ctx.prompter.askDate({
        defaultDate: task.due ?? ctx.today,
        title: 'Due on',
        submitLabel: 'Set due date',
      })
      return date ? journaled(await editor.setDue([task], date)) : NOTHING
    }
    case 'remove-due-date':
      return journaled(await editor.clearDue(tasks))
    case 'edit-text': {
      const task = tasks[0]
      const words = taskWords(task.sourceLine)
      const text = await ctx.prompter.askText({
        title: 'Edit task',
        placeholder: 'Task',
        value: words,
        submitLabel: 'Save',
      })
      return text && text !== words ? journaled(await editor.editText(task, text)) : NOTHING
    }
    case 'move-to-project':
      return moveToProject(ctx, tasks)
    case 'send-back':
      return journaled((await editor.sendBackToInbox(tasks, ctx.today)).entry)
    case 'cancel': {
      const entries: (JournalEntry | null)[] = []
      for (const task of tasks) entries.push(await editor.cancel(task))
      return journaled(merged(entries, n => `cancelled ${plural(n)}`))
    }
    default:
      return NOTHING
  }
}

const projectDate = async (
  ctx: ActionContext,
  project: ProjectMeta,
  field: ProjectDateEdit['field'],
): Promise<ActionResult> => {
  // The picker opens on the date already held, else today; no quick dates —
  // a project date is picked, never guessed.
  const date = await ctx.prompter.askDate({
    defaultDate: project[field] ?? ctx.today,
    title: field === 'start' ? 'Project start' : 'Project deadline',
    submitLabel: field === 'start' ? 'Set start' : 'Set deadline',
  })
  if (!date) return NOTHING
  return noticed((await setProjectDate(ctx.ports.projects, project, {field, date})).notice)
}

/**
 * Retiring is not journaled (frontmatter + file move, not task lines) — the
 * note itself, moved intact, is the undo. Open tasks are never edited; when
 * some remain they confirm first, because an archived note's tasks leave
 * the panel.
 */
const retire = async (
  ctx: ActionContext,
  project: ProjectMeta,
  status: 'done' | 'dropped',
): Promise<ActionResult> => {
  const {openCount, needsConfirm} = retirePlan(ctx.sections, project.path)
  if (needsConfirm) {
    const confirmed = await ctx.prompter.confirm({
      title: `Mark ${project.name} ${status}?`,
      body: `${openCount} open task${openCount === 1 ? ' remains' : 's remain'} and will leave the panel with the note. The lines themselves are kept untouched.`,
      confirmLabel: `Mark ${status} & archive`,
    })
    if (!confirmed) return NOTHING
  }
  const archived = await ctx.ports.projects.archive(project.path, status)
  return archived
    ? noticed(`Daily Task Panel: ${project.name} marked ${status} — archived to ${ctx.layout.archiveFolder}`)
    : NOTHING
}

const performOnProject = async (
  ctx: ActionContext,
  project: ProjectMeta,
  action: MenuAction,
): Promise<ActionResult> => {
  const store = ctx.ports.projects
  const groups = ctx.sections?.projects ?? []
  switch (action.type) {
    case 'open-note':
      return effect({kind: 'open', path: project.path})
    case 'rename-project': {
      const name = await ctx.prompter.askText({
        title: 'Rename project',
        placeholder: 'Project name',
        value: project.name,
        submitLabel: 'Rename',
      })
      if (!name || name === project.name) return NOTHING
      const path = await store.rename(project.path, name)
      if (!path) return NOTHING
      return {
        entry: null,
        notice: `Daily Task Panel: ${project.name} → ${name}`,
        effect: {kind: 'project-renamed', from: project.path, to: path},
      }
    }
    case 'move':
      await moveProject(store, groups, project.path, action.direction)
      return NOTHING
    case 'add-task': {
      const text = await ctx.prompter.askText({
        title: `Add task to ${project.name}`,
        placeholder: 'Task',
        submitLabel: 'Add',
      })
      return text ? journaled(await ctx.ports.editor.addTask(project.path, text)) : NOTHING
    }
    case 'promote':
    case 'set-status': {
      const status = action.type === 'promote' ? 'now' : action.status
      const outcome = await commitStatus(store, project, status, {
        sections: ctx.sections,
        wipLimit: ctx.wipLimit,
      })
      return noticed(outcome.notice)
    }
    case 'pick-start':
      return projectDate(ctx, project, 'start')
    case 'pick-deadline':
      return projectDate(ctx, project, 'deadline')
    case 'clear-start':
      return noticed((await setProjectDate(store, project, {field: 'start', date: null})).notice)
    case 'clear-deadline':
      return noticed((await setProjectDate(store, project, {field: 'deadline', date: null})).notice)
    case 'retire':
      return retire(ctx, project, action.status)
    default:
      return NOTHING
  }
}

const performOnSection = async (ctx: ActionContext, action: MenuAction): Promise<ActionResult> => {
  switch (action.type) {
    case 'toggle-select':
      return effect({kind: 'toggle-select'})
    case 'fold-all':
      return effect({kind: 'fold-all', folded: action.folded})
    case 'organize':
      return noticed((await organizeProjects(ctx.ports.projects, ctx.pacingMode)).notice)
    case 'new-project': {
      const name = await ctx.prompter.askText({
        title: 'New project',
        placeholder: 'Project name',
        submitLabel: 'Create',
      })
      if (!name) return NOTHING
      const path = await ctx.ports.projects.create(name, ctx.today)
      return path ? noticed(`Daily Task Panel: project ${name} created`) : NOTHING
    }
    case 'reschedule-all': {
      // Start all today, over the last projection: every line is verified
      // against its fingerprint at write time, so a row that changed since
      // is skipped, never guessed at.
      const slipped = editableTasks(flattenTaskTree(ctx.sections?.slipped ?? []), ctx.layout)
      if (slipped.length === 0) return NOTHING
      return journaled(await ctx.ports.editor.reschedule(slipped, ctx.today, ctx.today))
    }
    default:
      return NOTHING
  }
}

/** One act on one subject, performed in full; the result is what the shell still has to do. */
export const performAction = (
  ctx: ActionContext,
  subject: Subject,
  action: MenuAction,
): Promise<ActionResult> => {
  switch (subject.kind) {
    case 'tasks':
      return performOnTasks(ctx, subject.tasks, action)
    case 'project':
      return performOnProject(ctx, subject.project, action)
    case 'section':
      return performOnSection(ctx, action)
  }
}

/**
 * A drop is a way of pointing at an edit that already exists: the intent is
 * resolved against the same layout and day the panel highlighted targets
 * with, then performed like the menu item would be.
 */
export const performDrop = async (
  ctx: ActionContext,
  task: Task,
  target: DropTarget,
): Promise<ActionResult> => {
  const intent = dropIntent(task, target, {...ctx.layout, today: ctx.today})
  switch (intent.kind) {
    case 'schedule-today':
      return performAction(ctx, {kind: 'tasks', tasks: [task]}, {type: 'schedule', kind: 'today'})
    case 'move-to-project':
      return journaled((await ctx.ports.editor.moveToProject([task], intent.path)).entry)
    case 'ask-date':
      return effect({kind: 'schedule-menu', tasks: [task]})
    default:
      return NOTHING
  }
}
