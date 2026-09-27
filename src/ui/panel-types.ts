import type {SectionKey} from '../settings'
import type {DropTarget} from '../core/drop'
import type {VaultLayout} from '../core/layout'
import type {QuickDate} from '../core/schedule'
import type {SetupMessageKey} from '../core/setup'
import type {PacingMode, ProjectMeta, Sections, Task} from '../core/types'

export type PanelData = {
  sections: Sections | null
  /** Environment message keys (core/setup.ts); the panel renders them as copy. */
  setup: SetupMessageKey[]
  today: string
  wipLimit: number
  collapsed: Partial<Record<SectionKey, boolean>>
  /** Folded project groups, keyed by project note path. */
  collapsedProjects: Record<string, boolean>
  /** Rows can be dragged to section and project headers (desktop only). */
  draggable: boolean
  /** Where things live, as of this projection (core/layout.ts): drop validity, the read-only guard, the empty-state copy. */
  layout: VaultLayout
  /** Which pacing signals to render: wip hides chips, deadline hides the badge. */
  pacingMode: PacingMode
}

/** What only the row knows when its menu opens (#19): the select state. */
export type RowMenuState = {
  /** The row's section has a select mode (To-do, Backlogs). */
  selectable: boolean
  selected: boolean
}

/** Everything a task row needs regardless of which section rendered it. */
export type RowContext = {
  today: string
  machineNotePath: string
  /** Desktop drag: rows lift, headers catch. The drag state lives in the panel. */
  draggable: boolean
  onDragStart: (task: Task) => void
  onDragEnd: () => void
  callbacks: PanelCallbacks
}

export type PanelCallbacks = {
  onToggleTask: (task: Task) => void
  /** The MouseEvent carries the open modifiers (mod+click → new tab, etc.). */
  onOpenTask: (task: Task, ev?: MouseEvent) => void
  onOpenFile: (path: string, ev?: MouseEvent) => void
  onCollapse: (key: SectionKey, collapsed: boolean) => void
  /** Header click: fold, or jump to the note when the open-modifier is held. */
  onProjectToggle: (path: string, folded: boolean, ev: MouseEvent) => void
  /** Opens the quick-date menu (today / tomorrow / weekend / pick) at the event. */
  onScheduleMenu: (task: Task, ev: MouseEvent) => void
  /** The 📅 chip's menu (#18): pick or remove the due date — never the plan. */
  onDueMenu: (task: Task, ev: MouseEvent) => void
  /** The row's context menu: every hover affordance, for right-click and touch. */
  onRowMenu: (task: Task, ev: MouseEvent, row: RowMenuState) => void
  onSchedule: (task: Task, kind: QuickDate) => void
  onPickDate: (task: Task) => void
  onCancelTask: (task: Task) => void
  /** A section header's "…" menu; `selecting` labels the toggle-select item. */
  onSectionMenu: (key: SectionKey, selecting: boolean, ev: MouseEvent) => void
  /** Triage: open the project picker for the selected inbox tasks. */
  onBulkMove: (tasks: Task[]) => void
  onBulkScheduleMenu: (tasks: Task[], ev: MouseEvent) => void
  /** Narrow panels: the select bar's two buttons folded into one "…" menu. */
  onBulkActionsMenu: (tasks: Task[], ev: MouseEvent) => void
  /** A drop names an existing edit; core resolves which one (dropIntent). */
  onDrop: (task: Task, target: DropTarget, ev: DragEvent) => void
  /** A project header dropped on another (#21): take its slot (core/order placeWrites). */
  onReorderProject: (path: string, targetPath: string) => void
  /** Project lifecycle menu: status now/next/later, done/dropped + archive. */
  onProjectMenu: (project: ProjectMeta, ev: MouseEvent) => void
  /** The deadline chip's act — a chip opens what edits it (panel grammar). */
  onProjectDeadline: (project: ProjectMeta) => void
  /** The start chip's act (#24): the start picker, by the same rule. */
  onProjectStart: (project: ProjectMeta) => void
  /** The pressing loop's one tap: commit a pressing project to `now`. */
  onPromoteProject: (project: ProjectMeta) => void
}
