import {processNote} from './line-editor'
import {undoRecordsInFile} from '../core/journal'

import type {App} from 'obsidian'
import type {JournalEntry, LineRecord} from '../core/journal'

/**
 * Undoes one journal entry against the vault. Mirrors the forward move's
 * duplicate-safe ordering in reverse: files getting content back (undone
 * removals) are processed before files losing it (undone inserts), so an
 * interruption can leave a duplicate but never a lost task.
 */
export const undoEntry = async (
  app: App,
  entry: JournalEntry,
): Promise<{reverted: number; stale: number}> => {
  const byFile = new Map<string, LineRecord[]>()
  for (const record of entry.records) {
    byFile.set(record.file, [...(byFile.get(record.file) ?? []), record])
  }

  const rank = (records: LineRecord[]) =>
    records.some(r => r.kind === 'remove') ? 0 : 1

  let reverted = 0
  let stale = 0
  const groups = [...byFile.entries()].sort(([, a], [, b]) => rank(a) - rank(b))
  for (const [path, records] of groups) {
    const found = await processNote(app, path, data => {
      const result = undoRecordsInFile(data.split('\n'), records)
      reverted += result.reverted
      stale += result.stale
      return result.lines.join('\n')
    })
    if (!found) stale += records.length
  }
  return {reverted, stale}
}
