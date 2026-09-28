import {countTaskTree, flattenTaskTree, locationKey} from './hierarchy'

import type {PacingMode, ProjectGroup, ProjectMeta, SectionKey, Sections, Task} from './types'

/**
 * Queries over a classified Sections projection — the questions the panel
 * asks after classifySections has answered "what goes where". All pure, all
 * testable through the same fixtures the classify suite already builds.
 */

export type SectionAffordances = {
  /** Rows can join the selection (To-do with its inbox tail, the Backlogs). */
  selectable: boolean
  /** The repair queue: Overdue & slipped carries Start all today. */
  repairable: boolean
  /** The Backlogs: New project, Organize by status, the fold pair. */
  organizable: boolean
  /** A dropped row lands here: To-do stamps today, Upcoming asks for a date. */
  droppable: boolean
}

/**
 * What each section offers — which rows select, which headers carry which
 * acts (#15), which sections catch a dropped row — stated once, read by the
 * menu grammar and the Panel alike.
 */
export const sectionAffordances = (key: SectionKey): SectionAffordances => ({
  selectable: key === 'today' || key === 'projects',
  repairable: key === 'slipped',
  organizable: key === 'projects',
  droppable: key === 'today' || key === 'upcoming',
})

/** Every task a selection can span: To-do, its inbox tail, and the backlogs. */
export const selectionSpan = (sections: Sections | null): Task[] =>
  sections
    ? [
        ...flattenTaskTree(sections.today),
        ...flattenTaskTree(sections.inbox),
        ...sections.projects.flatMap(g => flattenTaskTree(g.tasks)),
      ]
    : []

/**
 * The selected tasks, one per location. A task dated today renders in both
 * To-do and its project group; deduping by location key is the invariant
 * that a bulk action never edits the same line twice.
 */
export const selectionTasks = (
  sections: Sections | null,
  selectedKeys: ReadonlySet<string>,
): Task[] => {
  const byKey = new Map<string, Task>()
  for (const t of selectionSpan(sections)) {
    const key = locationKey(t.filePath, t.line)
    if (selectedKeys.has(key) && !byKey.has(key)) byKey.set(key, t)
  }
  return [...byKey.values()]
}

/** Keeps only keys whose line still exists in the fresh projection. */
export const pruneSelection = (
  sections: Sections | null,
  selectedKeys: ReadonlySet<string>,
): Set<string> => {
  const valid = new Set(selectionSpan(sections).map(t => locationKey(t.filePath, t.line)))
  return new Set([...selectedKeys].filter(k => valid.has(k)))
}

export type SectionCounts = {
  today: number
  slipped: number
  upcoming: number
  inbox: number
  projects: number
}

export const sectionCounts = (sections: Sections | null): SectionCounts => ({
  today: sections ? countTaskTree(sections.today) : 0,
  slipped: sections ? countTaskTree(sections.slipped) : 0,
  upcoming: sections ? countTaskTree(sections.upcoming) : 0,
  inbox: sections ? countTaskTree(sections.inbox) : 0,
  projects: sections
    ? sections.projects.reduce((sum, g) => sum + countTaskTree(g.tasks), 0)
    : 0,
})

/**
 * Whether a project group renders folded (#24): a stored toggle wins, and
 * with none stored an unstarted project folds — a 12-part course is not 12
 * open task lists — while a started one opens. On the start day, then, a
 * project nobody has touched opens by itself.
 */
export const projectFolded = (
  collapsedProjects: Record<string, boolean>,
  group: Pick<ProjectGroup, 'unstarted'> & {project: Pick<ProjectMeta, 'path'>},
): boolean => collapsedProjects[group.project.path] ?? group.unstarted

export type WipBadge = {
  label: string
  /** Exceeding the limit warns (red), never blocks. */
  danger: boolean
}

/** The capacity signal — deadline mode shows one pacing signal, so no badge. */
export const wipBadge = (
  sections: Sections | null,
  wipLimit: number,
  pacingMode: PacingMode,
): WipBadge | null =>
  pacingMode !== 'deadline' && sections && sections.wipNowCount > 0
    ? {
        label: `now ${sections.wipNowCount}/${wipLimit}`,
        danger: sections.wipNowCount > wipLimit,
      }
    : null

export type PromotionOutcome = {
  /** The `now` count after this promotion lands. */
  count: number
  /** Past the limit: allowed (warn never block), but the notice names it. */
  over: boolean
}

/** What promoting one more project to `now` does to capacity. */
export const promotionOutcome = (
  sections: Sections | null,
  wipLimit: number,
): PromotionOutcome => {
  const count = (sections?.wipNowCount ?? 0) + 1
  return {count, over: count > wipLimit}
}

export type RetirePlan = {
  openCount: number
  /** Open tasks leave the panel with the note, so they confirm first. */
  needsConfirm: boolean
}

export const retirePlan = (sections: Sections | null, projectPath: string): RetirePlan => {
  const group = sections?.projects.find(g => g.project.path === projectPath)
  const openCount = group ? flattenTaskTree(group.tasks).length : 0
  return {openCount, needsConfirm: openCount > 0}
}

/**
 * Fold all / Unfold all: one explicit toggle per rendered project (#24's
 * rule — the default depends on the project, so an unfold must be stored),
 * over whatever toggles already exist.
 */
export const foldToggles = (
  groups: readonly {project: Pick<ProjectMeta, 'path'>}[],
  folded: boolean,
  current: Record<string, boolean>,
): Record<string, boolean> => ({
  ...current,
  ...Object.fromEntries(groups.map(g => [g.project.path, folded])),
})

/** A renamed project keeps its fold toggle: the key follows the note to its new path. */
export const carryFoldToggle = (
  current: Record<string, boolean>,
  from: string,
  to: string,
): Record<string, boolean> => {
  const {[from]: folded, ...rest} = current
  return folded == null ? rest : {...rest, [to]: folded}
}
