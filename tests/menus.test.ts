import {assert, test} from 'vitest'

import {
  dueMenuSpec,
  menuFor,
  projectMenuSpec,
  rowMenuRequest,
  scheduleMenuSpec,
  sectionMenuSpec,
  selectBarMenuSpec,
  taskMenuSpec,
} from '../src/core/menus'

import type {MenuItemSpec} from '../src/core/menus'
import type {ProjectMeta, Task} from '../src/core/types'

const CONFIG = {
  projectsFolder: 'Projects/Active',
  today: '2026-08-24',
  machineNotePath: '',
  selectable: false,
  selected: false,
}

let nextLine = 0
const task = (overrides: Partial<Task> = {}): Task => ({
  description: 'a task',
  filePath: 'Daily Notes/2026/08/08-21, Fri.md',
  line: nextLine++,
  sourceLine: '- [ ] a task',
  open: true,
  scheduled: null,
  due: null,
  heading: null,
  children: [],
  ...overrides,
})

const titles = (spec: MenuItemSpec[]) =>
  spec.map(entry =>
    entry.kind === 'item' ? entry.title : entry.kind === 'label' ? `[${entry.title}]` : '—',
  )

test('an undated daily task gets the four quick dates and the picker, nothing else', () => {
  assert.deepEqual(titles(scheduleMenuSpec([task()], CONFIG)), [
    'Today',
    'Tomorrow',
    'Weekend',
    'Next week',
    'Set start date',
  ])
})

test('Clear start appears once anything has a start to withdraw', () => {
  const spec = scheduleMenuSpec([task(), task({scheduled: '2026-08-25'})], CONFIG)
  assert.include(titles(spec), 'Clear start')
  assert.notInclude(titles(scheduleMenuSpec([task()], CONFIG)), 'Clear start')
})

test('the relative pair follows the quick dates for one task with something to postpone', () => {
  const ahead = titles(scheduleMenuSpec([task({scheduled: '2026-09-01'})], CONFIG))
  assert.deepEqual(ahead.slice(0, 7), ['Today', 'Tomorrow', 'Weekend', 'Next week', '+1 day', '+1 week', 'Change start date'])
  const spec = scheduleMenuSpec([task({scheduled: '2026-09-01'})], CONFIG)
  const plusWeek = spec.find(e => e.kind === 'item' && e.title === '+1 week')
  assert.ok(plusWeek && plusWeek.kind === 'item' && plusWeek.action.type === 'postpone' && plusWeek.action.kind === 'plus-week')
  // A spent deadline can be postponed; a live one alone cannot; a bulk selection never.
  assert.include(titles(scheduleMenuSpec([task({due: '2026-08-01'})], CONFIG)), '+1 day')
  assert.notInclude(titles(scheduleMenuSpec([task({due: '2026-09-01'})], CONFIG)), '+1 day')
  assert.notInclude(titles(scheduleMenuSpec([task({scheduled: '2026-09-01'}), task({scheduled: '2026-09-02'})], CONFIG)), '+1 day')
})

test('a quick date that is already the deadline is ✓ and disabled — a plan there writes nothing (#18)', () => {
  const spec = scheduleMenuSpec([task({due: '2026-08-24'})], CONFIG)
  const today = spec.find(e => e.kind === 'item' && e.title.startsWith('Today'))
  assert.ok(today && today.kind === 'item' && today.title === 'Today ✓' && today.disabled)
})

test('a quick date every selected task already holds is ✓ and disabled', () => {
  const spec = scheduleMenuSpec([task({scheduled: '2026-08-24'})], CONFIG)
  const items = spec.filter(e => e.kind === 'item')
  const today = items.find(e => e.title.startsWith('Today'))
  assert.equal(today?.title, 'Today ✓')
  assert.isTrue(today?.disabled)
  const tomorrow = items.find(e => e.title.startsWith('Tomorrow'))
  assert.equal(tomorrow?.title, 'Tomorrow')
  assert.isFalse(tomorrow?.disabled)
})

test('a mixed selection marks no quick date', () => {
  const spec = scheduleMenuSpec([task({scheduled: '2026-08-24'}), task()], CONFIG)
  assert.notInclude(titles(spec), 'Today ✓')
})

test('refiling acts appear only when every task lives in a project note', () => {
  const backlog = task({filePath: 'Projects/Active/colm-paper.md'})
  const all = titles(scheduleMenuSpec([backlog], CONFIG))
  assert.include(all, 'Move to project')
  assert.include(all, 'Send back to To-do')

  const mixed = titles(scheduleMenuSpec([backlog, task()], CONFIG))
  assert.notInclude(mixed, 'Move to project')
  assert.notInclude(mixed, 'Send back to To-do')

  assert.notInclude(titles(scheduleMenuSpec([], CONFIG)), 'Move to project')
})

test('user-facing copy never says inbox (#13)', () => {
  const backlog = task({filePath: 'Projects/Active/colm-paper.md', scheduled: '2026-08-24'})
  for (const title of titles(taskMenuSpec(backlog, CONFIG))) {
    assert.notMatch(title, /inbox/i)
  }
})

const MOVABLE = {up: true, down: true}
const HYBRID = {pacingMode: 'hybrid' as const, pressing: false, canMove: MOVABLE}

const project = (overrides: Partial<ProjectMeta> = {}): ProjectMeta => ({
  path: 'Projects/Active/colm-paper.md',
  name: 'colm-paper',
  status: 'now',
  deadline: null,
  order: null,
  start: null,
  ...overrides,
})

test('the current status is checked and disabled; the others actionable', () => {
  const spec = projectMenuSpec(project({status: 'next'}), HYBRID)
  const items = spec.filter(e => e.kind === 'item')
  const next = items.find(e => e.title.startsWith('next'))
  assert.equal(next?.title, 'next ✓')
  assert.isTrue(next?.disabled)
  const now = items.find(e => e.title === 'now')
  assert.isFalse(now?.disabled)
})

test('clear deadline exists only once a deadline is set', () => {
  assert.notInclude(titles(projectMenuSpec(project(), HYBRID)), 'Clear deadline')
  const dated = projectMenuSpec(project({deadline: '2026-09-01'}), HYBRID)
  assert.include(titles(dated), 'Clear deadline')
  assert.include(titles(dated), 'Change deadline')
})

test('both menus open with the same jump and close with the destructive acts', () => {
  const projectTitles = titles(projectMenuSpec(project(), HYBRID))
  assert.equal(projectTitles[0], 'Open note')
  assert.equal(projectTitles[1], 'Rename project')
  assert.deepEqual(projectTitles.slice(-2), ['Mark done & archive', 'Mark dropped & archive'])

  const taskTitles = titles(taskMenuSpec(task(), CONFIG))
  assert.equal(taskTitles[0], 'Open note')
  assert.equal(taskTitles.at(-1), 'Cancel task')
})

test('the project menu carries the capture act, pressing puts the commit first', () => {
  const calm = titles(projectMenuSpec(project(), HYBRID))
  assert.include(calm, 'Add task')
  assert.notInclude(calm, 'Move to now')

  const pressing = titles(projectMenuSpec(project(), {...HYBRID, pressing: true}))
  assert.isBelow(pressing.indexOf('Move to now'), pressing.indexOf('Add task'))
})

test('a machine-managed row offers the jump and check-off — the one edit its note survives', () => {
  const managed = task({filePath: 'Sync/Reminders.md'})
  assert.deepEqual(
    titles(taskMenuSpec(managed, {...CONFIG, machineNotePath: 'Sync/Reminders.md'})),
    ['Open note', '—', 'Complete task'],
  )
})

test('the section menu carries the acts: select for selectable, repair for slipped', () => {
  const selectable = titles(sectionMenuSpec({selecting: false, selectable: true, repairable: false, organizable: false}))
  assert.deepEqual(selectable, ['Select tasks'])

  const selecting = titles(sectionMenuSpec({selecting: true, selectable: true, repairable: false, organizable: false}))
  assert.deepEqual(selecting, ['Done selecting'])

  const repair = titles(sectionMenuSpec({selecting: false, selectable: false, repairable: true, organizable: false}))
  assert.deepEqual(repair, ['Start all today'])
})

test('a section with no acts gets an empty spec — no menu at all', () => {
  assert.deepEqual(sectionMenuSpec({selecting: false, selectable: false, repairable: false, organizable: false}), [])
})

test('the select bar overflow prepends move-to-project for triage selections only', () => {
  const triage = titles(selectBarMenuSpec([task()], CONFIG))
  assert.equal(triage[0], 'Move to project')
  assert.include(triage, 'Today')

  const refile = selectBarMenuSpec([task({filePath: 'Projects/Active/colm-paper.md'})], CONFIG)
  const moves = refile.filter(e => e.kind === 'item' && e.action.type === 'move-to-project')
  assert.lengthOf(moves, 1)
})

test('the due chip opens a menu that edits the due field only — no quick dates (#18)', () => {
  assert.deepEqual(titles(dueMenuSpec(task({due: '2026-09-05'}))), ['Change due date', 'Clear due'])
  assert.deepEqual(titles(dueMenuSpec(task())), ['Set due date'])
  for (const entry of dueMenuSpec(task({due: '2026-09-05'}))) {
    if (entry.kind === 'item') assert.match(entry.action.type, /due/)
  }
})

test('the row menu reads as two labelled date groups, Start then Due (#18, CONTEXT.md Menu order)', () => {
  const undated = titles(taskMenuSpec(task(), CONFIG))
  const start = undated.indexOf('[Start]')
  assert.deepEqual(undated.slice(start, start + 8), [
    '[Start]',
    'Today',
    'Tomorrow',
    'Weekend',
    'Next week',
    'Set start date',
    '[Due]',
    'Set due date',
  ])
  assert.notInclude(undated, 'Clear due')

  const dated = titles(taskMenuSpec(task({due: '2026-09-05'}), CONFIG))
  assert.include(dated, 'Change due date')
  assert.include(dated, 'Clear due')

  // In a project note the refile group follows; the due items stay ahead of it.
  const inProject = titles(taskMenuSpec(task({filePath: 'Projects/Active/Taxes.md'}), CONFIG))
  assert.isBelow(inProject.indexOf('Set due date'), inProject.indexOf('Move to project'))
  assert.equal(inProject[inProject.indexOf('Set due date') + 1], '—')
})

test('bulk schedule menus never carry due items — one row, its own deadline (#18)', () => {
  const bulk = titles(scheduleMenuSpec([task(), task({due: '2026-09-05'})], CONFIG))
  assert.notInclude(bulk, 'Set due date')
  assert.notInclude(bulk, 'Clear due')
  assert.notInclude(bulk, '[Start]')
})

test('every row can be moved to a project; only project rows can be sent back (#19)', () => {
  const daily = titles(taskMenuSpec(task(), CONFIG))
  assert.include(daily, 'Move to project')
  assert.notInclude(daily, 'Send back to To-do')

  const inProject = titles(taskMenuSpec(task({filePath: 'Projects/Active/Taxes.md'}), CONFIG))
  assert.include(inProject, 'Move to project')
  assert.include(inProject, 'Send back to To-do')

  // Refile is its own group, between pacing and the destructive act.
  assert.equal(daily[daily.indexOf('Move to project') - 1], '—')
  assert.deepEqual(daily.slice(daily.indexOf('Move to project') + 1), ['—', 'Cancel task'])
})

test('Select multiple is a refile act beside Move to project, in selectable sections only, ✓ once selected', () => {
  const plain = titles(taskMenuSpec(task(), CONFIG))
  assert.notInclude(plain, 'Select multiple')

  const t = titles(taskMenuSpec(task(), {...CONFIG, selectable: true}))
  assert.equal(t[t.indexOf('Move to project') + 1], 'Select multiple')

  const inProject = titles(taskMenuSpec(task({filePath: 'Projects/Active/Taxes.md'}), {...CONFIG, selectable: true}))
  const from = inProject.indexOf('Move to project')
  assert.deepEqual(inProject.slice(from, from + 3), ['Move to project', 'Select multiple', 'Send back to To-do'])

  const selected = taskMenuSpec(task(), {...CONFIG, selectable: true, selected: true})
  const entry = selected.find(e => e.kind === 'item' && e.action.type === 'select')
  assert.ok(entry && entry.kind === 'item' && entry.title === 'Select multiple ✓' && entry.disabled)
})

test('the row menu opens with the jump and the words, then check-off, before the dates', () => {
  const t = titles(taskMenuSpec(task(), CONFIG))
  assert.deepEqual(t.slice(0, 5), ['Open note', 'Edit text', '—', 'Complete task', '—'])
  assert.equal(t[5], '[Start]')
})

test('the row menu carries the relative pair inside the Start group for a task with a start', () => {
  const t = titles(taskMenuSpec(task({scheduled: '2026-09-01'}), CONFIG))
  assert.isAbove(t.indexOf('+1 week'), t.indexOf('[Start]'))
  assert.isBelow(t.indexOf('+1 week'), t.indexOf('[Due]'))
  assert.include(t, 'Clear start')
})

test('the ⏳ chip menu is unchanged by #19: refile still only for all-project selections', () => {
  assert.notInclude(titles(scheduleMenuSpec([task()], CONFIG)), 'Move to project')
})

test('the Backlogs menu carries Organize by status after the select toggle (#20)', () => {
  const backlogs = titles(
    sectionMenuSpec({selecting: false, selectable: true, repairable: false, organizable: true}),
  )
  assert.deepEqual(backlogs, ['New project', 'Select tasks', 'Organize by status', 'Fold all', 'Unfold all'])
})

test('the project menu carries the four moves between pacing and retirement (#20)', () => {
  const spec = projectMenuSpec(project(), HYBRID)
  const t = titles(spec)
  const moves = ['Move to top', 'Move up', 'Move down', 'Move to bottom']
  const start = t.indexOf('Move to top')
  assert.deepEqual(t.slice(start, start + 4), moves)
  assert.equal(t[start - 1], '—')
  assert.deepEqual(t.slice(start + 4), ['—', 'Mark done & archive', 'Mark dropped & archive'])
  for (const entry of spec) {
    if (entry.kind === 'item' && entry.action.type === 'move') assert.isFalse(entry.disabled)
  }
})

test('moves that cannot change anything are disabled: the ends, and arrived deadlines (#20)', () => {
  const disabledMoves = (canMove: {up: boolean; down: boolean}) =>
    projectMenuSpec(project(), {...HYBRID, canMove})
      .filter(e => e.kind === 'item' && e.action.type === 'move' && e.disabled)
      .map(e => (e.kind === 'item' ? e.title : ''))
  assert.deepEqual(disabledMoves({up: false, down: true}), ['Move to top', 'Move up'])
  assert.deepEqual(disabledMoves({up: true, down: false}), ['Move down', 'Move to bottom'])
  // An arrived deadline leads regardless of rank: the view passes both false.
  assert.lengthOf(disabledMoves({up: false, down: false}), 4)
})

test('the project menu sets and clears the start just before the deadline items, chronologically (#23)', () => {
  const unset = titles(projectMenuSpec(project(), HYBRID))
  const at = unset.indexOf('Set start date')
  assert.isAbove(at, unset.indexOf('later'), 'pacing: after the statuses')
  assert.equal(unset[at + 1], 'Set deadline', 'start then deadline — the pair reads chronologically')
  assert.notInclude(unset, 'Clear start')

  const set = titles(
    projectMenuSpec(project({start: '2026-09-21', deadline: '2026-09-27'}), HYBRID),
  )
  const from = set.indexOf('Change start date')
  assert.deepEqual(set.slice(from, from + 4), [
    'Change start date',
    'Clear start',
    'Change deadline',
    'Clear deadline',
  ])
  const spec = projectMenuSpec(project({start: '2026-09-21'}), HYBRID)
  assert.deepEqual(
    spec.filter(e => e.kind === 'item' && e.action.type.endsWith('-start')).map(e => e.kind === 'item' ? e.action.type : ''),
    ['pick-start', 'clear-start'],
  )
})

test('capacity mode hides the start items with the deadline items (#23)', () => {
  const wip = titles(projectMenuSpec(project({start: '2026-09-21'}), {...HYBRID, pacingMode: 'wip'}))
  assert.notInclude(wip, 'Change start date')
  assert.notInclude(wip, 'Clear start')
  const deadline = titles(projectMenuSpec(project({start: '2026-09-21'}), {...HYBRID, pacingMode: 'deadline'}))
  assert.include(deadline, 'Change start date')
})

test('menuFor: one request in, the spec and its subject out', () => {
  const ctx = {projectsFolder: 'Projects/Active', today: '2026-09-27', machineNotePath: '', pacingMode: 'hybrid' as const, groups: []}
  const task = {
    description: 'x',
    sourceLine: '- [ ] x',
    filePath: 'Daily Notes/2026-09-27.md',
    line: 1,
    open: true,
    scheduled: null,
    due: null,
    heading: 'Inbox',
    children: [],
  }
  const row = menuFor({kind: 'row', task, state: {selectable: true, selected: false}}, ctx)
  assert.deepEqual(row.subject, {kind: 'tasks', tasks: [task]})
  assert.deepEqual(row.spec, taskMenuSpec(task, {...ctx, selectable: true, selected: false}))
  const section = menuFor({kind: 'section', key: 'slipped', selecting: false}, ctx)
  assert.deepEqual(section.subject, {kind: 'section', key: 'slipped'})
  assert.ok(section.spec.some(e => e.kind === 'item' && e.action.type === 'reschedule-all'))
  const project = {path: 'Projects/Active/p.md', name: 'p', status: 'next' as const, deadline: null, order: null, start: null}
  const header = menuFor({kind: 'project', project}, ctx)
  assert.deepEqual(header.subject, {kind: 'project', project})
  assert.deepEqual(header.spec, projectMenuSpec(project, {pacingMode: 'hybrid', pressing: false, canMove: {up: false, down: false}}))
})

test('a right-click on a selected row opens the whole selection’s menu', () => {
  const a = task({description: 'a'})
  const b = task({description: 'b'})
  const c = task({description: 'c'})
  const request = rowMenuRequest(a, {selectable: true, selected: true}, [a, b, c])
  assert.deepEqual(request, {kind: 'selection', tasks: [a, b, c]})
})

test('an unselected row, or a selection of one, keeps its own menu', () => {
  const a = task({description: 'a'})
  const b = task({description: 'b'})
  assert.deepEqual(rowMenuRequest(a, {selectable: true, selected: false}, [b]), {
    kind: 'row',
    task: a,
    state: {selectable: true, selected: false},
  })
  assert.deepEqual(rowMenuRequest(a, {selectable: true, selected: true}, [a]), {
    kind: 'row',
    task: a,
    state: {selectable: true, selected: true},
  })
})
