import {describe, expect, it} from 'vitest'

import {undoRecordsInFile} from '../src/core/journal'
import {
  appendBlocks,
  cutIfUnchanged,
  editLabel,
  planCut,
  replaceLines,
  transformFor,
} from '../src/core/note-edit'

const NOTE = ['# Day', '', '# Inbox', '- [ ] alpha', '  - [ ] alpha child', '- [ ] beta', ''].join('\n')

describe('replaceLines', () => {
  it('edits only lines that still read as selected, and journals before and after', () => {
    const result = replaceLines(
      NOTE,
      'd.md',
      [
        {line: 3, sourceLine: '- [ ] alpha'},
        {line: 5, sourceLine: '- [ ] gamma'},
      ],
      transformFor({kind: 'reschedule', date: '2026-09-28', today: '2026-09-27'}),
    )
    expect(result.stale).toBe(1)
    expect(result.records).toEqual([
      {kind: 'replace', file: 'd.md', line: 3, before: '- [ ] alpha', after: '- [ ] alpha ⏳ 2026-09-28'},
    ])
    expect(result.data.split('\n')[3]).toBe('- [ ] alpha ⏳ 2026-09-28')
    expect(result.data.split('\n')[5]).toBe('- [ ] beta')
  })

  it('keeps a CRLF note CRLF and matches fingerprints across the ending', () => {
    const crlf = NOTE.replaceAll('\n', '\r\n')
    const result = replaceLines(crlf, 'd.md', [{line: 5, sourceLine: '- [ ] beta'}], transformFor({kind: 'cancel'}))
    expect(result.stale).toBe(0)
    expect(result.records[0].kind === 'replace' && result.records[0].after.endsWith('\r')).toBe(true)
    expect(result.data.includes('\r\n')).toBe(true)
    expect(result.data.split('\r\n')[5]).toBe('- [-] beta')
  })

  it('an unchanged line makes no record', () => {
    const result = replaceLines(NOTE, 'd.md', [{line: 3, sourceLine: '- [ ] alpha'}], transformFor({kind: 'clear-due'}))
    expect(result.records).toEqual([])
    expect(result.data).toBe(NOTE)
  })

  it('a line past the end is stale, not a crash', () => {
    const result = replaceLines(NOTE, 'd.md', [{line: 99, sourceLine: 'x'}], transformFor({kind: 'cancel'}))
    expect(result.stale).toBe(1)
  })
})

describe('editLabel', () => {
  it('speaks the menu words over the lines actually changed', () => {
    const rec = {kind: 'replace' as const, file: 'd.md', line: 1, before: '- [ ] a', after: '- [ ] a ⏳ 2026-09-28'}
    expect(editLabel({kind: 'reschedule', date: '2026-09-28', today: '2026-09-27'}, [rec])).toBe('start → 2026-09-28 on 1 task')
    expect(editLabel({kind: 'unschedule'}, [rec, rec])).toBe('start cleared on 2 tasks')
    expect(editLabel({kind: 'cancel'}, [rec, rec, rec])).toBe('cancelled 3 tasks')
    expect(editLabel({kind: 'edit-text', text: 'x'}, [rec])).toBe('edited the text of 1 task')
  })
})

describe('appendBlocks', () => {
  it('lands under the heading with insert records that point at the landed lines', () => {
    const project = ['---', 'status: now', '---', '# P', '', '## Tasks', '- [ ] existing', ''].join('\n')
    const result = appendBlocks(project, 'p.md', 'Tasks', [['- [ ] alpha', '  - [ ] alpha child']], {createMissing: true})
    expect(result).not.toBeNull()
    const lines = result!.data.split('\n')
    for (const r of result!.records) {
      expect(r.kind).toBe('insert')
      if (r.kind === 'insert') expect(lines[r.line]).toBe(r.text)
    }
    expect(result!.records.map(r => (r.kind === 'insert' ? r.text : ''))).toEqual(['- [ ] alpha', '  - [ ] alpha child'])
  })

  it('creates a missing heading when allowed and refuses when not', () => {
    const bare = '# P\n'
    const created = appendBlocks(bare, 'p.md', 'Tasks', [['- [ ] a']], {createMissing: true})
    expect(created!.data).toContain('## Tasks')
    expect(appendBlocks(bare, 'p.md', 'Inbox', [['- [ ] a']], {createMissing: false})).toBeNull()
  })

  it('finds the heading of a CRLF note and re-terminates the landed lines', () => {
    const crlf = '# P\r\n\r\n## Tasks\r\n'
    const result = appendBlocks(crlf, 'p.md', 'Tasks', [['- [ ] a']], {createMissing: true})
    expect(result!.data).toBe('# P\r\n\r\n## Tasks\r\n- [ ] a\r\n')
  })

  it('a heading created in a CRLF note takes the note\'s ending too', () => {
    const result = appendBlocks('# P\r\n', 'p.md', 'Tasks', [['- [ ] a']], {createMissing: true})
    // The note had no text after its final newline, so the landing ends the file (as on an LF note).
    expect(result!.data).toBe('# P\r\n\r\n## Tasks\r\n\r\n- [ ] a\r')
    expect(result!.data.includes('\n\n')).toBe(false)
  })
})

describe('planCut and cutIfUnchanged', () => {
  it('cuts a root with its children, skipping stale selections', () => {
    const plan = planCut(NOTE, [
      {line: 3, sourceLine: '- [ ] alpha'},
      {line: 5, sourceLine: '- [ ] changed'},
    ])
    expect(plan.stale).toBe(1)
    expect(plan.blocks).toEqual([['- [ ] alpha', '  - [ ] alpha child']])
    expect(plan.removedLines).toEqual([3, 4])
    const cut = cutIfUnchanged(NOTE, NOTE, 'd.md', plan)
    expect(cut.cut).toBe(true)
    expect(cut.data.split('\n')).toEqual(['# Day', '', '# Inbox', '- [ ] beta', ''])
    expect(cut.records).toEqual([
      {kind: 'remove', file: 'd.md', line: 3, text: '- [ ] alpha'},
      {kind: 'remove', file: 'd.md', line: 4, text: '  - [ ] alpha child'},
    ])
  })

  it('a note that changed in the window keeps its lines — a duplicate, never a loss', () => {
    const plan = planCut(NOTE, [{line: 3, sourceLine: '- [ ] alpha'}])
    const changed = NOTE.replace('beta', 'beta edited')
    const cut = cutIfUnchanged(changed, NOTE, 'd.md', plan)
    expect(cut.cut).toBe(false)
    expect(cut.data).toBe(changed)
    expect(cut.records).toEqual([])
  })
})

describe('round trip through the journal', () => {
  it('a replace undoes to the byte', () => {
    const forward = replaceLines(NOTE, 'd.md', [{line: 3, sourceLine: '- [ ] alpha'}], transformFor({kind: 'set-due', date: '2026-10-01'}))
    const back = undoRecordsInFile(forward.data.split('\n'), forward.records)
    expect(back.stale).toBe(0)
    expect(back.lines.join('\n')).toBe(NOTE)
  })

  it('a relocation undoes on both sides: the landed lines leave, the cut lines return', () => {
    const project = ['# P', '', '## Tasks', ''].join('\n')
    const plan = planCut(NOTE, [{line: 3, sourceLine: '- [ ] alpha'}])
    const landed = appendBlocks(project, 'p.md', 'Tasks', plan.blocks, {createMissing: true})!
    const cut = cutIfUnchanged(NOTE, NOTE, 'd.md', plan)
    const projectBack = undoRecordsInFile(landed.data.split('\n'), landed.records)
    const noteBack = undoRecordsInFile(cut.data.split('\n'), cut.records)
    expect(projectBack.lines.join('\n')).toBe(project)
    expect(noteBack.lines.join('\n')).toBe(NOTE)
    expect(projectBack.stale + noteBack.stale).toBe(0)
  })
})
