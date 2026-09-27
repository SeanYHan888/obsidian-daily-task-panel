import {ItemView, Keymap, Menu, Notice, Platform, TFile, debounce} from 'obsidian'
import {mount, unmount} from 'svelte'

import Panel from './ui/Panel.svelte'
import {askDate, askText, confirm, pickProject} from './ui/prompts'
import {createPorts, gatherSetupFacts} from './adapters/compose'
import {classifySections} from './core/classify'
import {setupState} from './core/setup'
import {dropIntent} from './core/drop'
import {flattenTaskTree} from './core/hierarchy'
import {EMPTY_LAYOUT} from './core/layout'
import {editableTasks} from './core/machine-note'
import {
  dueMenuSpec,
  projectMenuSpec,
  scheduleMenuSpec,
  sectionMenuSpec,
  selectBarMenuSpec,
  taskMenuSpec,
} from './core/menus'
import {canMove} from './core/order'
import {
  commitStatus,
  moveProject as moveProjectCommand,
  organizeProjects as organizeProjectsCommand,
  placeProject as placeProjectCommand,
  setProjectDate,
} from './core/project-commands'
import {postponeAnchor, resolveQuickDate, resolveRelativeDate, taskWords} from './core/schedule'
import {carryFoldToggle, foldToggles, retirePlan} from './core/sections'

import type {WorkspaceLeaf} from 'obsidian'
import type {DropTarget} from './core/drop'
import type {JournalEntry} from './core/journal'
import type {VaultLayout} from './core/layout'
import type {ProjectDateEdit} from './core/labels'
import type {MenuAction, MenuItemSpec} from './core/menus'
import type {MoveDirection} from './core/order'
import type {Ports} from './core/ports'
import type {QuickDate, RelativeDate} from './core/schedule'
import type {ProjectMeta, ProjectStatus, Sections, Task} from './core/types'
import type {PanelData, RowMenuState} from './ui/panel-types'
import type {SectionKey, PanelSettings} from './settings'

export const VIEW_TYPE = 'daily-task-panel'

/** The mounted panel's exported seams. */
type PanelHandle = {
  update: (data: PanelData) => void
  toggleSelectMode: () => void
  selectTask: (task: Task) => void
}

/**
 * What the view needs from the plugin shell — a narrow slice, so the view
 * depends on a contract instead of importing the plugin class back (no
 * module cycle with main.ts).
 */
export type PanelServices = {
  readonly settings: PanelSettings
  /** A setting the projection depends on: saved, then every view reprojects. */
  updateSettings(updates: Partial<PanelSettings>): Promise<void>
  /** Collapse and fold state: saved, then every view repaints — no vault read. */
  updateUiState(updates: Partial<PanelSettings>): Promise<void>
  pushJournal(entry: JournalEntry): void
  undo(entry?: JournalEntry): Promise<void>
}

const localToday = (): string => {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export class PanelView extends ItemView {
  private panel: PanelHandle | null = null
  private lastToday = localToday()
  private lastSections: Sections | null = null
  /** A projection was asked for while the panel was hidden; it runs on reveal. */
  private staleWhileHidden = false
  /**
   * The projection scheduler: every trigger — the task source's signal, a
   * metadata change, a write of our own — funnels into one trailing
   * debounce. Nothing reprojects right after its own write: the caches the
   * projection reads (the Tasks plugin's, the metadata cache) update after
   * the file does, so an immediate read is stale by construction and the
   * signal that follows is the refresh that counts.
   */
  private readonly scheduleRefresh = debounce(() => this.refresh(), 350, true)
  /** The layout the last projection was built on — drops resolve against it, not a fresh read. */
  private lastLayout: VaultLayout = EMPTY_LAYOUT
  private portsCache: Ports | null = null

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: PanelServices,
  ) {
    super(leaf)
  }

  /** The composition root's object graph, wired once per view. */
  private get ports(): Ports {
    return (this.portsCache ??= createPorts(this.app, () => this.plugin.settings))
  }

  getViewType(): string {
    return VIEW_TYPE
  }

  getDisplayText(): string {
    return 'Daily Task Panel'
  }

  getIcon(): string {
    return 'list-checks'
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty()
    this.panel = mount(Panel, {
      target: this.contentEl,
      props: {
        callbacks: {
          onToggleTask: (task: Task) => void this.toggle(task),
          onOpenTask: (task: Task, ev?: MouseEvent) =>
            void this.openFile(task.filePath, task.line, ev),
          onOpenFile: (path: string, ev?: MouseEvent) => void this.openFile(path, undefined, ev),
          onCollapse: (key: SectionKey, collapsed: boolean) =>
            void this.setCollapsed(key, collapsed),
          onProjectToggle: (path: string, folded: boolean, ev: MouseEvent) =>
            Keymap.isModEvent(ev)
              ? void this.openFile(path, undefined, ev)
              : void this.setProjectCollapsed(path, !folded),
          onScheduleMenu: (task: Task, ev: MouseEvent) =>
            this.showScheduleMenu([task], ev),
          onDueMenu: (task: Task, ev: MouseEvent) => this.showDueMenu(task, ev),
          onRowMenu: (task: Task, ev: MouseEvent, row: RowMenuState) =>
            this.showRowMenu(task, ev, row),
          onSchedule: (task: Task, kind: QuickDate) =>
            void this.reschedule([task], resolveQuickDate(kind, localToday())),
          onPickDate: (task: Task) => void this.pickDate([task]),
          onCancelTask: (task: Task) => void this.cancel(task),
          onSectionMenu: (key: SectionKey, selecting: boolean, ev: MouseEvent) =>
            this.showSectionMenu(key, selecting, ev),
          onBulkMove: (tasks: Task[]) => void this.bulkMove(tasks),
          onBulkScheduleMenu: (tasks: Task[], ev: MouseEvent) =>
            this.showScheduleMenu(tasks, ev),
          onBulkActionsMenu: (tasks: Task[], ev: MouseEvent) =>
            this.runMenu(selectBarMenuSpec(tasks, this.menuConfig()), ev, action =>
              this.dispatchTaskAction(tasks, action, ev),
            ),
          onDrop: (task: Task, target: DropTarget, ev: DragEvent) =>
            this.handleDrop(task, target, ev),
          onReorderProject: (path: string, targetPath: string) =>
            void this.placeProject(path, targetPath),
          onProjectMenu: (project: ProjectMeta, ev: MouseEvent) =>
            this.showProjectMenu(project, ev),
          onProjectDeadline: (project: ProjectMeta) =>
            void this.pickProjectDate(project, 'deadline'),
          onProjectStart: (project: ProjectMeta) => void this.pickProjectDate(project, 'start'),
          onPromoteProject: (project: ProjectMeta) => void this.promote(project),
        },
      },
    }) as unknown as PanelHandle

    // Each source owns its own change signal: task lines from the task
    // source, project frontmatter and the folder's shape from the project
    // store. Typing in any other note costs no projection.
    this.register(this.ports.tasks.onChange(this.scheduleRefresh))
    this.register(this.ports.projects.onChange(this.scheduleRefresh))
    // Reveal has no event of its own: a sidebar expanding is a workspace
    // resize (measured — neither layout-change nor the view's own onResize
    // fires), a tab switch an active-leaf change. The check is deferred a
    // tick so the element has settled into shown.
    this.registerEvent(this.app.workspace.on('resize', this.catchUp))
    this.registerEvent(this.app.workspace.on('layout-change', this.catchUp))
    this.registerEvent(this.app.workspace.on('active-leaf-change', this.catchUp))
    this.registerInterval(
      window.setInterval(() => {
        if (localToday() !== this.lastToday) this.refresh()
        // A task source enabled after the panel opened never fired its own
        // event, so the empty panel would otherwise wait for an unrelated one.
        else if (this.lastSections == null && this.ports.tasks.available()) this.refresh()
      }, 60_000),
    )

    this.refresh()
  }

  async onClose(): Promise<void> {
    if (this.panel) await unmount(this.panel)
    this.panel = null
  }

  /** A hidden panel that missed a projection catches up when it is shown again. */
  private readonly catchUp = (): void => {
    if (!this.staleWhileHidden) return
    window.setTimeout(() => {
      if (this.staleWhileHidden && this.containerEl.isShown()) this.refresh()
    }, 0)
  }

  onResize(): void {
    this.catchUp()
  }

  refresh(): void {
    if (!this.panel) return
    // A panel in a collapsed sidebar or a background tab projects nothing:
    // it notes the miss and catches up on reveal (onResize).
    if (!this.containerEl.isShown()) {
      this.staleWhileHidden = true
      return
    }
    this.staleWhileHidden = false
    const settings = this.plugin.settings
    const today = localToday()
    this.lastToday = today

    const setup = setupState(gatherSetupFacts(this.app, settings))
    const layout = this.ports.layout()
    this.lastLayout = layout
    const base = {
      today,
      setup,
      wipLimit: settings.wipLimit,
      collapsed: settings.collapsed,
      collapsedProjects: settings.collapsedProjects,
      draggable: Platform.isDesktop,
      layout,
      pacingMode: settings.pacingMode,
    }

    if (setup.includes('tasks-plugin-missing')) {
      this.lastSections = null
      this.show({sections: null, ...base})
      return
    }

    const sections = classifySections(this.ports.tasks.read(), this.ports.projects.read(), {
      ...layout,
      today,
      pacingMode: settings.pacingMode,
      pressWindow: settings.pressWindow,
    })

    this.lastSections = sections
    this.show({sections, ...base})
  }

  private lastData: PanelData | null = null

  private show(data: PanelData): void {
    this.lastData = data
    this.panel?.update(data)
  }

  /**
   * UI state changed (a fold, a collapse): the last projection is shown
   * again with the new toggles — no vault read, no classification.
   */
  repaint(): void {
    if (!this.lastData) return
    const settings = this.plugin.settings
    this.show({
      ...this.lastData,
      collapsed: settings.collapsed,
      collapsedProjects: settings.collapsedProjects,
    })
  }

  /** Turns a core menu spec into an Obsidian Menu at the event's position. */
  private runMenu(spec: MenuItemSpec[], ev: MouseEvent, run: (action: MenuAction) => void): void {
    const menu = new Menu()
    for (const entry of spec) {
      if (entry.kind === 'separator') menu.addSeparator()
      else if (entry.kind === 'label') menu.addItem(item => item.setTitle(entry.title).setIsLabel(true))
      else {
        menu.addItem(item =>
          item
            .setTitle(entry.title)
            .setIcon(entry.icon)
            .setDisabled(entry.disabled ?? false)
            .onClick(() => run(entry.action)),
        )
      }
    }
    menu.showAtMouseEvent(ev)
  }

  private dispatchTaskAction(tasks: Task[], action: MenuAction, ev: MouseEvent): void {
    if (action.type === 'schedule')
      void this.reschedule(tasks, resolveQuickDate(action.kind, localToday()))
    else if (action.type === 'postpone' && tasks[0]) void this.postpone(tasks[0], action.kind)
    else if (action.type === 'complete' && tasks[0]) void this.toggle(tasks[0])
    else if (action.type === 'edit-text' && tasks[0]) void this.editTextPrompt(tasks[0])
    else if (action.type === 'pick-date') void this.pickDate(tasks)
    else if (action.type === 'remove-date') void this.unschedule(tasks)
    else if (action.type === 'pick-due-date' && tasks[0]) void this.pickDueDate(tasks[0])
    else if (action.type === 'remove-due-date') void this.act(() => this.ports.editor.clearDue(tasks))
    else if (action.type === 'move-to-project') void this.bulkMove(tasks)
    else if (action.type === 'send-back') void this.sendBack(tasks)
    else if (action.type === 'cancel' && tasks[0]) void this.cancel(tasks[0])
    else if (action.type === 'select' && tasks[0]) this.panel?.selectTask(tasks[0])
    else if (action.type === 'open-note' && tasks[0])
      void this.openFile(tasks[0].filePath, tasks[0].line, ev)
  }

  /** The menu builders' slice of the world: the layout plus the injected clock. */
  private menuConfig() {
    return {...this.lastLayout, today: localToday()}
  }

  private showScheduleMenu(tasks: Task[], ev: MouseEvent): void {
    this.runMenu(scheduleMenuSpec(tasks, this.menuConfig()), ev, action =>
      this.dispatchTaskAction(tasks, action, ev),
    )
  }

  private showDueMenu(task: Task, ev: MouseEvent): void {
    this.runMenu(dueMenuSpec(task), ev, action => this.dispatchTaskAction([task], action, ev))
  }

  private showRowMenu(task: Task, ev: MouseEvent, row: RowMenuState): void {
    this.runMenu(taskMenuSpec(task, {...this.menuConfig(), ...row}), ev, action =>
      this.dispatchTaskAction([task], action, ev),
    )
  }

  /** Header chrome (#15): which sections carry which acts is policy, in core. */
  private showSectionMenu(key: SectionKey, selecting: boolean, ev: MouseEvent): void {
    const spec = sectionMenuSpec({
      selecting,
      selectable: key === 'today' || key === 'projects',
      repairable: key === 'slipped',
      organizable: key === 'projects',
    })
    this.runMenu(spec, ev, action => {
      if (action.type === 'toggle-select') this.panel?.toggleSelectMode()
      else if (action.type === 'reschedule-all') void this.rescheduleAllSlipped()
      else if (action.type === 'organize') void this.organizeProjects()
      else if (action.type === 'new-project') void this.newProjectPrompt()
      else if (action.type === 'fold-all') void this.foldAllProjects(action.folded)
    })
  }

  /** New project from the Backlogs header: the create flow the move picker hid. */
  private async newProjectPrompt(): Promise<void> {
    const name = await askText(this.app, {
      title: 'New project',
      placeholder: 'Project name',
      submitLabel: 'Create',
    })
    if (!name) return
    const path = await this.ports.projects.create(name, localToday())
    if (path) new Notice(`Daily Task Panel: project ${name} created`)
  }

  /** Fold all / Unfold all: core names the toggles, this stores them. */
  private async foldAllProjects(folded: boolean): Promise<void> {
    await this.plugin.updateUiState({
      collapsedProjects: foldToggles(
        this.lastSections?.projects ?? [],
        folded,
        this.plugin.settings.collapsedProjects,
      ),
    })
  }

  /** Rename project: the note moves under its new name; links follow. */
  private async renameProjectPrompt(project: ProjectMeta): Promise<void> {
    const name = await askText(this.app, {
      title: 'Rename project',
      placeholder: 'Project name',
      value: project.name,
      submitLabel: 'Rename',
    })
    if (!name || name === project.name) return
    const path = await this.ports.projects.rename(project.path, name)
    if (path) {
      await this.plugin.updateUiState({
        collapsedProjects: carryFoldToggle(this.plugin.settings.collapsedProjects, project.path, path),
      })
      new Notice(`Daily Task Panel: ${project.name} → ${name}`)
    }
  }

  /**
   * Edit text: the line's own words, in a prompt, without leaving the
   * panel. Prefilled from the line, not the source's description, so what
   * is shown is exactly what is replaced (tags and all).
   */
  private async editTextPrompt(task: Task): Promise<void> {
    const words = taskWords(task.sourceLine)
    const text = await askText(this.app, {
      title: 'Edit task',
      placeholder: 'Task',
      value: words,
      submitLabel: 'Save',
    })
    if (text && text !== words) await this.act(() => this.ports.editor.editText(task, text))
  }

  /** The relative pair: a quick date counted from the task's own anchor. */
  private async postpone(task: Task, kind: RelativeDate): Promise<void> {
    const anchor = postponeAnchor(task, localToday())
    if (anchor != null) await this.reschedule([task], resolveRelativeDate(kind, anchor))
  }

  /**
   * A drop is a way of pointing at an edit that already exists: resolve the
   * intent in core and dispatch to the same methods the buttons use.
   */
  private handleDrop(task: Task, target: DropTarget, ev: DragEvent): void {
    // The same layout and clock snapshot the panel highlighted targets with —
    // validity and execution must agree, even across midnight.
    const intent = dropIntent(task, target, {...this.lastLayout, today: this.lastToday})
    if (intent.kind === 'schedule-today') void this.reschedule([task], localToday())
    else if (intent.kind === 'move-to-project') void this.moveTo([task], intent.path)
    else if (intent.kind === 'ask-date') this.showScheduleMenu([task], ev)
  }

  private showProjectMenu(project: ProjectMeta, ev: MouseEvent): void {
    const groups = this.lastSections?.projects ?? []
    const group = groups.find(g => g.project.path === project.path)
    const spec = projectMenuSpec(project, {
      pacingMode: this.plugin.settings.pacingMode,
      pressing: group?.pressing ?? false,
      canMove: canMove(groups, project.path),
    })
    this.runMenu(spec, ev, action => {
      if (action.type === 'open-note') void this.openFile(project.path)
      else if (action.type === 'rename-project') void this.renameProjectPrompt(project)
      else if (action.type === 'move') void this.moveProject(project, action.direction)
      else if (action.type === 'add-task') void this.addTaskPrompt(project)
      else if (action.type === 'promote') void this.promote(project)
      else if (action.type === 'set-status') void this.changeStatus(project, action.status)
      else if (action.type === 'pick-start') void this.pickProjectDate(project, 'start')
      else if (action.type === 'clear-start')
        void this.changeProjectDate(project, {field: 'start', date: null})
      else if (action.type === 'pick-deadline') void this.pickProjectDate(project, 'deadline')
      else if (action.type === 'clear-deadline')
        void this.changeProjectDate(project, {field: 'deadline', date: null})
      else if (action.type === 'retire') void this.retireProject(project, action.status)
    })
  }

  /** Add task (#12): one line of typing, straight into the project's backlog. */
  private async addTaskPrompt(project: ProjectMeta): Promise<void> {
    const text = await askText(this.app, {
      title: `Add task to ${project.name}`,
      placeholder: 'Task',
      submitLabel: 'Add',
    })
    if (text) await this.act(() => this.ports.editor.addTask(project.path, text))
  }

  /**
   * Every project frontmatter write is a project command (core): the view
   * runs it and shows its notice. The pressing loop's → now and the menu's
   * status items are one path, so both name the capacity consequence — warn
   * never block — when a commit to `now` passes the limit.
   */
  private async changeStatus(project: ProjectMeta, status: ProjectStatus): Promise<void> {
    this.notify(
      await commitStatus(this.ports.projects, project, status, {
        sections: this.lastSections,
        wipLimit: this.plugin.settings.wipLimit,
      }),
    )
  }

  private promote(project: ProjectMeta): Promise<void> {
    return this.changeStatus(project, 'now')
  }

  /** Move to top/up/down/bottom (#20), within the band as last shown. */
  private async moveProject(project: ProjectMeta, direction: MoveDirection): Promise<void> {
    await moveProjectCommand(this.ports.projects, this.lastSections?.projects ?? [], project.path, direction)
  }

  /** Drag-to-reorder (#21): the same writer as the menu moves, one drop at a time. */
  private async placeProject(path: string, targetPath: string): Promise<void> {
    await placeProjectCommand(this.ports.projects, this.lastSections?.projects ?? [], path, targetPath)
  }

  private async organizeProjects(): Promise<void> {
    this.notify(await organizeProjectsCommand(this.ports.projects, this.plugin.settings.pacingMode))
  }

  private notify(outcome: {notice: string | null}): void {
    if (outcome.notice) new Notice(outcome.notice)
  }

  /**
   * The project date picker — one pattern for the deadline and the start
   * that twins it (#23): opens on the date already held, else today. No
   * quick dates: a project date is picked, never guessed.
   */
  private async pickProjectDate(
    project: ProjectMeta,
    field: ProjectDateEdit['field'],
  ): Promise<void> {
    const date = await askDate(this.app, {
      defaultDate: project[field] ?? localToday(),
      title: field === 'start' ? 'Project start' : 'Project deadline',
      submitLabel: field === 'start' ? 'Set start' : 'Set deadline',
    })
    if (date) await this.changeProjectDate(project, {field, date})
  }

  private async changeProjectDate(project: ProjectMeta, edit: ProjectDateEdit): Promise<void> {
    this.notify(await setProjectDate(this.ports.projects, project, edit))
  }

  /**
   * Retiring is not journaled (frontmatter + file move, not task lines) —
   * the note itself, moved intact, is the undo. Open tasks are never edited;
   * when some remain, they confirm first, because an archived note's tasks
   * leave the panel.
   */
  private async retireProject(
    project: {path: string; name: string},
    status: 'done' | 'dropped',
  ): Promise<void> {
    const {openCount, needsConfirm} = retirePlan(this.lastSections, project.path)
    if (needsConfirm) {
      const confirmed = await confirm(this.app, {
        title: `Mark ${project.name} ${status}?`,
        body: `${openCount} open task${openCount === 1 ? ' remains' : 's remain'} and will leave the panel with the note. The lines themselves are kept untouched.`,
        confirmLabel: `Mark ${status} & archive`,
      })
      if (!confirmed) return
    }
    const archived = await this.ports.projects.archive(project.path, status)
    if (archived) {
      new Notice(
        `Daily Task Panel: ${project.name} marked ${status} — archived to ${this.lastLayout.archiveFolder}`,
      )
    }
  }

  /** Journals the action and shows its notice with an undo link attached. */
  private record(entry: JournalEntry | null): void {
    if (!entry) return
    this.plugin.pushJournal(entry)
    const fragment = createFragment()
    fragment.append(`Daily Task Panel: ${entry.label} — `)
    const link = createEl('a', {text: 'Undo'})
    link.addEventListener('click', () => void this.plugin.undo(entry))
    fragment.append(link)
    new Notice(fragment, 8000)
  }

  private async pickDate(tasks: Task[]): Promise<void> {
    const date = await askDate(this.app, {defaultDate: localToday()})
    if (date) await this.reschedule(tasks, date)
  }

  /** The due picker (#18): opens on the task's own due date, else today. */
  private async pickDueDate(task: Task): Promise<void> {
    const date = await askDate(this.app, {
      defaultDate: task.due ?? localToday(),
      title: 'Due on',
      submitLabel: 'Set due date',
    })
    if (date) await this.act(() => this.ports.editor.setDue([task], date))
  }

  /**
   * The uniform write pipeline: run the edit, journal + notice it. The
   * reprojection is the task source's signal's job (see scheduleRefresh).
   */
  private async act(run: () => Promise<JournalEntry | null>): Promise<void> {
    this.record(await run())
  }

  private reschedule(tasks: Task[], date: string): Promise<void> {
    return this.act(() => this.ports.editor.reschedule(tasks, date, localToday()))
  }

  private unschedule(tasks: Task[]): Promise<void> {
    return this.act(() => this.ports.editor.unschedule(tasks))
  }

  private sendBack(tasks: Task[]): Promise<void> {
    return this.act(async () => (await this.ports.editor.sendBackToInbox(tasks, localToday())).entry)
  }

  private async bulkMove(allTasks: Task[]): Promise<void> {
    const tasks = editableTasks(allTasks, this.lastLayout)
    if (tasks.length === 0) return
    const choice = await pickProject(this.app, this.ports.projects.read())
    if (!choice) return
    if (choice.kind === 'project') {
      await this.moveTo(tasks, choice.project.path)
    } else {
      const name = await askText(this.app, {
        title: 'New project',
        placeholder: 'Project name',
        value: choice.name,
        submitLabel: 'Create and move',
      })
      if (name) await this.createAndMove(tasks, name)
    }
  }

  private moveTo(tasks: Task[], projectPath: string): Promise<void> {
    return this.act(async () => (await this.ports.editor.moveToProject(tasks, projectPath)).entry)
  }

  private async createAndMove(tasks: Task[], name: string): Promise<void> {
    const path = await this.ports.projects.create(name, localToday())
    if (path) await this.moveTo(tasks, path)
  }

  private cancel(task: Task): Promise<void> {
    return this.act(() => this.ports.editor.cancel(task))
  }

  // Bulk-writes from the last projection, not a fresh read — safe because
  // edit-lines verifies every line against its sourceLine at write time,
  // so anything that changed since the last refresh is skipped, not guessed at.
  private async rescheduleAllSlipped(): Promise<void> {
    if (!this.lastSections) return
    const slipped = editableTasks(flattenTaskTree(this.lastSections.slipped), this.lastLayout)
    if (slipped.length === 0) return
    await this.reschedule(slipped, localToday())
  }

  private async toggle(task: Task): Promise<void> {
    await this.ports.tasks.toggle(task)
  }

  /**
   * The single choke point for every panel jump. Obsidian's keymap resolves
   * the event's modifiers (mod+click → tab, mod+alt → split, middle-click…);
   * no event means the current tab, today's default.
   */
  private async openFile(path: string, line?: number, ev?: MouseEvent): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path)
    if (!(file instanceof TFile)) return
    const leaf = this.app.workspace.getLeaf(ev ? Keymap.isModEvent(ev) : false)
    await leaf.openFile(file, line == null ? undefined : {eState: {line}})
  }

  private async setCollapsed(key: SectionKey, collapsed: boolean): Promise<void> {
    await this.plugin.updateUiState({
      collapsed: {...this.plugin.settings.collapsed, [key]: collapsed},
    })
  }

  /**
   * Stored as an explicit toggle either way (#24): the default depends on
   * the project (unstarted folds, started opens — core/sections
   * projectFolded), so an unfold has to be remembered, not just a fold.
   */
  private async setProjectCollapsed(path: string, collapsed: boolean): Promise<void> {
    await this.plugin.updateUiState({
      collapsedProjects: {...this.plugin.settings.collapsedProjects, [path]: collapsed},
    })
  }
}
