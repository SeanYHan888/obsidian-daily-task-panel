import {assert, test} from 'vitest'

import {classifySections} from '../src/core/classify'

import type {ClassifyConfig, ProjectMeta, Task} from '../src/core/types'

const CONFIG: ClassifyConfig = {
  today: '2026-08-21',
  dailyNotesFolder: 'Daily Notes',
  projectsFolder: 'Projects/Active',
  machineNotePath: 'Indexes/System/Apple Sync.md',
  inboxHeading: 'Inbox',
  pacingMode: 'hybrid',
  pressWindow: 7,
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

const classify = (
  tasks: Task[],
  projects: ProjectMeta[] = [],
  config: Partial<ClassifyConfig> = {},
) => classifySections(tasks, projects, {...CONFIG, ...config})

const descriptions = (tasks: Task[]) => tasks.map(t => t.description)

test('undated managed reminders share the To-do inbox tail with daily captures', () => {
  const reminder = task({
    description: 'Call the repair shop',
    filePath: CONFIG.machineNotePath,
    heading: 'Apple Reminders',
  })
  const capture = task({description: 'daily capture', heading: 'Inbox'})
  const sections = classify([reminder, capture])

  assert.deepEqual(descriptions(sections.inbox), ['Call the repair shop', 'daily capture'])
  assert.deepEqual(sections.inbox[0], reminder, 'projection preserves the source task and dates')
  assert.deepEqual(sections.today, [])
  assert.deepEqual(sections.slipped, [])
  assert.deepEqual(sections.upcoming, [])
})

test('undated reminders use the configured managed path, independently of headings', () => {
  const managedPath = 'Imports/Reminders.md'
  const reminder = task({filePath: managedPath, heading: null})
  const unrelated = task({filePath: 'Areas/Other.md', heading: 'Apple Reminders'})
  const oldPath = task({filePath: CONFIG.machineNotePath, heading: 'Apple Reminders'})

  assert.deepEqual(
    classify([reminder, unrelated, oldPath], [], {machineNotePath: managedPath}).inbox,
    [reminder],
  )
  assert.deepEqual(classify([reminder, unrelated, oldPath], [], {machineNotePath: ''}).inbox, [])
})

test('managed reminder dates keep their sections; completed, blank and calendar rows stay hidden', () => {
  const managed = (overrides: Partial<Task>) => task({filePath: CONFIG.machineNotePath, ...overrides})
  const sections = classify([
    managed({description: 'undated'}),
    managed({description: 'due today', due: CONFIG.today}),
    managed({description: 'overdue', due: '2026-08-20'}),
    managed({description: 'future', due: '2026-08-22'}),
    managed({description: 'completed', open: false}),
    managed({description: '   '}),
    ...['2026-08-20', CONFIG.today, '2026-08-22'].map(scheduled =>
      managed({description: 'calendar block', scheduled}),
    ),
  ])

  assert.deepEqual(descriptions(sections.inbox), ['undated'])
  assert.deepEqual(descriptions(sections.today), ['due today'])
  assert.deepEqual(descriptions(sections.slipped), ['overdue'])
  assert.deepEqual(descriptions(sections.upcoming), ['future'])
  assert.deepEqual(sections.projects, [])
})

test('today holds open tasks scheduled or due today, from any note', () => {
  const scheduledToday = task({
    description: 'scheduled today',
    scheduled: '2026-08-21',
  })
  const dueToday = task({
    description: 'due today',
    due: '2026-08-21',
    filePath: 'Projects/Active/colm-paper.md',
  })
  const scheduledTomorrow = task({
    description: 'scheduled tomorrow',
    scheduled: '2026-08-22',
  })
  const undated = task({description: 'undated'})
  const doneToday = task({
    description: 'done today',
    scheduled: '2026-08-21',
    open: false,
  })

  const sections = classify([
    scheduledToday,
    dueToday,
    scheduledTomorrow,
    undated,
    doneToday,
  ])

  assert.deepEqual(descriptions(sections.today), [
    'scheduled today',
    'due today',
  ])
})

test('apple sync reminders appear in today but its calendar blocks never do', () => {
  const reminder = task({
    description: 'colm camera ready (Todo List)',
    due: '2026-08-21',
    filePath: CONFIG.machineNotePath,
    heading: 'Apple Reminders',
  })
  const calendarBlock = task({
    description: '09:00 - 10:00 tiktok oa (Personal)',
    scheduled: '2026-08-21',
    filePath: CONFIG.machineNotePath,
    heading: '2026-08-21',
  })

  const sections = classify([reminder, calendarBlock])

  assert.deepEqual(descriptions(sections.today), [
    'colm camera ready (Todo List)',
  ])
})

test('slipped holds past-dated tasks sorted by date, overdue reminders included', () => {
  const overdueReminder = task({
    description: 'colm camera ready (Todo List)',
    due: '2026-08-20',
    filePath: CONFIG.machineNotePath,
    heading: 'Apple Reminders',
  })
  const slippedTwoDaysAgo = task({
    description: 'follow up with advisor',
    scheduled: '2026-08-19',
  })
  const onTimeToday = task({description: 'on time', scheduled: '2026-08-21'})
  const futureTask = task({description: 'future', due: '2026-08-25'})

  const sections = classify([
    overdueReminder,
    slippedTwoDaysAgo,
    onTimeToday,
    futureTask,
  ])

  assert.deepEqual(descriptions(sections.slipped), [
    'follow up with advisor',
    'colm camera ready (Todo List)',
  ])
})

test('a missed apple sync calendar block is not slipped', () => {
  const missedBlock = task({
    description: '[All day] Trash and recycling',
    scheduled: '2026-08-20',
    filePath: CONFIG.machineNotePath,
    heading: '2026-08-20',
  })

  const sections = classify([missedBlock])

  assert.deepEqual(sections.slipped, [])
})

test('inbox holds undated daily-note tasks under the inbox heading, newest note first', () => {
  const capturedToday = task({
    description: 'read mem-agent paper',
    heading: 'Inbox',
    filePath: 'Daily Notes/2026/08/08-21, Fri.md',
  })
  const capturedYesterday = task({
    description: 'rerun ablation table',
    heading: 'Inbox',
    filePath: 'Daily Notes/2026/08/08-20, Thu.md',
  })
  const underTemp = task({
    description: 'stray under temp',
    heading: 'Temp',
    filePath: 'Daily Notes/2026/08/08-21, Fri.md',
  })
  const underEvents = task({
    description: '08:30 am - 09:00 am morning start',
    heading: 'Events:',
    filePath: 'Daily Notes/2026/08/08-21, Fri.md',
  })
  const datedCapture = task({
    description: 'already scheduled',
    heading: 'Inbox',
    scheduled: '2026-08-25',
  })
  const notDaily = task({
    description: 'meeting note task',
    heading: 'Inbox',
    filePath: 'Areas/meeting.md',
  })
  const lookalikeFolder = task({
    description: 'lookalike folder',
    heading: 'Inbox',
    filePath: 'Daily Notes Archive/08-21.md',
  })

  const sections = classify([
    capturedYesterday,
    capturedToday,
    underTemp,
    underEvents,
    datedCapture,
    notDaily,
    lookalikeFolder,
  ])

  assert.deepEqual(descriptions(sections.inbox), [
    'read mem-agent paper',
    'rerun ablation table',
  ])
})

test('upcoming holds future-dated non-project tasks sorted soonest first', () => {
  const scheduledCapture = task({
    description: 'already scheduled',
    heading: 'Inbox',
    scheduled: '2026-08-25',
  })
  const dueSooner = task({
    description: 'renew passport',
    filePath: 'Areas/admin.md',
    due: '2026-08-23',
  })
  const projectFuture = task({
    description: 'draft slides next week',
    filePath: 'Projects/Active/colm-paper.md',
    scheduled: '2026-08-24',
  })
  const datedToday = task({description: 'now', scheduled: '2026-08-21'})
  const pastDue = task({description: 'late', due: '2026-08-19'})

  const sections = classify([
    scheduledCapture,
    dueSooner,
    projectFuture,
    datedToday,
    pastDue,
  ])

  assert.deepEqual(descriptions(sections.upcoming), [
    'renew passport',
    'already scheduled',
  ])
})

test('a future apple sync calendar block never reaches upcoming', () => {
  const futureBlock = task({
    description: '09:00 - 10:00 standup (Work)',
    scheduled: '2026-08-24',
    filePath: CONFIG.machineNotePath,
    heading: '2026-08-24',
  })
  const futureReminder = task({
    description: 'colm camera ready (Todo List)',
    due: '2026-08-24',
    filePath: CONFIG.machineNotePath,
    heading: 'Apple Reminders',
  })

  const sections = classify([futureBlock, futureReminder])

  assert.deepEqual(descriptions(sections.upcoming), [
    'colm camera ready (Todo List)',
  ])
})

test('inbox heading matches case-insensitively and ignores # marks in the setting', () => {
  const captured = task({
    description: 'captured',
    heading: 'inbox',
    filePath: 'Daily Notes/2026/08/08-21, Fri.md',
  })

  const sections = classify([captured], [], {inboxHeading: '# Inbox'})

  assert.deepEqual(descriptions(sections.inbox), ['captured'])
})

test('projects group by note ordered now, next, later, then alphabetically', () => {
  const colm: ProjectMeta = {
    path: 'Projects/Active/colm-paper.md',
    name: 'colm-paper',
    status: 'now',
    deadline: null,
    order: null,
    start: null,
  }
  const devSetup: ProjectMeta = {
    path: 'Projects/Active/dev-setup.md',
    name: 'dev-setup',
    status: 'next',
    deadline: null,
    order: null,
    start: null,
  }
  const llmStudy: ProjectMeta = {
    path: 'Projects/Active/llm-study.md',
    name: 'llm-study',
    status: 'later',
    deadline: null,
    order: null,
    start: null,
  }
  const knowledgeBase: ProjectMeta = {
    path: 'Projects/Active/build-knowledge-base.md',
    name: 'build-knowledge-base',
    status: 'now',
    deadline: null,
    order: null,
    start: null,
  }
  const emptyProject: ProjectMeta = {
    path: 'Projects/Active/obsidian-fix.md',
    name: 'obsidian-fix',
    status: 'now',
    deadline: null,
    order: null,
    start: null,
  }

  const sections = classify(
    [
      task({description: 'study attention', filePath: llmStudy.path}),
      task({description: 'camera ready paper', filePath: colm.path}),
      task({description: 'install dotfiles', filePath: devSetup.path}),
      task({description: 'collect sources', filePath: knowledgeBase.path}),
    ],
    [colm, devSetup, llmStudy, knowledgeBase, emptyProject],
  )

  assert.deepEqual(
    sections.projects.map(g => g.project.name),
    ['build-knowledge-base', 'colm-paper', 'dev-setup', 'llm-study'],
  )
  assert.deepEqual(descriptions(sections.projects[1].tasks), [
    'camera ready paper',
  ])
  // emptyProject is `now` but renders no group, so it stays out of the badge.
  assert.equal(sections.wipNowCount, 2)
})

test('projects with deadlines order soonest-first ahead of undated ones', () => {
  const undatedNow: ProjectMeta = {
    path: 'Projects/Active/colm-paper.md',
    name: 'colm-paper',
    status: 'now',
    deadline: null,
    order: null,
    start: null,
  }
  const dueSoon: ProjectMeta = {
    path: 'Projects/Active/llm-study.md',
    name: 'llm-study',
    status: 'later',
    deadline: '2026-08-25',
    order: null,
    start: null,
  }
  const dueLater: ProjectMeta = {
    path: 'Projects/Active/dev-setup.md',
    name: 'dev-setup',
    status: 'now',
    deadline: '2026-09-10',
    order: null,
    start: null,
  }

  const sections = classify(
    [
      task({description: 'camera ready paper', filePath: undatedNow.path}),
      task({description: 'study attention', filePath: dueSoon.path}),
      task({description: 'install dotfiles', filePath: dueLater.path}),
    ],
    [undatedNow, dueSoon, dueLater],
  )

  assert.deepEqual(
    sections.projects.map(g => g.project.name),
    ['llm-study', 'dev-setup', 'colm-paper'],
  )
})

test('deadline urgency: ahead until today, arrived from today on, null when undated', () => {
  const ahead: ProjectMeta = {
    path: 'Projects/Active/llm-study.md',
    name: 'llm-study',
    status: 'later',
    deadline: '2026-08-22',
    order: null,
    start: null,
  }
  const dueToday: ProjectMeta = {
    path: 'Projects/Active/colm-paper.md',
    name: 'colm-paper',
    status: 'now',
    deadline: '2026-08-21',
    order: null,
    start: null,
  }
  const past: ProjectMeta = {
    path: 'Projects/Active/dev-setup.md',
    name: 'dev-setup',
    status: 'now',
    deadline: '2026-08-19',
    order: null,
    start: null,
  }
  const undated: ProjectMeta = {
    path: 'Projects/Active/build-knowledge-base.md',
    name: 'build-knowledge-base',
    status: 'now',
    deadline: null,
    order: null,
    start: null,
  }
  const projects = [ahead, dueToday, past, undated]

  const sections = classify(
    projects.map(p => task({description: `work on ${p.name}`, filePath: p.path})),
    projects,
  )

  assert.deepEqual(
    sections.projects.map(g => [g.project.name, g.urgency]),
    [
      ['dev-setup', 'arrived'],
      ['colm-paper', 'arrived'],
      ['llm-study', 'ahead'],
      ['build-knowledge-base', null],
    ],
  )
})

test('equal deadlines tiebreak by status rank then name; WIP count is unaffected', () => {
  const laterProject: ProjectMeta = {
    path: 'Projects/Active/llm-study.md',
    name: 'llm-study',
    status: 'later',
    deadline: '2026-08-25',
    order: null,
    start: null,
  }
  const nowProject: ProjectMeta = {
    path: 'Projects/Active/colm-paper.md',
    name: 'colm-paper',
    status: 'now',
    deadline: '2026-08-25',
    order: null,
    start: null,
  }

  const sections = classify(
    [
      task({description: 'study attention', filePath: laterProject.path}),
      task({description: 'camera ready paper', filePath: nowProject.path}),
    ],
    [laterProject, nowProject],
  )

  assert.deepEqual(
    sections.projects.map(g => g.project.name),
    ['colm-paper', 'llm-study'],
  )
  assert.equal(sections.wipNowCount, 1)
})

test('a project task dated today appears in both today and its project group', () => {
  const colm: ProjectMeta = {
    path: 'Projects/Active/colm-paper.md',
    name: 'colm-paper',
    status: 'now',
    deadline: null,
    order: null,
    start: null,
  }
  const crossCutting = task({
    description: 'test model for lsc-dpo',
    filePath: colm.path,
    scheduled: '2026-08-21',
  })

  const sections = classify([crossCutting], [colm])

  assert.deepEqual(descriptions(sections.today), ['test model for lsc-dpo'])
  assert.deepEqual(descriptions(sections.projects[0].tasks), [
    'test model for lsc-dpo',
  ])
})

test('sections preserve subtask hierarchy and promote orphaned children', () => {
  const colm: ProjectMeta = {
    path: 'Projects/Active/colm-paper.md',
    name: 'colm-paper',
    status: 'now',
    deadline: null,
    order: null,
    start: null,
  }
  const parent = task({
    description: 'camera ready paper',
    filePath: colm.path,
    line: 10,
  })
  const child = task({
    description: 'fix figure 3',
    filePath: colm.path,
    line: 11,
    parentLine: 10,
  })
  const doneParent = task({
    description: 'done parent',
    filePath: colm.path,
    line: 20,
    open: false,
  })
  const orphan = task({
    description: 'child of a done parent',
    filePath: colm.path,
    line: 21,
    parentLine: 20,
  })

  const sections = classify([parent, child, doneParent, orphan], [colm])

  const backlog = sections.projects[0].tasks
  assert.deepEqual(descriptions(backlog), [
    'camera ready paper',
    'child of a done parent',
  ])
  assert.deepEqual(descriptions(backlog[0].children), ['fix figure 3'])
})

test('sections are disjoint: a task dated today is not also slipped', () => {
  const repaired = task({
    description: 'rescheduled to today, due yesterday',
    scheduled: '2026-08-21',
    due: '2026-08-20',
  })

  const sections = classify([repaired])

  assert.deepEqual(descriptions(sections.today), [
    'rescheduled to today, due yesterday',
  ])
  assert.deepEqual(sections.slipped, [])
})

test('daily-note events headings are never read, even for dated tasks', () => {
  const eventBlock = task({
    description: '09:00 am - 10:00 am planning block',
    heading: 'Events:',
    scheduled: '2026-08-20',
  })

  const sections = classify([eventBlock])

  assert.deepEqual(sections.today, [])
  assert.deepEqual(sections.slipped, [])
})

test('blank descriptions are excluded from every section', () => {
  const blank = task({description: '   ', scheduled: '2026-08-21'})

  const sections = classify([blank])

  assert.deepEqual(sections.today, [])
})

test('a blank daily-notes folder means the vault root — capture works anywhere', () => {
  const capture = task({
    description: 'root capture',
    filePath: '2026-08-21.md',
    heading: 'Inbox',
  })
  const sections = classify([capture], [], {dailyNotesFolder: ''})
  assert.deepEqual(descriptions(sections.inbox), ['root capture'])
})

test('ranked projects lead by order; unranked follow under the pacing rules (#20)', () => {
  const meta = (name: string, overrides: Partial<ProjectMeta>): ProjectMeta => ({
    path: `Projects/Active/${name}.md`,
    name,
    status: 'next',
    deadline: null,
    order: null,
    start: null,
    ...overrides,
  })
  const projects = [
    meta('unranked-now', {status: 'now'}),
    meta('unranked-dated', {status: 'later', deadline: '2026-09-10'}),
    meta('ranked-later', {status: 'later', order: 5}),
    meta('ranked-next', {status: 'next', order: -2}),
  ]
  const sections = classify(
    projects.map(p => task({description: p.name, filePath: p.path})),
    projects,
  )
  assert.deepEqual(
    sections.projects.map(g => g.project.name),
    ['ranked-next', 'ranked-later', 'unranked-dated', 'unranked-now'],
  )
})

test('an arrived deadline leads regardless of rank — except in capacity mode (#20)', () => {
  const meta = (name: string, overrides: Partial<ProjectMeta>): ProjectMeta => ({
    path: `Projects/Active/${name}.md`,
    name,
    status: 'next',
    deadline: null,
    order: null,
    start: null,
    ...overrides,
  })
  const projects = [
    meta('hand-placed', {order: 1}),
    meta('came-due', {status: 'later', deadline: '2026-08-20'}),
    meta('due-today', {status: 'later', deadline: '2026-08-21', order: 9}),
  ]
  const tasks = projects.map(p => task({description: p.name, filePath: p.path}))
  assert.deepEqual(
    classify(tasks, projects).projects.map(g => g.project.name),
    ['came-due', 'due-today', 'hand-placed'],
  )
  assert.deepEqual(
    classify(tasks, projects, {pacingMode: 'wip'}).projects.map(g => g.project.name),
    ['hand-placed', 'due-today', 'came-due'],
  )
})

const projectMeta = (name: string, overrides: Partial<ProjectMeta>): ProjectMeta => ({
  path: `Projects/Active/${name}.md`,
  name,
  status: 'next',
  deadline: null,
  order: null,
  start: null,
  ...overrides,
})

test('unstarted projects tail the Backlogs regardless of rank, by start then the pacing rules (#22)', () => {
  const projects = [
    projectMeta('starts-later', {start: '2026-10-01', order: 1}),
    projectMeta('starts-soon-later', {start: '2026-09-01', status: 'later'}),
    projectMeta('starts-soon-now-ish', {start: '2026-09-01', status: 'next'}),
    projectMeta('unranked', {status: 'later'}),
    projectMeta('ranked', {order: 9}),
  ]
  const tasks = projects.map(p => task({description: p.name, filePath: p.path}))
  const groups = classify(tasks, projects).projects
  assert.deepEqual(
    groups.map(g => g.project.name),
    ['ranked', 'unranked', 'starts-soon-now-ish', 'starts-soon-later', 'starts-later'],
  )
  assert.deepEqual(
    groups.map(g => g.unstarted),
    [false, false, true, true, true],
  )
})

test('a start of today is started; a future start with status now is started by declaration (#22)', () => {
  const projects = [
    projectMeta('today', {start: '2026-08-21', status: 'later'}),
    projectMeta('declared', {start: '2026-12-01', status: 'now'}),
    projectMeta('plain', {status: 'next'}),
  ]
  const tasks = projects.map(p => task({description: p.name, filePath: p.path}))
  const groups = classify(tasks, projects).projects
  assert.deepEqual(groups.map(g => g.project.name), ['declared', 'plain', 'today'])
  assert.isFalse(groups.some(g => g.unstarted))
})

test('an arrived deadline leads even when the start is ahead — a debt beats a plan (#22)', () => {
  const projects = [
    projectMeta('resting', {order: 1}),
    projectMeta('contradiction', {start: '2026-09-28', deadline: '2026-08-20'}),
    projectMeta('waiting', {start: '2026-09-28'}),
  ]
  const tasks = projects.map(p => task({description: p.name, filePath: p.path}))
  const groups = classify(tasks, projects).projects
  assert.deepEqual(groups.map(g => g.project.name), ['contradiction', 'resting', 'waiting'])
  assert.equal(groups[0].urgency, 'arrived')
  assert.isFalse(groups[0].unstarted)
  assert.isTrue(groups[2].unstarted)
})

test('capacity mode ignores start entirely: no tail band, nothing unstarted (#22)', () => {
  const projects = [
    projectMeta('later-with-start', {status: 'later'}),
    projectMeta('now-starting-later', {status: 'next', start: '2026-12-01', order: 1}),
  ]
  const tasks = projects.map(p => task({description: p.name, filePath: p.path}))
  const groups = classify(tasks, projects, {pacingMode: 'wip'}).projects
  assert.deepEqual(groups.map(g => g.project.name), ['now-starting-later', 'later-with-start'])
  assert.isFalse(groups.some(g => g.unstarted))
})

test('task classification ignores project start: a dated task in an unstarted project keeps its section (#22)', () => {
  const waiting = projectMeta('waiting', {start: '2026-12-01'})
  const sections = classify(
    [
      task({description: 'due today', filePath: waiting.path, due: '2026-08-21'}),
      task({description: 'slipped', filePath: waiting.path, scheduled: '2026-08-01'}),
      task({description: 'ahead', filePath: waiting.path, scheduled: '2026-09-01'}),
    ],
    [waiting],
  )
  assert.deepEqual(descriptions(sections.today), ['due today'])
  assert.deepEqual(descriptions(sections.slipped), ['slipped'])
  assert.deepEqual(descriptions(sections.upcoming), [], 'project tasks never reach Upcoming')
  assert.isTrue(sections.projects[0].unstarted)
})
