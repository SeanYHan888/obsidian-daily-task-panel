import type {HierarchyItem} from './hierarchy'

/** One markdown checkbox line, as projected through the task-source port. */
export type Task = HierarchyItem & {
  description: string
  /**
   * The exact markdown of the line at read time — the line editor's write
   * fingerprint (a line that no longer matches is stale and gets skipped,
   * never guessed at). Write-contract state, not task identity: no core
   * function reads it.
   */
  sourceLine: string
  /** TODO or IN_PROGRESS — done and cancelled tasks are not open. */
  open: boolean
  /** ⏳ the day the user plans to work on it (ISO date), or null. */
  scheduled: string | null
  /** 📅 a real external deadline (ISO date), or null. */
  due: string | null
  /** Text of the nearest heading above the task, without `#` marks. */
  heading: string | null
  children: Task[]
}

export type ProjectStatus = 'now' | 'next' | 'later'

export type ProjectMeta = {
  path: string
  name: string
  status: ProjectStatus | null
  /** Project-level commitment date from frontmatter (ISO), or null. Distinct from a task's due (📅) field. */
  deadline: string | null
  /** Manual rank from frontmatter (#20): ranked projects lead the Backlogs, ascending. Null = unranked. */
  order: number | null
  /**
   * Project-level start date from frontmatter (ISO), or null (#22) — the
   * twin of a task's ⏳, the way deadline twins 📅. Ahead of today it makes
   * the project unstarted; arrived, it is what makes hybrid mode press.
   */
  start: string | null
}

/** The frontmatter keys the panel writes (ADR-0004's list); null clears a key. */
export type ProjectPatch = {
  status?: ProjectStatus
  deadline?: string | null
  start?: string | null
  order?: number | null
}

export type ProjectGroup = {
  project: ProjectMeta
  tasks: Task[]
  /** 'ahead' (amber) until the deadline, 'arrived' (red) from that day on, null when undated or in wip mode. */
  urgency: 'ahead' | 'arrived' | null
  /**
   * Hybrid mode's reconciliation signal: the deadline is inside the attention
   * window but the project isn't `now` — the calendar and the commitments
   * disagree, so the header offers → now. Always false outside hybrid.
   */
  pressing: boolean
  /**
   * The start is still ahead and the status isn't `now` (#22): the project
   * tails the Backlogs regardless of rank, never presses, and can't be
   * moved. An arrived deadline outranks the start (a debt beats a plan), and
   * capacity mode ignores the key, so both leave this false.
   */
  unstarted: boolean
}

/**
 * Which pacing signals the panel renders and acts on. Pure filter: deadlines
 * and statuses live in frontmatter regardless, so switching is lossless.
 * 'hybrid' (the default) shows both and adds the pressing loop.
 */
export type PacingMode = 'wip' | 'deadline' | 'hybrid'

export type ClassifyConfig = {
  /** ISO date injected by the caller — core never reads the clock. */
  today: string
  dailyNotesFolder: string
  projectsFolder: string
  /** The machine-managed note (see core/machine-note.ts), or '' when none. */
  machineNotePath: string
  /** Heading text without `#` marks; capture outside it is not the panel's business. */
  inboxHeading: string
  pacingMode: PacingMode
  /** Days before a deadline that hybrid mode starts pressing; 0 waits for arrival. */
  pressWindow: number
}

export type Sections = {
  today: Task[]
  slipped: Task[]
  /** Future-dated tasks outside the projects folder — visible while they wait. */
  upcoming: Task[]
  inbox: Task[]
  projects: ProjectGroup[]
  /** Rendered project groups with status `now`, for the WIP badge. */
  wipNowCount: number
}
