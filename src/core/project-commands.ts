import {projectDateNotice} from './labels'
import {moveWrites, movableProjects, organizeByStatus, placeWrites, topRank} from './order'
import {promotionOutcome} from './sections'

import type {ProjectDateEdit} from './labels'
import type {MoveDirection} from './order'
import type {ProjectStore} from './ports'
import type {PacingMode, ProjectGroup, ProjectMeta, ProjectStatus, Sections} from './types'

/**
 * Project commands: the frontmatter writes the panel makes to a project note
 * — status, order, the two dates — each performed as one act with its
 * consequences, through the project store. The view runs a command and
 * shows its notice; the rules live here, where they are tested.
 *
 * Two sets, one rule each: absolute ranks (a lift to the top, Organize by
 * status) are computed over every active project note, because rank is a
 * frontmatter fact about all notes — a ranked note with no open tasks is
 * invisible today but real tomorrow. Relative moves (up, down, a drop on a
 * header) are computed over the movable band as shown, because a move is
 * relative to what is on screen.
 */

export type CommandOutcome = {
  /** At least one note changed. */
  written: boolean
  /** What to tell the user, in the menu's words; null when nothing warrants it. */
  notice: string | null
}

export type StatusOutcome = CommandOutcome & {
  /** The `now` count after this commit, and whether it passed the limit (warn, never block). */
  capacity: {count: number; over: boolean} | null
}

/**
 * Commits a status. A transition to `now` also lifts the project above
 * everything (#20) — the thing just committed to is what should be seen
 * first — in the same write, and names the capacity consequence when the
 * limit is passed, whichever surface asked: the header's → now or the menu.
 */
export const commitStatus = async (
  store: ProjectStore,
  project: ProjectMeta,
  status: ProjectStatus,
  capacity: {sections: Sections | null; wipLimit: number},
): Promise<StatusOutcome> => {
  const toNow = status === 'now'
  const patch = toNow ? {status, order: topRank(store.read())} : {status}
  const written = await store.write(project.path, patch)
  if (!written) return {written, notice: null, capacity: null}
  const outcome = toNow ? promotionOutcome(capacity.sections, capacity.wipLimit) : null
  const notice =
    outcome?.over
      ? `Daily Task Panel: ${project.name} → now — now is full (${outcome.count}/${capacity.wipLimit})`
      : `Daily Task Panel: ${project.name} → ${status}`
  return {written, notice, capacity: outcome}
}

const applyOrder = async (
  store: ProjectStore,
  writes: readonly {path: string; order: number}[],
): Promise<boolean> => {
  let written = false
  for (const write of writes) written = (await store.write(write.path, {order: write.order})) || written
  return written
}

/** Move to top / up / down / bottom (#20), within the band as shown. */
export const moveProject = (
  store: ProjectStore,
  groups: readonly ProjectGroup[],
  path: string,
  direction: MoveDirection,
): Promise<boolean> => applyOrder(store, moveWrites(movableProjects(groups), path, direction))

/** A header dropped on another (#21): take its slot, by the same writer as the menu moves. */
export const placeProject = (
  store: ProjectStore,
  groups: readonly ProjectGroup[],
  path: string,
  targetPath: string,
): Promise<boolean> => applyOrder(store, placeWrites(movableProjects(groups), path, targetPath))

/**
 * Organize by status (#20): renumber every active project now → next →
 * later, keeping the current order inside each tier. Reversible by the same
 * menu, so no confirmation — the notice names what happened.
 */
export const organizeProjects = async (
  store: ProjectStore,
  pacingMode: PacingMode,
): Promise<CommandOutcome> => {
  const writes = organizeByStatus(store.read(), pacingMode)
  const written = await applyOrder(store, writes)
  return {
    written,
    notice:
      writes.length === 0
        ? 'Daily Task Panel: projects already organized by status'
        : `Daily Task Panel: organized ${writes.length} project${writes.length === 1 ? '' : 's'} by status`,
  }
}

/**
 * Sets or clears a project date (#23). Not journaled — frontmatter is its
 * own text record. A start past the deadline is written as asked — warn,
 * never block — and the notice names both dates.
 */
export const setProjectDate = async (
  store: ProjectStore,
  project: ProjectMeta,
  edit: ProjectDateEdit,
): Promise<CommandOutcome> => {
  const written = await store.write(project.path, {[edit.field]: edit.date})
  return {written, notice: written ? projectDateNotice(project, edit) : null}
}
