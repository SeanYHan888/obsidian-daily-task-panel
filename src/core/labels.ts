import type {LineRecord} from './journal'

/**
 * The one naming rule for a task's source: the note's basename, extension
 * dropped. Machine-managed notes get no special label — the note's own name
 * is the honest one (a vendor label lived here once and diverged from the
 * row fallback).
 */
export const sourceLabel = (filePath: string): string =>
  (filePath.split('/').pop() ?? '').replace(/\.md$/, '')

/** Notice and journal-label grammar: "1 task", "3 tasks". */
export const plural = (n: number): string => `${n} task${n === 1 ? '' : 's'}`

export type ProjectDateEdit = {field: 'start' | 'deadline'; date: string | null}

/**
 * The notice for a project date edit (#23): what was written, and — when
 * the start now sits past the deadline — the contradiction, named with both
 * dates. Warn, never block: the write has already happened by the time this
 * is read. The same day is a one-day project, not a contradiction.
 */
export const projectDateNotice = (
  project: {name: string; start: string | null; deadline: string | null},
  edit: ProjectDateEdit,
): string => {
  const base =
    edit.date == null
      ? `Daily Task Panel: ${project.name} ${edit.field} cleared`
      : `Daily Task Panel: ${project.name} ${edit.field} → ${edit.date}`
  const start = edit.field === 'start' ? edit.date : project.start
  const deadline = edit.field === 'deadline' ? edit.date : project.deadline
  if (edit.date == null || start == null || deadline == null || start <= deadline) return base
  const day = (iso: string) => iso.slice(5)
  return edit.field === 'start'
    ? `${base} — start ${day(start)} is after deadline ${day(deadline)}`
    : `${base} — deadline ${day(deadline)} is before start ${day(start)}`
}

/**
 * The journal label for a task date edit — the same word the menu item
 * used (CONTEXT.md: Menu order), so notice and undo link speak as the menu
 * did: "start → 2026-09-15 on 3 tasks", "due cleared on 1 task".
 */
export const dateEditLabel = (
  field: 'start' | 'due',
  count: number,
  date: string | null,
): string =>
  date == null ? `${field} cleared on ${plural(count)}` : `${field} → ${date} on ${plural(count)}`

/**
 * The label for a re-dating names the field that actually took the date:
 * the start, or — on the spent-deadline path, where setScheduled moves the
 * 📅 and writes no ⏳ — the due. A sweep that did both names only the date.
 */
export const rescheduleLabel = (records: readonly LineRecord[], date: string): string => {
  const written = (r: LineRecord) => (r.kind === 'replace' ? r.after : r.text)
  const holds = (emoji: string) => (r: LineRecord) => new RegExp(`${emoji}\\s*${date}`, 'u').test(written(r))
  if (records.every(holds('⏳'))) return dateEditLabel('start', records.length, date)
  if (records.every(r => holds('📅')(r) && !/⏳/u.test(written(r))))
    return dateEditLabel('due', records.length, date)
  return `${plural(records.length)} → ${date}`
}
