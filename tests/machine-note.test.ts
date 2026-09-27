import {assert, test} from 'vitest'

import {classifySections} from '../src/core/classify'
import {dropIntent} from '../src/core/drop'
import {editableTasks, isMachineManaged, rowAffordances} from '../src/core/machine-note'

import type {ClassifyConfig, Task} from '../src/core/types'

const MANAGED = 'Sync/Reminders.md'
const CONFIG = {machineNotePath: MANAGED}
const NONE = {machineNotePath: ''}

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

test('a blank path means no note is machine-managed — even for empty file paths', () => {
  assert.isTrue(isMachineManaged(MANAGED, CONFIG))
  assert.isFalse(isMachineManaged('Other.md', CONFIG))
  assert.isFalse(isMachineManaged(MANAGED, NONE))
  assert.isFalse(isMachineManaged('', NONE))
})

test('editableTasks drops managed rows and keeps everything else in order', () => {
  const keep = task({description: 'keep'})
  const dropped = task({description: 'managed', filePath: MANAGED})
  const alsoKeep = task({description: 'also keep'})
  assert.deepEqual(
    editableTasks([keep, dropped, alsoKeep], CONFIG).map(t => t.description),
    ['keep', 'also keep'],
  )
  assert.lengthOf(editableTasks([keep, dropped], NONE), 2)
})

test('managed rows offer check-off only; ordinary rows offer everything', () => {
  const base = {today: '2026-08-21', selectMode: false, dragEnabled: true}
  const managed = rowAffordances(task({filePath: MANAGED}), {...CONFIG, ...base})
  assert.isFalse(managed.canSchedule)
  assert.isFalse(managed.selectable)
  assert.isFalse(managed.draggable)

  const ordinary = rowAffordances(task(), {...CONFIG, ...base})
  assert.isTrue(ordinary.canSchedule)
  assert.isTrue(ordinary.draggable)
})

test('select mode trades scheduling and dragging for selectability', () => {
  const base = {today: '2026-08-21', selectMode: true, dragEnabled: true}
  const ordinary = rowAffordances(task(), {...CONFIG, ...base})
  assert.isFalse(ordinary.canSchedule)
  assert.isFalse(ordinary.draggable)
  assert.isTrue(ordinary.selectable)
  // The managed row stays unselectable even in select mode.
  assert.isFalse(rowAffordances(task({filePath: MANAGED}), {...CONFIG, ...base}).selectable)
})

test('with no machine-managed note, classify excludes nothing as a calendar block', () => {
  const config: ClassifyConfig = {
    today: '2026-08-21',
    dailyNotesFolder: 'Daily Notes',
    projectsFolder: 'Projects/Active',
    machineNotePath: '',
    inboxHeading: 'Inbox',
    pacingMode: 'hybrid',
    pressWindow: 7,
  }
  // A dated line that a managed note would hide is a plain task here.
  const block = task({description: 'time block', filePath: MANAGED, scheduled: '2026-08-21'})
  const sections = classifySections([block], [], config)
  assert.deepEqual(
    sections.today.map(t => t.description),
    ['time block'],
  )
})

test('with no machine-managed note, every row may be dropped', () => {
  const config = {
    machineNotePath: '',
    projectsFolder: 'Projects/Active',
    dailyNotesFolder: 'Daily Notes',
    inboxHeading: 'Inbox',
    today: '2026-08-21',
  }
  const intent = dropIntent(
    {filePath: MANAGED, scheduled: null, due: null, heading: null},
    {kind: 'section', key: 'today'},
    config,
  )
  assert.equal(intent.kind, 'schedule-today')
})
