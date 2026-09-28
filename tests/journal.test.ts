import {assert, test} from 'vitest'

import {pushEntry, takeEntry, undoNotice, undoPlan, undoRecordsInFile} from '../src/core/journal'

import type {JournalEntry} from '../src/core/journal'

test('undoing a replace restores what the line said before', () => {
  const lines = ['# Inbox', '- [ ] call bank ⏳ 2026-08-23']

  const result = undoRecordsInFile(lines, [
    {
      kind: 'replace',
      file: 'Daily Notes/08-22.md',
      line: 1,
      before: '- [ ] call bank',
      after: '- [ ] call bank ⏳ 2026-08-23',
    },
  ])

  assert.deepEqual(result.lines, ['# Inbox', '- [ ] call bank'])
  assert.equal(result.reverted, 1)
  assert.equal(result.stale, 0)
})

test('a line edited since the action is skipped, never guessed at', () => {
  const lines = ['- [ ] call bank ⏳ 2026-08-23 #urgent']

  const result = undoRecordsInFile(lines, [
    {
      kind: 'replace',
      file: 'Daily Notes/08-22.md',
      line: 0,
      before: '- [ ] call bank',
      after: '- [ ] call bank ⏳ 2026-08-23',
    },
  ])

  assert.deepEqual(result.lines, ['- [ ] call bank ⏳ 2026-08-23 #urgent'])
  assert.equal(result.reverted, 0)
  assert.equal(result.stale, 1)
})

test('undoing inserts removes the appended block, whatever order records come in', () => {
  const lines = ['## Tasks', '- [ ] existing', '- [ ] moved in', '  - [ ] its child']

  const result = undoRecordsInFile(lines, [
    {kind: 'insert', file: 'Projects/Active/colm-paper.md', line: 2, text: '- [ ] moved in'},
    {kind: 'insert', file: 'Projects/Active/colm-paper.md', line: 3, text: '  - [ ] its child'},
  ])

  assert.deepEqual(result.lines, ['## Tasks', '- [ ] existing'])
  assert.equal(result.reverted, 2)
  assert.equal(result.stale, 0)
})

test('an inserted line that changed since stays put and counts as stale', () => {
  const lines = ['## Tasks', '- [x] moved in, then done']

  const result = undoRecordsInFile(lines, [
    {kind: 'insert', file: 'Projects/Active/colm-paper.md', line: 1, text: '- [ ] moved in'},
  ])

  assert.deepEqual(result.lines, ['## Tasks', '- [x] moved in, then done'])
  assert.equal(result.reverted, 0)
  assert.equal(result.stale, 1)
})

test('undoing removals rebuilds the note exactly, non-adjacent cuts included', () => {
  // Forward action cut lines 1 and 3 out of:
  //   ['# Inbox', '- [ ] alpha', '- [ ] keep', '- [ ] gamma']
  const lines = ['# Inbox', '- [ ] keep']

  const result = undoRecordsInFile(lines, [
    {kind: 'remove', file: 'Daily Notes/08-22.md', line: 1, text: '- [ ] alpha'},
    {kind: 'remove', file: 'Daily Notes/08-22.md', line: 3, text: '- [ ] gamma'},
  ])

  assert.deepEqual(result.lines, ['# Inbox', '- [ ] alpha', '- [ ] keep', '- [ ] gamma'])
  assert.equal(result.reverted, 2)
  assert.equal(result.stale, 0)
})

test('re-inserting a removed line clamps to the end of a shrunken note', () => {
  const lines = ['# Inbox']

  const result = undoRecordsInFile(lines, [
    {kind: 'remove', file: 'Daily Notes/08-22.md', line: 9, text: '- [ ] alpha'},
  ])

  assert.deepEqual(result.lines, ['# Inbox', '- [ ] alpha'])
  assert.equal(result.reverted, 1)
  assert.equal(result.stale, 0)
})

test('a removed line already restored by hand is not duplicated — skipped as stale', () => {
  const lines = ['# Inbox', '- [ ] alpha', '- [ ] keep']

  const result = undoRecordsInFile(lines, [
    {kind: 'remove', file: 'Daily Notes/08-22.md', line: 1, text: '- [ ] alpha'},
  ])

  assert.deepEqual(result.lines, ['# Inbox', '- [ ] alpha', '- [ ] keep'])
  assert.equal(result.reverted, 0)
  assert.equal(result.stale, 1)
})

const entry = (label: string, records: JournalEntry['records'] = []): JournalEntry => ({label, records})

test('the plan restores content before it removes any: notes getting lines back go first', () => {
  const plan = undoPlan({
    label: 'moved 2 tasks to p',
    records: [
      {kind: 'insert', file: 'Projects/Active/p.md', line: 5, text: '- [ ] a'},
      {kind: 'remove', file: 'Daily Notes/d1.md', line: 3, text: '- [ ] a'},
      {kind: 'insert', file: 'Projects/Active/p.md', line: 6, text: '- [ ] b'},
      {kind: 'remove', file: 'Daily Notes/d2.md', line: 1, text: '- [ ] b'},
      {kind: 'replace', file: 'Daily Notes/d3.md', line: 0, before: 'x', after: 'y'},
    ],
  })
  assert.deepEqual(
    plan.map(g => g.path),
    ['Daily Notes/d1.md', 'Daily Notes/d2.md', 'Projects/Active/p.md', 'Daily Notes/d3.md'],
  )
  assert.equal(plan[2].records.length, 2)
})

test('the journal is bounded: the oldest entry leaves once it is full', () => {
  let journal: JournalEntry[] = []
  for (let i = 0; i < 53; i++) journal = pushEntry(journal, entry(`act ${i}`))
  assert.equal(journal.length, 50)
  assert.equal(journal[0].label, 'act 3')
  assert.equal(journal[49].label, 'act 52')
})

test('take: the latest by default, a named entry from anywhere, and never the same one twice', () => {
  const a = entry('a')
  const b = entry('b')
  const c = entry('c')
  const journal = [a, b, c]

  const latest = takeEntry(journal)
  assert.equal(latest.entry, c)
  assert.deepEqual(latest.journal, [a, b])

  const old = takeEntry(latest.journal, a)
  assert.equal(old.entry, a)
  assert.deepEqual(old.journal, [b])

  const twice = takeEntry(old.journal, a)
  assert.equal(twice.reason, 'already-undone')
  assert.deepEqual(twice.journal, [b])

  const empty = takeEntry([])
  assert.equal(empty.reason, 'empty')
})

test('undo speaks the words it always did', () => {
  assert.equal(undoNotice({reason: 'empty'}), 'Daily task panel: nothing to undo')
  assert.equal(undoNotice({reason: 'already-undone'}), 'Daily task panel: that action was already undone')
  assert.equal(undoNotice({reason: 'undone', label: 'moved 1 task to p', stale: 0}), 'Daily task panel: undid "moved 1 task to p"')
  assert.equal(
    undoNotice({reason: 'undone', label: 'cancelled 1 task', stale: 2}),
    'Daily task panel: undid "cancelled 1 task" — 2 lines changed since last refresh — skipped',
  )
})
