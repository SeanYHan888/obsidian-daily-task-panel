import {assert, test} from 'vitest'

import {dateEditLabel, projectDateNotice, rescheduleLabel, sourceLabel} from '../src/core/labels'

import type {LineRecord} from '../src/core/journal'

test('a source is labeled by its basename, extension dropped', () => {
  assert.equal(sourceLabel('Daily Notes/2026/08/08-21, Fri.md'), '08-21, Fri')
  assert.equal(sourceLabel('Sync/Reminders.md'), 'Reminders')
  assert.equal(sourceLabel('Top.md'), 'Top')
})

test('a project date notice names the edit, and the contradiction when the dates cross (#23)', () => {
  const project = {name: 'course-part-2', start: null, deadline: null}
  assert.equal(
    projectDateNotice(project, {field: 'start', date: '2026-09-21'}),
    'Daily Task Panel: course-part-2 start → 2026-09-21',
  )
  assert.equal(
    projectDateNotice({...project, start: '2026-09-21'}, {field: 'start', date: null}),
    'Daily Task Panel: course-part-2 start cleared',
  )
  assert.equal(
    projectDateNotice({...project, deadline: '2026-09-27'}, {field: 'start', date: '2026-09-28'}),
    'Daily Task Panel: course-part-2 start → 2026-09-28 — start 09-28 is after deadline 09-27',
  )
  assert.equal(
    projectDateNotice({...project, start: '2026-09-28'}, {field: 'deadline', date: '2026-09-27'}),
    'Daily Task Panel: course-part-2 deadline → 2026-09-27 — deadline 09-27 is before start 09-28',
  )
  // The same day is not a contradiction; clearing never is.
  assert.equal(
    projectDateNotice({...project, deadline: '2026-09-27'}, {field: 'start', date: '2026-09-27'}),
    'Daily Task Panel: course-part-2 start → 2026-09-27',
  )
  assert.equal(
    projectDateNotice({...project, start: '2026-09-28'}, {field: 'deadline', date: null}),
    'Daily Task Panel: course-part-2 deadline cleared',
  )
})

test('a task date edit is labelled with the field the menu named: start or due, set or cleared', () => {
  assert.equal(dateEditLabel('start', 3, '2026-09-15'), 'start → 2026-09-15 on 3 tasks')
  assert.equal(dateEditLabel('start', 1, null), 'start cleared on 1 task')
  assert.equal(dateEditLabel('due', 1, '2026-09-20'), 'due → 2026-09-20 on 1 task')
  assert.equal(dateEditLabel('due', 2, null), 'due cleared on 2 tasks')
})

test('a re-dating is labelled by the field it actually moved: start, or the due on the spent-deadline path', () => {
  const date = '2026-09-13'
  const rec = (after: string): LineRecord => ({kind: 'replace', file: 'f.md', line: 0, before: '', after})
  const start = [rec('- [ ] a ⏳ 2026-09-13'), rec('- [ ] b 📅 2026-09-20 ⏳ 2026-09-13')]
  assert.equal(rescheduleLabel(start, date), 'start → 2026-09-13 on 2 tasks')
  // Overdue task re-dated: the 📅 took the date and no ⏳ was written.
  assert.equal(rescheduleLabel([rec('- [ ] c 📅 2026-09-13')], date), 'due → 2026-09-13 on 1 task')
  // A mixed sweep names the date without claiming one field.
  assert.equal(rescheduleLabel([...start, rec('- [ ] c 📅 2026-09-13')], date), '3 tasks → 2026-09-13')
})
