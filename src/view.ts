import {ItemView, Keymap, Menu, Notice, Platform, TFile, debounce} from 'obsidian'
import {mount, unmount} from 'svelte'

import Panel from './ui/Panel.svelte'
import {obsidianPrompter} from './ui/prompts'
import {createPorts, gatherSetupFacts} from './adapters/compose'
import {performAction, performDrop} from './core/actions'
import {classifySections} from './core/classify'
import {EMPTY_LAYOUT} from './core/layout'
import {
  dueMenuSpec,
  projectMenuSpec,
  scheduleMenuSpec,
  sectionCapabilities,
  sectionMenuSpec,
  selectBarMenuSpec,
  taskMenuSpec,
} from './core/menus'
import {canMove} from './core/order'
import {placeProject} from './core/project-commands'
import {carryFoldToggle, foldToggles} from './core/sections'
import {setupState} from './core/setup'

import type {WorkspaceLeaf} from 'obsidian'
import type {ActionContext, ActionResult, Prompter, Subject} from './core/actions'
import type {DropTarget} from './core/drop'
import type {JournalEntry} from './core/journal'
import type {VaultLayout} from './core/layout'
import type {MenuAction, MenuItemSpec} from './core/menus'
import type {Ports} from './core/ports'
import type {QuickDate} from './core/schedule'
import type {ProjectMeta, SectionKey, Sections, Task} from './core/types'
import type {PanelData, RowMenuState} from './ui/panel-types'
import type {PanelSettings} from './settings'

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

/** The one clock read: the day a projection is drawn for. */
const localToday = (): string => {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * The shell: mounts the panel, projects the vault into it, turns menu specs
 * into Obsidian menus, and hands every act to core (core/actions.ts),
 * finishing only what a shell can — a jump, a notice, select mode, a fold.
 */
export class PanelView extends ItemView {
  private panel: PanelHandle | null = null
  private lastToday = localToday()
  private lastSections: Sections | null = null
  /** The layout the last projection was built on — acts resolve against it, not a fresh read. */
  private lastLayout: VaultLayout = EMPTY_LAYOUT
  private lastData: PanelData | null = null
  /** A projection was asked for while the panel was hidden; it runs on reveal. */
  private staleWhileHidden = false
  private portsCache: Ports | null = null
  private prompterCache: Prompter | null = null
  /**
   * The projection scheduler: every trigger — the task source's signal, a
   * project change, a write of our own — funnels into one trailing
   * debounce. Nothing reprojects right after its own write: the caches the
   * projection reads (the Tasks plugin's, the metadata cache) update after
   * the file does, so an immediate read is stale by construction and the
   * signal that follows is the refresh that counts.
   */
  private readonly scheduleRefresh = debounce(() => this.refresh(), 350, true)

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

  private get prompter(): Prompter {
    return (this.prompterCache ??= obsidianPrompter(this.app))
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
    const tasks = (list: Task[]): Subject => ({kind: 'tasks', tasks: list})
    const project = (meta: ProjectMeta): Subject => ({kind: 'project', project: meta})
    this.panel = mount(Panel, {
      target: this.contentEl,
      props: {
        callbacks: {
          onToggleTask: (task: Task) => void this.perform(tasks([task]), {type: 'complete'}),
          onOpenTask: (task: Task, ev?: MouseEvent) =>
            void this.perform(tasks([task]), {type: 'open-note'}, ev),
          onOpenFile: (path: string, ev?: MouseEvent) => void this.openFile(path, undefined, ev),
          onCollapse: (key: SectionKey, collapsed: boolean) =>
            void this.setCollapsed(key, collapsed),
          onProjectToggle: (path: string, folded: boolean, ev: MouseEvent) =>
            Keymap.isModEvent(ev)
              ? void this.openFile(path, undefined, ev)
              : void this.setProjectCollapsed(path, !folded),
          onScheduleMenu: (task: Task, ev: MouseEvent) => this.showScheduleMenu([task], ev),
          onDueMenu: (task: Task, ev: MouseEvent) =>
            this.runMenu(dueMenuSpec(task), ev, tasks([task])),
          onRowMenu: (task: Task, ev: MouseEvent, row: RowMenuState) =>
            this.runMenu(taskMenuSpec(task, {...this.menuConfig(), ...row}), ev, tasks([task])),
          onSchedule: (task: Task, kind: QuickDate) =>
            void this.perform(tasks([task]), {type: 'schedule', kind}),
          onPickDate: (task: Task) => void this.perform(tasks([task]), {type: 'pick-date'}),
          onCancelTask: (task: Task) => void this.perform(tasks([task]), {type: 'cancel'}),
          onSectionMenu: (key: SectionKey, selecting: boolean, ev: MouseEvent) =>
            this.runMenu(sectionMenuSpec({selecting, ...sectionCapabilities(key)}), ev, {
              kind: 'section',
              key,
            }),
          onBulkMove: (list: Task[]) => void this.perform(tasks(list), {type: 'move-to-project'}),
          onBulkScheduleMenu: (list: Task[], ev: MouseEvent) => this.showScheduleMenu(list, ev),
          onBulkActionsMenu: (list: Task[], ev: MouseEvent) =>
            this.runMenu(selectBarMenuSpec(list, this.menuConfig()), ev, tasks(list)),
          onDrop: (task: Task, target: DropTarget, ev: DragEvent) =>
            void this.drop(task, target, ev),
          onReorderProject: (path: string, targetPath: string) =>
            void placeProject(this.ports.projects, this.lastSections?.projects ?? [], path, targetPath),
          onProjectMenu: (meta: ProjectMeta, ev: MouseEvent) => this.showProjectMenu(meta, ev),
          onProjectDeadline: (meta: ProjectMeta) =>
            void this.perform(project(meta), {type: 'pick-deadline'}),
          onProjectStart: (meta: ProjectMeta) => void this.perform(project(meta), {type: 'pick-start'}),
          onPromoteProject: (meta: ProjectMeta) => void this.perform(project(meta), {type: 'promote'}),
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
    // it notes the miss and catches up on reveal.
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

  /** The acts' slice of the world: the last projection, its day, its layout, the pacing settings. */
  private context(): ActionContext {
    return {
      ports: this.ports,
      prompter: this.prompter,
      sections: this.lastSections,
      today: this.lastToday,
      layout: this.lastLayout,
      pacingMode: this.plugin.settings.pacingMode,
      wipLimit: this.plugin.settings.wipLimit,
    }
  }

  /** The menu builders' slice: the layout plus the projection's day. */
  private menuConfig() {
    return {...this.lastLayout, today: this.lastToday}
  }

  /** Turns a core menu spec into an Obsidian Menu at the event's position; a click performs. */
  private runMenu(spec: MenuItemSpec[], ev: MouseEvent, subject: Subject): void {
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
            .onClick(() => void this.perform(subject, entry.action, ev)),
        )
      }
    }
    menu.showAtMouseEvent(ev)
  }

  private showScheduleMenu(tasks: Task[], ev: MouseEvent): void {
    this.runMenu(scheduleMenuSpec(tasks, this.menuConfig()), ev, {kind: 'tasks', tasks})
  }

  private showProjectMenu(project: ProjectMeta, ev: MouseEvent): void {
    const groups = this.lastSections?.projects ?? []
    const group = groups.find(g => g.project.path === project.path)
    const spec = projectMenuSpec(project, {
      pacingMode: this.plugin.settings.pacingMode,
      pressing: group?.pressing ?? false,
      canMove: canMove(groups, project.path),
    })
    this.runMenu(spec, ev, {kind: 'project', project})
  }

  private async perform(subject: Subject, action: MenuAction, ev?: MouseEvent): Promise<void> {
    this.finish(await performAction(this.context(), subject, action), ev)
  }

  private async drop(task: Task, target: DropTarget, ev: DragEvent): Promise<void> {
    this.finish(await performDrop(this.context(), task, target), ev)
  }

  /** What only the shell can do with a result: journal + notice, then the UI effect. */
  private finish(result: ActionResult, ev?: MouseEvent): void {
    if (result.entry) this.record(result.entry)
    else if (result.notice) new Notice(result.notice)
    const effect = result.effect
    if (!effect) return
    switch (effect.kind) {
      case 'open':
        void this.openFile(effect.path, effect.line, ev)
        break
      case 'select':
        this.panel?.selectTask(effect.task)
        break
      case 'toggle-select':
        this.panel?.toggleSelectMode()
        break
      case 'fold-all':
        void this.plugin.updateUiState({
          collapsedProjects: foldToggles(
            this.lastSections?.projects ?? [],
            effect.folded,
            this.plugin.settings.collapsedProjects,
          ),
        })
        break
      case 'project-renamed':
        void this.plugin.updateUiState({
          collapsedProjects: carryFoldToggle(
            this.plugin.settings.collapsedProjects,
            effect.from,
            effect.to,
          ),
        })
        break
      case 'schedule-menu':
        if (ev) this.showScheduleMenu(effect.tasks, ev)
        break
    }
  }

  /** Journals the action and shows its notice with an undo link attached. */
  private record(entry: JournalEntry): void {
    this.plugin.pushJournal(entry)
    const fragment = createFragment()
    fragment.append(`Daily Task Panel: ${entry.label} — `)
    const link = createEl('a', {text: 'Undo'})
    link.addEventListener('click', () => void this.plugin.undo(entry))
    fragment.append(link)
    new Notice(fragment, 8000)
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
