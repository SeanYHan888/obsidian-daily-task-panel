import {relationsFromLines} from './hierarchy'
import {dateEditLabel, plural, rescheduleLabel} from './labels'
import {carriageReturn, editLine, sameLine, withEnding} from './lines'
import {cutTaskBlocks, insertUnderHeadingAt} from './move'
import {cancelLine, clearDue, clearScheduled, setDue, setScheduled, withTaskWords} from './schedule'

import type {LineRecord} from './journal'

/**
 * Note edits as text in, text out. An adapter's whole job is
 * `vault.process(file, text => text)`; everything inside that callback lives
 * here, pure and tested: the fingerprint check that skips a stale line
 * instead of guessing, the journal records undo relies on (with the indices
 * they refer to), line endings, and the duplicate-safe cut. The adapter is
 * left with the file lookup.
 */

/** A task line's write contract: where it was read and what it read as. */
export type LineRef = {line: number; sourceLine: string}

/** The six per-line edits, named so the label and the transform come from one value. */
export type TaskEdit =
  | {kind: 'reschedule'; date: string; today: string}
  | {kind: 'unschedule'}
  | {kind: 'set-due'; date: string}
  | {kind: 'clear-due'}
  | {kind: 'cancel'}
  | {kind: 'edit-text'; text: string}

export type LineTransform = (bare: string) => string

export const transformFor = (edit: TaskEdit): LineTransform => {
  switch (edit.kind) {
    case 'reschedule':
      return line => setScheduled(line, edit.date, edit.today)
    case 'unschedule':
      return clearScheduled
    case 'set-due':
      return line => setDue(line, edit.date)
    case 'clear-due':
      return clearDue
    case 'cancel':
      return cancelLine
    case 'edit-text':
      return line => withTaskWords(line, edit.text)
  }
}

/** The journal label an edit earns, in the menu's words, over the lines it actually changed. */
export const editLabel = (edit: TaskEdit, records: readonly LineRecord[]): string => {
  const n = records.length
  switch (edit.kind) {
    case 'reschedule':
      return rescheduleLabel(records, edit.date)
    case 'unschedule':
      return dateEditLabel('start', n, null)
    case 'set-due':
      return dateEditLabel('due', n, edit.date)
    case 'clear-due':
      return dateEditLabel('due', n, null)
    case 'cancel':
      return `cancelled ${plural(n)}`
    case 'edit-text':
      return `edited the text of ${plural(n)}`
  }
}

export type ReplaceResult = {
  data: string
  records: LineRecord[]
  /** Lines that no longer read what was selected: skipped, never guessed at. */
  stale: number
}

/**
 * Verify-and-replace: each task's line must still read its sourceLine
 * (endings aside) before the transform touches it. Unchanged lines make no
 * record; every changed one is journaled with what it read before and after.
 */
export const replaceLines = (
  data: string,
  path: string,
  tasks: readonly LineRef[],
  transform: LineTransform,
): ReplaceResult => {
  const lines = data.split('\n')
  const records: LineRecord[] = []
  let stale = 0
  for (const task of tasks) {
    const line = lines[task.line]
    if (line == null || !sameLine(line, task.sourceLine)) {
      stale++
      continue
    }
    const after = editLine(line, transform)
    if (after === line) continue
    lines[task.line] = after
    records.push({kind: 'replace', file: path, line: task.line, before: line, after})
  }
  return {data: lines.join('\n'), records, stale}
}

export type AppendResult = {data: string; records: LineRecord[]}

/**
 * Lands blocks under a heading, re-terminated for the note they land in.
 * Null when the heading is missing and may not be created (send-back never
 * restructures a daily note).
 */
export const appendBlocks = (
  data: string,
  path: string,
  heading: string,
  blocks: readonly string[][],
  options: {createMissing: boolean},
): AppendResult | null => {
  const cr = carriageReturn(data)
  const landing = blocks.map(block => withEnding(block, cr))
  const insertion = insertUnderHeadingAt(data.split('\n'), heading, landing, options)
  if (!insertion) return null
  const records = insertion.inserted.map(
    (text, i): LineRecord => ({kind: 'insert', file: path, line: insertion.insertAt + i, text}),
  )
  // A heading created on the way in is bare; every line but the file's last
  // (the '' after a final newline, or an unterminated tail) takes the note's ending.
  const lines = insertion.lines.map((line, i) =>
    cr && i < insertion.lines.length - 1 && !line.endsWith(cr) ? line + cr : line,
  )
  return {data: lines.join('\n'), records}
}

export type CutPlan<T extends LineRef> = {
  /** The tasks whose lines still read as selected. */
  valid: T[]
  /** Their blocks — each root with its subtask children, dedented to column zero. */
  blocks: string[][]
  removedLines: number[]
  /** Selected lines that no longer match the snapshot. */
  stale: number
}

/**
 * What a cut would take out of a note, computed from a snapshot of the
 * exact text about to be edited — descendants come from relations parsed
 * out of that text, never a cache that could lag the file.
 */
export const planCut = <T extends LineRef>(snapshot: string, tasks: readonly T[]): CutPlan<T> => {
  const lines = snapshot.split('\n')
  const valid = tasks.filter(t => lines[t.line] != null && sameLine(lines[t.line], t.sourceLine))
  if (valid.length === 0) return {valid, blocks: [], removedLines: [], stale: tasks.length}
  const {blocks, removedLines} = cutTaskBlocks(
    lines,
    valid.map(t => t.line),
    relationsFromLines(lines),
  )
  return {valid, blocks, removedLines, stale: tasks.length - valid.length}
}

export type CutResult = {data: string; records: LineRecord[]; cut: boolean}

/**
 * The cut half of a relocation, run after the blocks have landed elsewhere:
 * it goes through only if the note still reads exactly as the snapshot the
 * plan was made from. A note that changed in the window keeps its lines —
 * a duplicate to clean up, never a lost task.
 */
export const cutIfUnchanged = (
  data: string,
  snapshot: string,
  path: string,
  plan: CutPlan<LineRef>,
): CutResult => {
  if (data !== snapshot) return {data, records: [], cut: false}
  const lines = data.split('\n')
  const {remaining} = cutTaskBlocks(
    lines,
    plan.valid.map(t => t.line),
    relationsFromLines(lines),
  )
  const records = plan.removedLines.map(
    (line): LineRecord => ({kind: 'remove', file: path, line, text: lines[line]}),
  )
  return {data: remaining.join('\n'), records, cut: true}
}
