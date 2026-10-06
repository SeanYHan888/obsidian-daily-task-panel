import {describe, expect, it} from 'vitest'

import {newProjectRow, performAction, performDrop} from '../src/core/actions'
import {sectionAffordances} from '../src/core/sections'
import {fakePorts, fakePrompter} from './fakes/ports'

import type {ActionContext} from '../src/core/actions'
import type {VaultLayout} from '../src/core/layout'
import type {ProjectGroup, ProjectMeta, Sections, Task} from '../src/core/types'

const layout: VaultLayout = {
  dailyNotesFolder: 'Daily Notes',
  dailyNoteFormat: 'YYYY-MM-DD',
  projectsFolder: 'Projects/Active',
  archiveFolder: 'Projects/Archive',
  machineNotePath: 'Indexes/System/Apple Sync.md',
  inboxHeading: 'Inbox',
  moveTargetHeading: 'Tasks',
  projectTemplatePath: '',
}

const TODAY = '2026-09-27'

const task = (description: string, meta: Partial<Task> = {}): Task => ({
  description,
  sourceLine: `- [ ] ${description}`,
  filePath: 'Daily Notes/2026-09-27.md',
  line: 3,
  open: true,
  scheduled: null,
  due: null,
  heading: 'Inbox',
  children: [],
  ...meta,
})

const project = (name: string, meta: Partial<ProjectMeta> = {}): ProjectMeta => ({
  path: `Projects/Active/${name}.md`,
  name,
  status: 'later',
  deadline: null,
  order: null,
  start: null,
  ...meta,
})

const group = (p: ProjectMeta, tasks: Task[] = []): ProjectGroup => ({
  project: p,
  tasks,
  urgency: null,
  pressing: false,
  unstarted: false,
})

const sections = (partial: Partial<Sections> = {}): Sections => ({
  today: [],
  slipped: [],
  upcoming: [],
  inbox: [],
  projects: [],
  wipNowCount: 0,
  ...partial,
})

const context = (
  overrides: Partial<ActionContext> & {tasks?: Task[]; projects?: ProjectMeta[]} = {},
) => {
  const ports = fakePorts(overrides.tasks ?? [], overrides.projects ?? [])
  const ctx: ActionContext = {
    ports,
    prompter: fakePrompter({}),
    sections: sections(),
    today: TODAY,
    layout,
    pacingMode: 'hybrid',
    wipLimit: 3,
    ...overrides,
  }
  return {ctx, ports}
}

describe('task acts', () => {
  it('a quick date resolves against the projection day, not the clock', async () => {
    const t = task('write intro')
    const {ctx, ports} = context({today: '2026-09-27'})
    const result = await performAction(ctx, {kind: 'tasks', tasks: [t]}, {type: 'schedule', kind: 'tomorrow'})
    expect(ports.editor.calls).toEqual([
      {op: 'reschedule', tasks: ['write intro'], args: [{kind: 'reschedule', date: '2026-09-28', today: '2026-09-27'}]},
    ])
    expect(result.entry?.label).toBe('start → 2026-09-28 on 1 task')
    expect(result.notices).toEqual([])
  })

  it('every line edit drops machine-managed rows — the guard has one home', async () => {
    const managed = task('reminder', {filePath: layout.machineNotePath})
    const plain = task('plain')
    const {ctx, ports} = context()
    await performAction(ctx, {kind: 'tasks', tasks: [managed, plain]}, {type: 'remove-date'})
    expect(ports.editor.calls).toEqual([{op: 'unschedule', tasks: ['plain'], args: [{kind: 'unschedule'}]}])
    const only = await performAction(ctx, {kind: 'tasks', tasks: [managed]}, {type: 'cancel'})
    expect(only.entry).toBeNull()
    expect(ports.editor.calls).toHaveLength(1)
  })

  it('check-off and the jump survive on a machine-managed row', async () => {
    const managed = task('reminder', {filePath: layout.machineNotePath, line: 9})
    const {ctx, ports} = context()
    await performAction(ctx, {kind: 'tasks', tasks: [managed]}, {type: 'complete'})
    expect(ports.tasks.toggled).toEqual(['reminder'])
    const jump = await performAction(ctx, {kind: 'tasks', tasks: [managed]}, {type: 'open-note'})
    expect(jump.effect).toEqual({kind: 'open', path: layout.machineNotePath, line: 9})
  })

  it('complete and cancel apply to every task in the subject, journaled as one entry', async () => {
    const a = task('a', {line: 1})
    const b = task('b', {line: 2})
    const {ctx, ports} = context()
    await performAction(ctx, {kind: 'tasks', tasks: [a, b]}, {type: 'complete'})
    expect(ports.tasks.toggled).toEqual(['a', 'b'])
    const result = await performAction(ctx, {kind: 'tasks', tasks: [a, b]}, {type: 'cancel'})
    expect(ports.editor.calls).toEqual([{op: 'cancel', tasks: ['a', 'b'], args: [{kind: 'cancel'}]}])
    expect(result.entry?.label).toBe('cancelled 2 tasks')
    expect(result.entry?.records).toHaveLength(2)
  })

  it('a due date is picked from the one the task holds', async () => {
    const t = task('pay invoice', {due: '2026-10-03'})
    const prompter = fakePrompter({date: ['2026-10-10']})
    const {ctx, ports} = context({prompter})
    await performAction(ctx, {kind: 'tasks', tasks: [t]}, {type: 'pick-due-date'})
    expect(prompter.asked).toEqual(['date:Due on'])
    expect(ports.editor.calls).toEqual([{op: 'set-due', tasks: ['pay invoice'], args: [{kind: 'set-due', date: '2026-10-10'}]}])
  })

  it('a closed picker is silence, not an edit', async () => {
    const {ctx, ports} = context({prompter: fakePrompter({})})
    const result = await performAction(ctx, {kind: 'tasks', tasks: [task('x')]}, {type: 'pick-date'})
    expect(result).toEqual({entry: null, notices: [], effect: null})
    expect(ports.editor.calls).toEqual([])
  })

  it('edit text prefills the line words and writes only a change', async () => {
    const t = task('draft', {sourceLine: '- [ ] draft #tag ⏳ 2026-09-28'})
    const same = fakePrompter({text: ['draft #tag']})
    const {ctx, ports} = context({prompter: same})
    await performAction(ctx, {kind: 'tasks', tasks: [t]}, {type: 'edit-text'})
    expect(ports.editor.calls).toEqual([])
    const changed = fakePrompter({text: ['draft v2 #tag']})
    const second = context({prompter: changed})
    await performAction(second.ctx, {kind: 'tasks', tasks: [t]}, {type: 'edit-text'})
    expect(second.ports.editor.calls).toEqual([{op: 'edit-text', tasks: ['draft'], args: [{kind: 'edit-text', text: 'draft v2 #tag'}]}])
  })

  it('move to project: pick New project, name it, and the rows land in the created note', async () => {
    const t = task('plan launch')
    const prompter = fakePrompter({project: [{kind: 'new', name: 'Launch'}], text: ['Launch']})
    const {ctx, ports} = context({prompter})
    ports.projects.create = name => Promise.resolve(`Projects/Active/${name}.md`)
    const result = await performAction(ctx, {kind: 'tasks', tasks: [t]}, {type: 'move-to-project'})
    expect(prompter.asked).toEqual(['project', 'text:New project'])
    expect(ports.editor.calls).toEqual([
      {op: 'moveToProject', tasks: ['plan launch'], args: ['Projects/Active/Launch.md']},
    ])
    expect(result.entry?.label).toBe('moved to Projects/Active/Launch.md')
  })

  it('select and open are the shell’s: returned as effects', async () => {
    const t = task('pick me')
    const {ctx} = context()
    expect((await performAction(ctx, {kind: 'tasks', tasks: [t]}, {type: 'select'})).effect).toEqual({
      kind: 'select',
      task: t,
    })
  })
})

describe('the project picker’s create row', () => {
  const projects = [project('beacon-fire'), project('llm-study')]

  it('leads an empty picker, where a long list would push it below the fold', () => {
    expect(newProjectRow('', projects)).toEqual({choice: {kind: 'new'}, placement: 'first'})
    expect(newProjectRow('   ', projects)).toEqual({choice: {kind: 'new'}, placement: 'first'})
  })

  it('follows the matches once a name is typed, carrying the name', () => {
    expect(newProjectRow(' trip planning ', projects)).toEqual({
      choice: {kind: 'new', name: 'trip planning'},
      placement: 'last',
    })
    expect(newProjectRow('学习计划', projects)).toEqual({
      choice: {kind: 'new', name: '学习计划'},
      placement: 'last',
    })
  })

  it('is withheld when the name already is a project', () => {
    expect(newProjectRow('Beacon-Fire', projects)).toBeNull()
  })
})

describe('drops', () => {
  it('a drop on To-do stamps the projection’s today, through the same act as the menu', async () => {
    const t = task('later', {scheduled: '2026-10-01', heading: null})
    const {ctx, ports} = context({today: '2026-09-27'})
    await performDrop(ctx, t, {kind: 'section', key: 'today'})
    expect(ports.editor.calls).toEqual([
      {op: 'reschedule', tasks: ['later'], args: [{kind: 'reschedule', date: '2026-09-27', today: '2026-09-27'}]},
    ])
  })

  it('a drop on Upcoming asks for a date: the shell opens the start menu', async () => {
    const t = task('undated')
    const {ctx, ports} = context()
    const result = await performDrop(ctx, t, {kind: 'section', key: 'upcoming'})
    expect(result.effect).toEqual({kind: 'schedule-menu', tasks: [t]})
    expect(ports.editor.calls).toEqual([])
  })

  it('a machine-managed row dropped anywhere does nothing', async () => {
    const managed = task('reminder', {filePath: layout.machineNotePath})
    const {ctx, ports} = context()
    const result = await performDrop(ctx, managed, {kind: 'project', path: 'Projects/Active/p.md'})
    expect(result).toEqual({entry: null, notices: [], effect: null})
    expect(ports.editor.calls).toEqual([])
  })
})

describe('project acts', () => {
  it('the menu’s status item warns past the limit exactly like → now', async () => {
    const a = project('a', {status: 'now'})
    const b = project('b', {status: 'now'})
    const c = project('c', {status: 'next'})
    const shown = sections({projects: [group(a), group(b), group(c)], wipNowCount: 2})
    const viaMenu = context({projects: [a, b, c], sections: shown, wipLimit: 2})
    const viaButton = context({projects: [a, b, c], sections: shown, wipLimit: 2})
    const menu = await performAction(viaMenu.ctx, {kind: 'project', project: c}, {type: 'set-status', status: 'now'})
    const button = await performAction(viaButton.ctx, {kind: 'project', project: c}, {type: 'promote'})
    expect(menu.notices).toEqual(['Daily task panel: c → now — now is full (3/2)'])
    expect(button.notices).toEqual(menu.notices)
    expect(viaMenu.ports.projects.writes).toEqual(viaButton.ports.projects.writes)
  })

  it('retire confirms only when open tasks remain, and names the archive folder', async () => {
    const p = project('p')
    const withTasks = sections({projects: [group(p, [task('left over')])]})
    const decline = fakePrompter({confirm: [false]})
    const declined = context({projects: [p], sections: withTasks, prompter: decline})
    expect(await performAction(declined.ctx, {kind: 'project', project: p}, {type: 'retire', status: 'done'})).toEqual({
      entry: null,
      notices: [],
      effect: null,
    })
    expect(decline.asked).toEqual(['confirm:Mark p done?'])
    const silent = fakePrompter({})
    const empty = context({projects: [p], sections: sections({projects: [group(p)]}), prompter: silent})
    const result = await performAction(empty.ctx, {kind: 'project', project: p}, {type: 'retire', status: 'dropped'})
    expect(silent.asked).toEqual([])
    expect(result.notices).toEqual(['Daily task panel: p marked dropped — archived to Projects/Archive'])
  })

  it('rename carries the fold toggle as an effect and speaks the menu’s words', async () => {
    const p = project('old')
    const {ctx, ports} = context({projects: [p], prompter: fakePrompter({text: ['new']})})
    ports.projects.rename = (_path, name) => Promise.resolve(`Projects/Active/${name}.md`)
    const result = await performAction(ctx, {kind: 'project', project: p}, {type: 'rename-project'})
    expect(result.notices).toEqual(['Daily task panel: old → new'])
    expect(result.effect).toEqual({kind: 'project-renamed', from: p.path, to: 'Projects/Active/new.md'})
  })

  it('a project date picker opens on the date held, else today', async () => {
    const dated = project('d', {deadline: '2026-11-01'})
    const prompter = fakePrompter({date: ['2026-11-05']})
    const {ctx, ports} = context({projects: [dated], prompter})
    const result = await performAction(ctx, {kind: 'project', project: dated}, {type: 'pick-deadline'})
    expect(prompter.asked).toEqual(['date:Project deadline'])
    expect(ports.projects.writes).toEqual([{path: dated.path, patch: {deadline: '2026-11-05'}}])
    expect(result.notices).toEqual(['Daily task panel: d deadline → 2026-11-05'])
  })
})

describe('section acts', () => {
  it('which header carries which acts is stated once', () => {
    expect(sectionAffordances('today')).toEqual({selectable: true, repairable: false, organizable: false, droppable: true})
    expect(sectionAffordances('slipped')).toEqual({selectable: false, repairable: true, organizable: false, droppable: false})
    expect(sectionAffordances('upcoming')).toEqual({selectable: false, repairable: false, organizable: false, droppable: true})
    expect(sectionAffordances('projects')).toEqual({selectable: true, repairable: false, organizable: true, droppable: false})
  })

  it('Start all today sweeps the repair queue as last shown, minus machine-managed rows', async () => {
    const slipped = task('slipped', {scheduled: '2026-09-20', heading: null})
    const managed = task('reminder', {filePath: layout.machineNotePath, due: '2026-09-20'})
    const {ctx, ports} = context({sections: sections({slipped: [slipped, managed]})})
    await performAction(ctx, {kind: 'section', key: 'slipped'}, {type: 'reschedule-all'})
    expect(ports.editor.calls).toEqual([
      {op: 'reschedule', tasks: ['slipped'], args: [{kind: 'reschedule', date: TODAY, today: TODAY}]},
    ])
  })

  it('New project creates and says so; fold-all and select are effects', async () => {
    const {ctx, ports} = context({prompter: fakePrompter({text: ['Fresh']})})
    ports.projects.create = name => Promise.resolve(`Projects/Active/${name}.md`)
    const created = await performAction(ctx, {kind: 'section', key: 'projects'}, {type: 'new-project'})
    expect(created.notices).toEqual(['Daily task panel: project Fresh created'])
    expect((await performAction(ctx, {kind: 'section', key: 'projects'}, {type: 'fold-all', folded: true})).effect).toEqual({
      kind: 'fold-all',
      folded: true,
    })
    expect((await performAction(ctx, {kind: 'section', key: 'today'}, {type: 'toggle-select'})).effect).toEqual({
      kind: 'toggle-select',
    })
  })
})

describe('what a relocation has to say', () => {
  it('names skipped and duplicated rows in the words the adapters once raised, beside the journal entry', async () => {
    const t = task('moved')
    const {ctx, ports} = context({prompter: fakePrompter({project: [{kind: 'project', project: project('p')}]})})
    ports.editor.moveToProject = () =>
      Promise.resolve({
        entry: {label: 'moved 1 task to p', records: []},
        moved: 1,
        duplicated: 1,
        skipped: 2,
        headingMissing: false,
        target: {path: 'Projects/Active/p.md', missing: false},
      })
    const result = await performAction(ctx, {kind: 'tasks', tasks: [t]}, {type: 'move-to-project'})
    expect(result.entry?.label).toBe('moved 1 task to p')
    expect(result.notices).toEqual([
      'Daily task panel: 1 task copied but not cut — the source note changed mid-move; remove the originals by hand',
      'Daily task panel: 2 tasks not moved (changed since selection, or already in the target note)',
    ])
  })

  it('a missing daily note or inbox heading refuses send-back and says which', async () => {
    const t = task('back', {filePath: 'Projects/Active/p.md', heading: 'Tasks'})
    const {ctx, ports} = context()
    const outcome = (over: {missing?: boolean; headingMissing?: boolean}) => () =>
      Promise.resolve({
        entry: null,
        moved: 0,
        duplicated: 0,
        skipped: 0,
        headingMissing: over.headingMissing ?? false,
        target: {path: 'Daily Notes/2026-09-27.md', missing: over.missing ?? false},
      })
    ports.editor.sendBackToInbox = outcome({missing: true})
    const missing = await performAction(ctx, {kind: 'tasks', tasks: [t]}, {type: 'send-back'})
    expect(missing.notices).toEqual([
      "Daily task panel: today's daily note not found (Daily Notes/2026-09-27.md) — create it first",
    ])
    ports.editor.sendBackToInbox = outcome({headingMissing: true})
    const noHeading = await performAction(ctx, {kind: 'tasks', tasks: [t]}, {type: 'send-back'})
    expect(noHeading.notices).toEqual(['Daily task panel: no "Inbox" heading in today\'s daily note — nothing sent back'])
  })
})
