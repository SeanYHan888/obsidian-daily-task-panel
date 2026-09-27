import type {JournalEntry} from './journal'
import type {VaultLayout} from './layout'
import type {ProjectMeta, ProjectStatus, Task} from './types'

/**
 * What the core needs from the outside world, as three narrow contracts
 * (ADR-0004). One adapter each — the port's value is the named surface and
 * the single place vendor internals live, not hypothetical substitution.
 * Every port returns live projections and edits source lines in place:
 * nothing caches tasks or mints identifiers (ADR-0001). The clock is not a
 * port — `today` is an injected value everywhere.
 */

/** Where tasks come from and how they complete. The one adapter wraps the Tasks plugin; its object shapes, plugin id, and event names stay behind this seam. */
export type TaskSource = {
  /** Absence is a first-class state the panel explains, never an error. */
  available(): boolean
  read(): Task[]
  /** Completion goes through the source of truth or not at all (ADR-0001). */
  toggle(task: Task): Promise<void>
  /** Fires when the source's projection may have changed; returns unsubscribe. */
  onChange(listener: () => void): () => void
}

/** Project notes: frontmatter reads and writes, lifecycle, creation. */
export type ProjectStore = {
  read(): ProjectMeta[]
  /**
   * Fires when the projects' projection may have changed — a note in the
   * projects folder edited, created, renamed or deleted; returns unsubscribe.
   * Task lines are the task source's signal; this one is for frontmatter and
   * the folder's shape.
   */
  onChange(listener: () => void): () => void
  setStatus(path: string, status: ProjectStatus): Promise<boolean>
  setDeadline(path: string, deadline: string | null): Promise<boolean>
  /** Project start (#23); null clears it. */
  setStart(path: string, start: string | null): Promise<boolean>
  /** Manual rank (#20); null clears it. */
  setOrder(path: string, order: number | null): Promise<boolean>
  /** Terminal statuses move the note to the archive; task lines are never touched. */
  archive(path: string, status: 'done' | 'dropped'): Promise<boolean>
  /** Returns the created (or existing same-name) note's path, or null. */
  create(name: string, today: string): Promise<string | null>
  /** Renames the note in place (links follow); returns the new path, or null. */
  rename(path: string, name: string): Promise<string | null>
}

export type MoveOutcome = {moved: number; entry: JournalEntry | null}

/**
 * Every task-line write except completion. Each edit verifies the line
 * against the task's read-time fingerprint (`sourceLine`) — stale lines are
 * skipped and reported, never guessed at — and changed lines come back as a
 * journal entry so the action can be undone.
 */
export type LineEditor = {
  /** Stamps the plan; `today` decides whether a 📅 is live or spent (see setScheduled). */
  reschedule(tasks: Task[], date: string, today: string): Promise<JournalEntry | null>
  unschedule(tasks: Task[]): Promise<JournalEntry | null>
  /** The 📅 field's own writers (#18) — scheduling never touches a live deadline. */
  setDue(tasks: Task[], date: string): Promise<JournalEntry | null>
  clearDue(tasks: Task[]): Promise<JournalEntry | null>
  cancel(task: Task): Promise<JournalEntry | null>
  /** Swaps the task's words; checkbox, dates and block reference stay. */
  editText(task: Task, text: string): Promise<JournalEntry | null>
  moveToProject(tasks: Task[], projectPath: string): Promise<MoveOutcome>
  /** Into today's daily note under the inbox heading — the layout says which note. */
  sendBackToInbox(tasks: Task[], today: string): Promise<MoveOutcome>
  /** Appends one new task line under the project's move-target heading. */
  addTask(projectPath: string, text: string): Promise<JournalEntry | null>
}

export type Ports = {
  tasks: TaskSource
  projects: ProjectStore
  editor: LineEditor
  /** Where things live, as of now (core/layout.ts) — the one rule every port and projection shares. */
  layout(): VaultLayout
}
