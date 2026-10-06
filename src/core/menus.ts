import {inFolder} from './classify'
import {isMachineManaged} from './machine-note'
import {canMove} from './order'
import {sectionAffordances} from './sections'
import {postponeAnchor, resolveQuickDate} from './schedule'

import type {MachineNoteConfig} from './machine-note'
import type {QuickDate, RelativeDate} from './schedule'
import type {MoveDirection} from './order'
import type {PacingMode, ProjectGroup, ProjectMeta, ProjectStatus, SectionKey, Subject, Task} from './types'

/**
 * Menus as data: core decides which items exist, what they say, and what
 * they mean; the view only turns a spec into an Obsidian Menu and dispatches
 * the chosen action. The policy (when Remove date appears, when a project can
 * be refiled) is testable here without a DOM.
 *
 * Both builders are instances of the one panel grammar (CONTEXT.md): navigate,
 * then capture/commit, then pacing, then refile, then destructive — separators
 * only between non-empty sections, first item always the jump ("Open note"),
 * destructive acts always last, and any item naming a state the thing is
 * already in marked "✓" and disabled. A row's pacing section is the two
 * labelled groups, Start and Due — the one place structure beyond separators
 * is shown, because "date" alone once named both fields.
 */

export type MenuAction =
  | {type: 'schedule'; kind: QuickDate}
  | {type: 'postpone'; kind: RelativeDate}
  | {type: 'pick-date'}
  | {type: 'remove-date'}
  | {type: 'pick-due-date'}
  | {type: 'remove-due-date'}
  | {type: 'complete'}
  | {type: 'edit-text'}
  | {type: 'move-to-project'}
  | {type: 'send-back'}
  | {type: 'cancel'}
  | {type: 'open-note'}
  | {type: 'add-task'}
  | {type: 'new-project'}
  | {type: 'rename-project'}
  | {type: 'fold-all'; folded: boolean}
  | {type: 'promote'}
  | {type: 'set-status'; status: ProjectStatus}
  | {type: 'pick-start'}
  | {type: 'clear-start'}
  | {type: 'pick-deadline'}
  | {type: 'clear-deadline'}
  | {type: 'retire'; status: 'done' | 'dropped'}
  | {type: 'toggle-select'}
  | {type: 'select'}
  | {type: 'move'; direction: MoveDirection}
  | {type: 'organize'}
  | {type: 'reschedule-all'}

export type MenuItemSpec =
  | {kind: 'item'; title: string; icon: string; action: MenuAction; disabled?: boolean}
  | {kind: 'separator'}
  /** A non-clickable group header — the row menu's Start and Due. */
  | {kind: 'label'; title: string}

const item = (
  title: string,
  icon: string,
  action: MenuAction,
  disabled = false,
): MenuItemSpec => ({kind: 'item', title, icon, action, disabled})

const separator: MenuItemSpec = {kind: 'separator'}
const label = (title: string): MenuItemSpec => ({kind: 'label', title})

const QUICK_DATES: {kind: QuickDate; title: string; icon: string}[] = [
  {kind: 'today', title: 'Today', icon: 'sun'},
  {kind: 'tomorrow', title: 'Tomorrow', icon: 'sunrise'},
  {kind: 'weekend', title: 'Weekend', icon: 'armchair'},
  {kind: 'next-week', title: 'Next week', icon: 'calendar-arrow-down'},
]

/** The relative pair reads as dates, not verbs (CONTEXT.md: Quick date). */
const RELATIVE_DATES: {kind: RelativeDate; title: string; icon: string}[] = [
  {kind: 'plus-day', title: '+1 day', icon: 'chevron-right'},
  {kind: 'plus-week', title: '+1 week', icon: 'chevrons-right'},
]

export type ScheduleMenuConfig = {projectsFolder: string; today: string}

/**
 * The start chip's menu, for one task or a bulk selection: the Start group
 * (a quick date every selected task already holds — as its start, or as a
 * deadline a start would only duplicate (#18) — is marked ✓ and disabled,
 * the same state-marking the status items use; Clear start appears once
 * anything has a start to withdraw), then the refile section — only when
 * every task lives in a project note, since a mixed selection has no one
 * source to send back from. No label: the chip already says which field.
 */
export const scheduleMenuSpec = (
  tasks: readonly Task[],
  config: ScheduleMenuConfig,
): MenuItemSpec[] => {
  const refile = bulkRefileItems(tasks, config)
  return refile.length === 0
    ? planItems(tasks, config)
    : [...planItems(tasks, config), separator, ...refile]
}

/**
 * The Start group's items: quick dates, then — for one task with something
 * to postpone (core/schedule postponeAnchor; a selection has no one anchor)
 * — the relative pair, then the picker and Clear start.
 */
const planItems = (tasks: readonly Task[], config: ScheduleMenuConfig): MenuItemSpec[] => {
  const spec: MenuItemSpec[] = QUICK_DATES.map(({kind, title, icon}) => {
    const date = resolveQuickDate(kind, config.today)
    const held = tasks.length > 0 && tasks.every(t => t.scheduled === date || t.due === date)
    return item(held ? `${title} ✓` : title, icon, {type: 'schedule', kind}, held)
  })
  const only = tasks.length === 1 ? tasks[0] : undefined
  if (only && postponeAnchor(only, config.today) != null) {
    for (const {kind, title, icon} of RELATIVE_DATES) {
      spec.push(item(title, icon, {type: 'postpone', kind}))
    }
  }
  const hasStart = tasks.some(t => t.scheduled != null)
  spec.push(item(hasStart ? 'Change start date' : 'Set start date', 'calendar', {type: 'pick-date'}))
  if (hasStart) spec.push(item('Clear start', 'eraser', {type: 'remove-date'}))
  return spec
}

const MOVE_TO_PROJECT = item('Move to project', 'folder-input', {type: 'move-to-project'})
const SEND_BACK = item('Send back to To-do', 'inbox', {type: 'send-back'})
const COMPLETE = item('Complete task', 'circle-check', {type: 'complete'})

/**
 * A selection's refile group: only when every task lives in a project note,
 * since a mixed selection has no one source to send back from (triage
 * selections get their move on the select bar instead).
 */
const bulkRefileItems = (
  tasks: readonly Task[],
  config: ScheduleMenuConfig,
): MenuItemSpec[] => {
  const fromProject =
    tasks.length > 0 && tasks.every(t => inFolder(t.filePath, config.projectsFolder))
  return fromProject ? [MOVE_TO_PROJECT, SEND_BACK] : []
}

/**
 * One row's refile group (#19): any row can be moved to a project — triage
 * from the daily note is one right-click away — then, in a selectable
 * section, "Select multiple": select more and act on them together, a refile
 * act rather than a mode switch (CONTEXT.md). A row already in a project
 * can also be sent back.
 */
const rowRefileItems = (
  task: Task,
  config: ScheduleMenuConfig & SelectMenuConfig,
): MenuItemSpec[] => {
  const spec: MenuItemSpec[] = [MOVE_TO_PROJECT]
  if (config.selectable) {
    spec.push(
      item(
        config.selected ? 'Select multiple ✓' : 'Select multiple',
        'copy-check',
        {type: 'select'},
        config.selected,
      ),
    )
  }
  if (inFolder(task.filePath, config.projectsFolder)) spec.push(SEND_BACK)
  return spec
}

/**
 * The Due group (#18), and the 📅 chip's whole menu — a chip opens what
 * edits it: one row, its own deadline, in the project menu's words (Set /
 * Clear). No quick dates — a deadline is an external fact, not a plan, so
 * it is picked, never guessed at from "weekend".
 */
export const dueMenuSpec = (task: Task): MenuItemSpec[] => {
  const spec: MenuItemSpec[] = [
    item(
      task.due == null ? 'Set due date' : 'Change due date',
      'calendar-clock',
      {type: 'pick-due-date'},
    ),
  ]
  if (task.due != null) spec.push(item('Clear due', 'eraser', {type: 'remove-due-date'}))
  return spec
}


export type SelectMenuConfig = {
  /** Whether the row's section has a select mode (To-do, Backlogs). */
  selectable: boolean
  /** Already in the selection — its Select item is ✓ and disabled. */
  selected: boolean
}

/**
 * A task row's context menu: every hover affordance again, plus the jump —
 * hover doesn't exist on mobile, so the menu is the touch-parity surface.
 * Grammar: jump and the words · check-off · [Start] and [Due] · refile ·
 * destructive. A machine-managed row keeps the jump and check-off — the
 * one edit its note survives; every other line edit would be clobbered.
 */
export const taskMenuSpec = (
  task: Task,
  config: ScheduleMenuConfig & MachineNoteConfig & SelectMenuConfig,
): MenuItemSpec[] => {
  const open = item('Open note', 'file-text', {type: 'open-note'})
  if (isMachineManaged(task.filePath, config)) return [open, separator, COMPLETE]
  return [
    open,
    item('Edit text', 'pencil', {type: 'edit-text'}),
    separator,
    COMPLETE,
    separator,
    label('Start'),
    ...planItems([task], config),
    label('Due'),
    ...dueMenuSpec(task),
    separator,
    ...rowRefileItems(task, config),
    separator,
    item('Cancel task', 'x', {type: 'cancel'}),
  ]
}

export type SectionMenuConfig = {
  /** The one global select mode's current state — either header toggles it. */
  selecting: boolean
  /** Whether this section's rows can join the selection (To-do, Projects). */
  selectable: boolean
  /** The repair queue: Overdue & slipped. */
  repairable: boolean
  /** The Backlogs: New project, Organize by status (#20), and the fold pair. */
  organizable: boolean
}

/**
 * A section header's "…" menu (#15): the header-chrome half of the panel
 * grammar — capture first (New project), then the mode toggle, then the
 * section's own acts. A section with no acts (Upcoming) gets an empty spec
 * and renders no menu at all.
 */
export const sectionMenuSpec = (config: SectionMenuConfig): MenuItemSpec[] => {
  const spec: MenuItemSpec[] = []
  if (config.organizable) spec.push(item('New project', 'folder-plus', {type: 'new-project'}))
  if (config.selectable) {
    spec.push(
      item(config.selecting ? 'Done selecting' : 'Select tasks', 'copy-check', {
        type: 'toggle-select',
      }),
    )
  }
  if (config.repairable) {
    spec.push(item('Start all today', 'sun', {type: 'reschedule-all'}))
  }
  if (config.organizable) {
    spec.push(item('Organize by status', 'arrow-down-narrow-wide', {type: 'organize'}))
    spec.push(item('Fold all', 'chevrons-down-up', {type: 'fold-all', folded: true}))
    spec.push(item('Unfold all', 'chevrons-up-down', {type: 'fold-all', folded: false}))
  }
  return spec
}

/**
 * The select bar's narrow-panel overflow: its two buttons as one menu. The
 * schedule menu already is the selection's pacing-and-refile spec; the only
 * gap is triage selections (daily-note tasks), whose move-to-project lives
 * on the bar button rather than in the refile section — so it is prepended
 * when the spec doesn't already carry it.
 */
export const selectBarMenuSpec = (
  tasks: readonly Task[],
  config: ScheduleMenuConfig,
): MenuItemSpec[] => {
  const spec = scheduleMenuSpec(tasks, config)
  const hasMove = spec.some(e => e.kind === 'item' && e.action.type === 'move-to-project')
  return hasMove
    ? spec
    : [item('Move to project', 'folder-input', {type: 'move-to-project'}), separator, ...spec]
}

const STATUS_ICON: Record<ProjectStatus, string> = {
  now: 'play',
  next: 'clock',
  later: 'moon',
}

export type ProjectMenuConfig = {
  pacingMode: PacingMode
  /** From the project's group: hybrid's calendar/commitment disagreement. */
  pressing: boolean
  /**
   * Which moves can change anything (#20): up/top need a project above,
   * down/bottom one below; an arrived deadline leads regardless of rank, so
   * both are false and the four items render disabled.
   */
  canMove: {up: boolean; down: boolean}
}

const MOVES: {direction: MoveDirection; title: string; icon: string; needs: 'up' | 'down'}[] = [
  {direction: 'top', title: 'Move to top', icon: 'arrow-up-to-line', needs: 'up'},
  {direction: 'up', title: 'Move up', icon: 'arrow-up', needs: 'up'},
  {direction: 'down', title: 'Move down', icon: 'arrow-down', needs: 'down'},
  {direction: 'bottom', title: 'Move to bottom', icon: 'arrow-down-to-line', needs: 'down'},
]

/**
 * The project lifecycle menu, in the same grammar as the task menu: the jump
 * and the name, then capture/commit (a pressing project puts "Move to now" first — the
 * touch-parity twin of the header's hover → now — and "Add task" is capture
 * straight into the backlog), then pacing (status and, outside wip mode,
 * start then deadline — the pair reads chronologically (#23), and wip has
 * no date concept to edit), then the four moves that arrange the list by
 * hand (#20), then retirement.
 */
export const projectMenuSpec = (
  project: ProjectMeta,
  config: ProjectMenuConfig,
): MenuItemSpec[] => {
  const spec: MenuItemSpec[] = [
    item('Open note', 'file-text', {type: 'open-note'}),
    item('Rename project', 'pencil', {type: 'rename-project'}),
  ]
  spec.push(separator)
  if (config.pressing) {
    spec.push(item('Move to now', 'play', {type: 'promote'}))
  }
  spec.push(item('Add task', 'plus', {type: 'add-task'}))
  spec.push(separator)
  for (const status of ['now', 'next', 'later'] as ProjectStatus[]) {
    spec.push(
      item(
        status === project.status ? `${status} ✓` : status,
        STATUS_ICON[status],
        {type: 'set-status', status},
        status === project.status,
      ),
    )
  }
  if (config.pacingMode !== 'wip') {
    spec.push(
      item(
        project.start == null ? 'Set start date' : 'Change start date',
        'calendar-days',
        {type: 'pick-start'},
      ),
    )
    if (project.start != null) {
      spec.push(item('Clear start', 'eraser', {type: 'clear-start'}))
    }
    spec.push(
      item(
        project.deadline == null ? 'Set deadline' : 'Change deadline',
        'calendar-clock',
        {type: 'pick-deadline'},
      ),
    )
    if (project.deadline != null) {
      spec.push(item('Clear deadline', 'eraser', {type: 'clear-deadline'}))
    }
  }
  spec.push(separator)
  for (const {direction, title, icon, needs} of MOVES) {
    spec.push(item(title, icon, {type: 'move', direction}, !config.canMove[needs]))
  }
  spec.push(separator)
  spec.push(item('Mark done & archive', 'check-circle', {type: 'retire', status: 'done'}))
  spec.push(item('Mark dropped & archive', 'circle-off', {type: 'retire', status: 'dropped'}))
  return spec
}

/** Which menu a surface asked for: the row, a chip, the select bar, a header. */
export type MenuRequest =
  | {kind: 'row'; task: Task; state: SelectMenuConfig}
  | {kind: 'start'; tasks: Task[]}
  | {kind: 'due'; task: Task}
  | {kind: 'selection'; tasks: Task[]}
  | {kind: 'section'; key: SectionKey; selecting: boolean}
  | {kind: 'project'; project: ProjectMeta}

/**
 * Which menu a right-click on a row opens. A selected row in a selection of
 * several speaks for the selection — every file manager's rule: the menu
 * acts on what is selected, so Move to project takes all of it, not just the
 * row under the pointer. An unselected row, or a selection of one, keeps
 * its own menu.
 */
export const rowMenuRequest = (
  task: Task,
  state: SelectMenuConfig,
  selection: readonly Task[],
): MenuRequest =>
  state.selected && selection.length > 1
    ? {kind: 'selection', tasks: [...selection]}
    : {kind: 'row', task, state}

/** The menus' slice of the world: the layout's folders and note, the projection's day and groups, the pacing mode. */
export type MenuContext = ScheduleMenuConfig &
  MachineNoteConfig & {pacingMode: PacingMode; groups: readonly ProjectGroup[]}

/**
 * One request in, one menu out — the spec to render and the subject its
 * items act on. Picking the builder and assembling its config is the
 * grammar's job, so the shell only renders.
 */
export const menuFor = (request: MenuRequest, ctx: MenuContext): {spec: MenuItemSpec[]; subject: Subject} => {
  switch (request.kind) {
    case 'row':
      return {
        spec: taskMenuSpec(request.task, {...ctx, ...request.state}),
        subject: {kind: 'tasks', tasks: [request.task]},
      }
    case 'start':
      return {spec: scheduleMenuSpec(request.tasks, ctx), subject: {kind: 'tasks', tasks: request.tasks}}
    case 'due':
      return {spec: dueMenuSpec(request.task), subject: {kind: 'tasks', tasks: [request.task]}}
    case 'selection':
      return {spec: selectBarMenuSpec(request.tasks, ctx), subject: {kind: 'tasks', tasks: request.tasks}}
    case 'section':
      return {
        spec: sectionMenuSpec({selecting: request.selecting, ...sectionAffordances(request.key)}),
        subject: {kind: 'section', key: request.key},
      }
    case 'project': {
      const group = ctx.groups.find(g => g.project.path === request.project.path)
      return {
        spec: projectMenuSpec(request.project, {
          pacingMode: ctx.pacingMode,
          pressing: group?.pressing ?? false,
          canMove: canMove(ctx.groups, request.project.path),
        }),
        subject: {kind: 'project', project: request.project},
      }
    }
  }
}
