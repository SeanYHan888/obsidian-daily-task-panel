import type {DropTarget} from '../core/drop'
import type {VaultLayout} from '../core/layout'
import type {MenuAction, MenuRequest, SelectMenuConfig} from '../core/menus'
import type {SetupMessageKey} from '../core/setup'
import type {PacingMode, SectionKey, Sections, Subject, Task} from '../core/types'

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
export type RowMenuState = SelectMenuConfig

/** A lifted row, or a lifted project header (#21) — one drag surface, one verb. */
export type DropPayload = {kind: 'task'; task: Task} | {kind: 'project'; path: string}

export type FoldTarget = {kind: 'section'; key: SectionKey} | {kind: 'project'; path: string}

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

/**
 * The seam between the panel and its shell: four verbs, each with a data
 * argument. Buttons and chips speak the same MenuAction the menus emit;
 * which menu a surface wants is a request the grammar resolves
 * (core/menus menuFor); a drop carries either payload; a fold names its
 * target. The event rides along only where the shell needs its position
 * (a menu) or its modifiers (a jump).
 */
export type PanelCallbacks = {
  act: (subject: Subject, action: MenuAction, ev?: MouseEvent) => void
  menu: (request: MenuRequest, ev: MouseEvent) => void
  drop: (payload: DropPayload, target: DropTarget, ev: DragEvent) => void
  fold: (target: FoldTarget, folded: boolean) => void
}
