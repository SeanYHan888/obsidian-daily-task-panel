/**
 * The undo journal (ADR-0001 upheld): a session log of line edits, never a
 * store of tasks. Each panel action becomes one entry; undoing an entry
 * verifies every line still reads what the action left before restoring it —
 * the same skip-and-report discipline forward edits use.
 */

export type LineRecord =
  /** A line changed in place; undo restores `before` if it still reads `after`. */
  | {kind: 'replace'; file: string; line: number; before: string; after: string}
  /** A line the action inserted (post-insert index); undo removes it if it still reads `text`. */
  | {kind: 'insert'; file: string; line: number; text: string}
  /** A line the action removed (pre-removal index); undo re-inserts it. */
  | {kind: 'remove'; file: string; line: number; text: string}

export type JournalEntry = {
  /** Glossary-phrased summary shown in the undo notice, e.g. "moved 3 tasks to colm-paper". */
  label: string
  records: LineRecord[]
}

/** An action that changed nothing journals nothing. */
export const toJournalEntry = (label: string, records: LineRecord[]): JournalEntry | null =>
  records.length > 0 ? {label, records} : null

/** How many actions the session remembers; older ones fall off the bottom. */
export const JOURNAL_DEPTH = 50

export type Journal = readonly JournalEntry[]

/** Records an action; the oldest entry leaves once the journal is full. */
export const pushEntry = (journal: Journal, entry: JournalEntry, depth = JOURNAL_DEPTH): JournalEntry[] =>
  [...journal, entry].slice(-depth)

export type Taken =
  | {reason: 'taken'; journal: JournalEntry[]; entry: JournalEntry}
  | {reason: 'empty' | 'already-undone'; journal: JournalEntry[]; entry: null}

/**
 * Takes the entry to undo out of the journal: the one asked for (a notice's
 * own Undo link, which may be old), else the latest. An entry no longer in
 * the journal was already undone — a second click on the same link.
 */
export const takeEntry = (journal: Journal, entry?: JournalEntry): Taken => {
  const target = entry ?? journal[journal.length - 1]
  if (!target) return {reason: 'empty', journal: [...journal], entry: null}
  const index = journal.lastIndexOf(target)
  if (index === -1) return {reason: 'already-undone', journal: [...journal], entry: null}
  return {reason: 'taken', journal: journal.filter((_, i) => i !== index), entry: target}
}

export type UndoPlan = {path: string; records: LineRecord[]}[]

/**
 * One entry's records grouped per note, in the order that mirrors the
 * forward move's duplicate-safe ordering in reverse: notes getting lines
 * back (undone removals) before notes losing them (undone inserts), so an
 * interruption can leave a duplicate but never a lost task.
 */
export const undoPlan = (entry: JournalEntry): UndoPlan => {
  const byFile = new Map<string, LineRecord[]>()
  for (const record of entry.records) {
    const list = byFile.get(record.file)
    if (list) list.push(record)
    else byFile.set(record.file, [record])
  }
  const rank = (records: LineRecord[]) => (records.some(r => r.kind === 'remove') ? 0 : 1)
  return [...byFile.entries()]
    .map(([path, records]) => ({path, records}))
    .sort((a, b) => rank(a.records) - rank(b.records))
}

export type UndoOutcome = {reverted: number; stale: number}

/** What undo has to say, in the words the notice always used. */
export const undoNotice = (
  result: {reason: 'empty'} | {reason: 'already-undone'} | {reason: 'undone'; label: string; stale: number},
): string => {
  switch (result.reason) {
    case 'empty':
      return 'Daily task panel: nothing to undo'
    case 'already-undone':
      return 'Daily task panel: that action was already undone'
    case 'undone':
      return result.stale > 0
        ? `Daily task panel: undid "${result.label}" — ${result.stale} line${result.stale === 1 ? '' : 's'} changed since last refresh — skipped`
        : `Daily task panel: undid "${result.label}"`
  }
}

export type UndoFileResult = {lines: string[]; reverted: number; stale: number}

/**
 * Applies the inverse of one entry's records for a single file to its lines.
 */
export const undoRecordsInFile = (
  lines: string[],
  records: LineRecord[],
): UndoFileResult => {
  const result = [...lines]
  let reverted = 0
  let stale = 0

  for (const record of records) {
    if (record.kind !== 'replace') continue
    if (result[record.line] === record.after) {
      result[record.line] = record.before
      reverted++
    } else {
      stale++
    }
  }

  // Inserted lines are removed highest-first so earlier indices stay valid.
  const inserts = records
    .filter(r => r.kind === 'insert')
    .sort((a, b) => b.line - a.line)
  for (const record of inserts) {
    if (result[record.line] === record.text) {
      result.splice(record.line, 1)
      reverted++
    } else {
      stale++
    }
  }

  // Removed lines are re-inserted at ascending pre-removal indices, which
  // reconstructs the original layout exactly. Restoring content is the
  // non-destructive direction, so the only gate is against duplication: a
  // line the note already contains again (restored by hand since) is
  // skipped as stale rather than doubled. A shrunken note clamps the index.
  const removes = records
    .filter(r => r.kind === 'remove')
    .sort((a, b) => a.line - b.line)
  for (const record of removes) {
    if (result.includes(record.text)) {
      stale++
      continue
    }
    result.splice(Math.min(record.line, result.length), 0, record.text)
    reverted++
  }

  return {lines: result, reverted, stale}
}
