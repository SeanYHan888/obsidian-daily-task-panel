import type {PacingMode, ProjectGroup, ProjectMeta, ProjectStatus} from './types'

/**
 * Manual project order (#20): an integer `order` in the project note's
 * frontmatter, read like status and deadline. This module is the arithmetic
 * — which notes to write and with what — so the view only executes writes.
 *
 * Sort contract (shared with classify): ranked projects lead, by `order`
 * ascending; unranked ones follow under the pacing rules (deadline soonest
 * first outside capacity mode, then now → next → later, then name). The
 * bands at either edge — arrived deadlines leading, unstarted projects
 * tailing (#22) — are classify's; this module orders within a band.
 */

export type OrderWrite = {path: string; order: number}

export type MoveDirection = 'top' | 'up' | 'down' | 'bottom'

/** Sorts after every real ISO date, so undated projects follow dated ones. */
const NO_DEADLINE = '9999-99-99'

const statusRank = (status: ProjectStatus | null): number =>
  status === 'now' ? 0 : status === 'next' ? 1 : status === 'later' ? 2 : 3

/** The pacing rules alone — how unranked projects (and ties) are ordered. */
const comparePacing = (a: ProjectMeta, b: ProjectMeta, pacingMode: PacingMode): number => {
  const deadlinesOn = pacingMode !== 'wip'
  const aDeadline = deadlinesOn ? (a.deadline ?? NO_DEADLINE) : NO_DEADLINE
  const bDeadline = deadlinesOn ? (b.deadline ?? NO_DEADLINE) : NO_DEADLINE
  return (
    aDeadline.localeCompare(bDeadline) ||
    statusRank(a.status) - statusRank(b.status) ||
    a.name.localeCompare(b.name)
  )
}

/**
 * The unstarted tail's order (#22): start soonest first, then the pacing
 * rules. A manual rank does not reach into this band — the tail is where
 * the calendar has put a project, not the hand.
 */
export const compareUnstarted = (a: ProjectMeta, b: ProjectMeta, pacingMode: PacingMode): number =>
  (a.start ?? '').localeCompare(b.start ?? '') || comparePacing(a, b, pacingMode)

/**
 * The movable band (#22): which projects the four Move items and a header
 * drag may touch — the Backlogs as displayed minus the two edge bands. An
 * arrived deadline leads by rule, an unstarted project tails by rule, so
 * neither lifts, lands, nor moves. Menu gating and the drag list both read
 * this one definition.
 */
export const movableProjects = (groups: readonly ProjectGroup[]): ProjectMeta[] =>
  groups.filter(g => g.urgency !== 'arrived' && !g.unstarted).map(g => g.project)

/**
 * Which moves can change anything for one project (#20): up/top need a
 * project above it in the movable band, down/bottom one below. Outside the
 * band (arrived, unstarted) both are false and the four Move items render
 * disabled.
 */
export const canMove = (
  groups: readonly ProjectGroup[],
  path: string,
): {up: boolean; down: boolean} => {
  const band = movableProjects(groups)
  const at = band.findIndex(p => p.path === path)
  return {up: at > 0, down: at !== -1 && at < band.length - 1}
}

/** Ranked first by `order`, then the pacing rules — the Backlogs' resting order. */
export const compareProjects = (a: ProjectMeta, b: ProjectMeta, pacingMode: PacingMode): number => {
  const aRanked = a.order != null
  const bRanked = b.order != null
  if (aRanked !== bRanked) return aRanked ? -1 : 1
  if (a.order != null && b.order != null && a.order !== b.order) return a.order - b.order
  return comparePacing(a, b, pacingMode)
}

const ranks = (projects: readonly ProjectMeta[]): number[] =>
  projects.map(p => p.order).filter((o): o is number => o != null)

/**
 * The rank that puts a project above every other — what a transition to
 * `now` writes, and what Move to top writes. Zero when nothing is ranked yet.
 */
export const topRank = (projects: readonly ProjectMeta[]): number => {
  const held = ranks(projects)
  return held.length === 0 ? 0 : Math.min(...held) - 1
}

/**
 * Writes that make `sequence` the displayed order, touching as few notes as
 * possible: walk it keeping every rank that is still strictly increasing,
 * and re-stamp only the ones that aren't (or were never set). Every item up
 * to the last ranked one is visited, so a re-stamp can't collide with a
 * rank further down.
 */
const settle = (sequence: readonly ProjectMeta[], through: number): OrderWrite[] => {
  const lastRanked = sequence.reduce((last, p, i) => (p.order != null ? i : last), -1)
  const end = Math.max(through, lastRanked)
  const writes: OrderWrite[] = []
  let prev = -Infinity
  for (let i = 0; i <= end; i++) {
    const project = sequence[i]
    if (!project) break
    if (project.order != null && project.order > prev) {
      prev = project.order
      continue
    }
    prev = prev === -Infinity ? 0 : prev + 1
    writes.push({path: project.path, order: prev})
  }
  return writes
}

/**
 * Moves one project within the movable band (movableProjects). Returns the
 * frontmatter writes, none when the move changes nothing. Top is one write
 * (min − 1); the rest re-stamp only what the new sequence needs, so
 * unranked neighbours get a rank on demand.
 */
export const moveWrites = (
  displayed: readonly ProjectMeta[],
  path: string,
  direction: MoveDirection,
): OrderWrite[] => {
  const index = displayed.findIndex(p => p.path === path)
  if (index === -1) return []
  const last = displayed.length - 1
  if (direction === 'top') {
    return index === 0 ? [] : [{path, order: topRank(displayed)}]
  }
  if (direction === 'bottom') {
    if (index === last) return []
    const sequence = [...displayed.slice(0, index), ...displayed.slice(index + 1), displayed[index]]
    return settle(sequence, last)
  }
  const other = direction === 'up' ? index - 1 : index + 1
  if (other < 0 || other > last) return []
  const sequence = [...displayed]
  ;[sequence[index], sequence[other]] = [sequence[other], sequence[index]]
  return settle(sequence, Math.max(index, other))
}

/**
 * Organize by status: renumber every active project 1..n grouped
 * now → next → later (unset status last), keeping the current resting order
 * inside each tier — so the act regroups, never scrambles, and running it
 * twice writes nothing. Hidden projects (no open tasks) are ranked too, so a
 * project keeps its place when it reappears.
 */
export const organizeByStatus = (
  projects: readonly ProjectMeta[],
  pacingMode: PacingMode,
): OrderWrite[] => {
  const sequence = [...projects].sort(
    (a, b) => statusRank(a.status) - statusRank(b.status) || compareProjects(a, b, pacingMode),
  )
  return sequence
    .map((project, i) => ({path: project.path, order: i + 1}))
    .filter(write => sequence[write.order - 1].order !== write.order)
}

/**
 * Whether dropping `path` on `target` can change anything (#21): both must
 * be in the movable band (movableProjects) and differ.
 */
export const canPlace = (displayed: readonly ProjectMeta[], path: string, target: string): boolean =>
  path !== target &&
  displayed.some(p => p.path === path) &&
  displayed.some(p => p.path === target)

/**
 * Where a dragged header would land relative to the target (#21): before it
 * dragging up, after it dragging down — the rule placeWrites encodes, so the
 * highlight and the write agree. Null when the drop would change nothing.
 */
export const placementEdge = (
  displayed: readonly ProjectMeta[],
  path: string,
  target: string,
): 'before' | 'after' | null => {
  if (!canPlace(displayed, path, target)) return null
  const from = displayed.findIndex(p => p.path === path)
  const to = displayed.findIndex(p => p.path === target)
  return from < to ? 'after' : 'before'
}

/**
 * Drag-to-reorder (#21): the dragged project takes the target's slot —
 * dragging up lands it before the target, dragging down lands it after,
 * the way every list drag reads. Same writer as the menu moves: landing
 * first is one write (min − 1), anything else re-stamps only what the new
 * sequence needs.
 */
export const placeWrites = (
  displayed: readonly ProjectMeta[],
  path: string,
  target: string,
): OrderWrite[] => {
  if (!canPlace(displayed, path, target)) return []
  const from = displayed.findIndex(p => p.path === path)
  const to = displayed.findIndex(p => p.path === target)
  if (to === 0) return [{path, order: topRank(displayed)}]
  const moved = displayed[from]
  const rest = displayed.filter(p => p.path !== path)
  const sequence = [...rest.slice(0, to), moved, ...rest.slice(to)]
  return settle(sequence, Math.max(from, to))
}
