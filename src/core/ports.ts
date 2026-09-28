import type {JournalEntry} from './journal'
import type {VaultLayout} from './layout'
import type {TaskEdit} from './note-edit'
import type {ProjectMeta, ProjectPatch, Task} from './types'

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
  /**
   * One frontmatter write: every key in the patch lands in the same edit
   * (null clears). What to write, and with what consequence, is decided in
   * core/project-commands.ts.
   */
  write(path: string, patch: ProjectPatch): Promise<boolean>
  /** Terminal statuses move the note to the archive; task lines are never touched. */
  archive(path: string, status: 'done' | 'dropped'): Promise<boolean>
  /** Returns the created (or existing same-name) note's path, or null. */
  create(name: string, today: string): Promise<string | null>
  /** Renames the note in place (links follow); returns the new path, or null. */
  rename(path: string, name: string): Promise<string | null>
}

export type EditOutcome = {
  entry: JournalEntry | null
  /** Lines that no longer read what was selected (or whose note is gone): skipped, never guessed at. */
  stale: number
}

export type MoveOutcome = {
  entry: JournalEntry | null
  /** Blocks landed and cut. */
  moved: number
  /** Blocks landed but not cut — the source changed mid-move; originals remain. */
  duplicated: number
  /** Tasks not moved: stale, or already in the target note. */
  skipped: number
  /** The target note has no such heading and it may not be created. */
  headingMissing: boolean
  /** Where the tasks were to land; missing means nothing happened. */
  target: {path: string; missing: boolean}
}

export type AddOutcome = {entry: JournalEntry | null; target: {path: string; missing: boolean}}

/**
 * Every task-line write except completion. Each edit verifies the line
 * against the task's read-time fingerprint (`sourceLine`) — stale lines are
 * skipped and reported, never guessed at — and changed lines come back as a
 * journal entry so the action can be undone. The text rules live in
 * core/note-edit.ts; the adapter is the file lookup around them. Outcomes
 * carry counts, not notices: the words are the actions module's.
 */
export type LineEditor = {
  /** One per-line edit (core/note-edit.ts TaskEdit) over the tasks, one write per note. */
  edit(tasks: Task[], edit: TaskEdit): Promise<EditOutcome>
  moveToProject(tasks: Task[], projectPath: string): Promise<MoveOutcome>
  /** Into today's daily note under the inbox heading — the layout says which note. */
  sendBackToInbox(tasks: Task[], today: string): Promise<MoveOutcome>
  /** Appends one new task line under the project's move-target heading. */
  addTask(projectPath: string, text: string): Promise<AddOutcome>
}

export type Ports = {
  tasks: TaskSource
  projects: ProjectStore
  editor: LineEditor
  /** Where things live, as of now (core/layout.ts) — the one rule every port and projection shares. */
  layout(): VaultLayout
}
