import {buildTaskTree} from './hierarchy'
import {isCalendarBlock} from './machine-note'
import {normalizeHeading} from './move'
import {compareProjects, compareUnstarted} from './order'
import {addDays} from './schedule'

import type {ClassifyConfig, ProjectGroup, ProjectMeta, Sections, Task} from './types'

export const inFolder = (filePath: string, folder: string): boolean =>
  filePath.startsWith(folder.replace(/\/$/, '') + '/')

/**
 * An inbox capture: undated, in a daily note, under the inbox heading —
 * rendered at the tail of the To-do section. Shared with dropIntent, which
 * must treat a capture's drop on To-do as inert (it already lives there).
 */
export const isInboxCapture = (
  task: {filePath: string; scheduled: string | null; due: string | null; heading: string | null},
  config: {dailyNotesFolder: string; inboxHeading: string},
): boolean =>
  task.scheduled == null &&
  task.due == null &&
  (config.dailyNotesFolder === '' || inFolder(task.filePath, config.dailyNotesFolder)) &&
  task.heading != null &&
  normalizeHeading(task.heading) === normalizeHeading(config.inboxHeading)

const isEventsHeading = (heading: string) =>
  normalizeHeading(heading).replace(/:$/, '') === 'events'

/**
 * A task can appear in more than one section (Today and its project group),
 * so each section trees its own copies — trees never share mutable children.
 */
const toTree = (tasks: Task[]): Task[] =>
  buildTaskTree(tasks.map(t => ({...t, children: []})))

const ARRIVED = 0
const RESTING = 1
const UNSTARTED = 2
const band = (group: Pick<ProjectGroup, 'urgency' | 'unstarted'>): number =>
  group.urgency === 'arrived' ? ARRIVED : group.unstarted ? UNSTARTED : RESTING

export const classifySections = (
  tasks: Task[],
  projects: ProjectMeta[],
  config: ClassifyConfig,
): Sections => {
  // '' means the vault root (the Daily Notes plugin's default location).
  const underDailyNotes = (t: Task) =>
    config.dailyNotesFolder === '' || inFolder(t.filePath, config.dailyNotesFolder)

  const isEventsBlock = (t: Task) =>
    underDailyNotes(t) && t.heading != null && isEventsHeading(t.heading)

  const visible = tasks.filter(
    t =>
      t.open &&
      t.description.trim() !== '' &&
      !isCalendarBlock(t, config) &&
      !isEventsBlock(t),
  )

  const isToday = (t: Task) =>
    t.scheduled === config.today || t.due === config.today

  const today = visible.filter(isToday)

  const inbox = visible
    .filter(t => isInboxCapture(t, config))
    .sort((a, b) => b.filePath.localeCompare(a.filePath) || a.line - b.line)

  const slippedDate = (t: Task) => t.due ?? t.scheduled ?? ''
  const isSlipped = (t: Task) =>
    !isToday(t) &&
    ((t.due != null && t.due < config.today) ||
      (t.scheduled != null && t.scheduled < config.today))
  const slipped = visible
    .filter(isSlipped)
    .sort((a, b) => slippedDate(a).localeCompare(slippedDate(b)))

  // Every dated task stays visible somewhere: future-dated tasks outside the
  // projects folder (whose groups already show them) wait here, not nowhere.
  const upcomingDate = (t: Task) => t.scheduled ?? t.due ?? ''
  const upcoming = visible
    .filter(
      t =>
        !isToday(t) &&
        !isSlipped(t) &&
        (t.scheduled != null || t.due != null) &&
        !inFolder(t.filePath, config.projectsFolder),
    )
    .sort((a, b) => upcomingDate(a).localeCompare(upcomingDate(b)))

  // Pacing is a rendering filter, not a data model: wip mode ignores the
  // deadline signal entirely, and only hybrid runs the pressing loop.
  const deadlinesOn = config.pacingMode !== 'wip'
  const pressEdge = addDays(config.today, Math.max(0, config.pressWindow))

  // One pass groups the visible tasks by note; each project then takes its
  // own list instead of filtering every task once per project.
  const byFile = new Map<string, Task[]>()
  for (const t of visible) {
    const list = byFile.get(t.filePath)
    if (list) list.push(t)
    else byFile.set(t.filePath, [t])
  }

  const projectGroups = projects
    .map(project => ({
      project,
      tasks: toTree([...(byFile.get(project.path) ?? [])].sort((a, b) => a.line - b.line)),
      // Same urgency grammar as task due chips: red is for dates that have
      // actually arrived, deadline-day included.
      urgency:
        !deadlinesOn || project.deadline == null
          ? null
          : project.deadline <= config.today
            ? ('arrived' as const)
            : ('ahead' as const),
      // Pressing (hybrid only): the project isn't `now` while the calendar
      // says it should be — its start has arrived (#22), or, for a project
      // without one, its deadline is inside the attention window. A start
      // is the answer to "when should this press"; the window is the
      // fallback for notes that don't have one. The header offers → now
      // until the user answers or refuses.
      pressing:
        config.pacingMode === 'hybrid' &&
        project.status !== 'now' &&
        (project.start != null
          ? project.start <= config.today
          : project.deadline != null && project.deadline <= pressEdge),
      // Unstarted (#22): the start is ahead and nothing declares otherwise.
      // Status wins over the date (`now` is started by declaration) and an
      // arrived deadline wins over both — a debt beats a plan. Capacity
      // mode ignores the key the way it ignores deadlines.
      unstarted:
        deadlinesOn &&
        project.start != null &&
        project.start > config.today &&
        project.status !== 'now' &&
        !(project.deadline != null && project.deadline <= config.today),
    }))
    .filter(group => group.tasks.length > 0)
    // Three bands, each edge governed by one rule (ADR-0006): arrived
    // deadlines lead, soonest first — a commitment that has come due is
    // never buried by a hand-arranged order (#20); unstarted projects tail,
    // start soonest first, regardless of rank (#22); between them the
    // resting order — ranked projects by `order`, then unranked ones under
    // the pacing rules (deadline soonest first outside wip mode, then
    // status, then name).
    .sort((a, b) => {
      const aBand = band(a)
      const bBand = band(b)
      if (aBand !== bBand) return aBand - bBand
      if (aBand === ARRIVED) {
        return (
          a.project.deadline!.localeCompare(b.project.deadline!) ||
          compareProjects(a.project, b.project, config.pacingMode)
        )
      }
      if (aBand === UNSTARTED) return compareUnstarted(a.project, b.project, config.pacingMode)
      return compareProjects(a.project, b.project, config.pacingMode)
    })

  return {
    today: toTree(today),
    slipped: toTree(slipped),
    upcoming: toTree(upcoming),
    inbox: toTree(inbox),
    projects: projectGroups,
    // Counted over rendered groups, not all project notes: a `now` note with
    // no open tasks is invisible in the panel, and a badge that includes it
    // reads as a miscount because nothing on screen accounts for it.
    wipNowCount: projectGroups.filter(g => g.project.status === 'now').length,
  }
}
