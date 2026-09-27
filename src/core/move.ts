import {collectDescendantLineNumbers} from './hierarchy'

import type {ListItemRelation} from './hierarchy'

/**
 * Move to project (CONTEXT.md): physically cutting task lines — each with its
 * subtask children — out of a note. Not a copy, not a link.
 *
 * Selected roots nested inside another selected root are folded into the
 * ancestor's block. Each block is dedented so its root sits at column zero,
 * with children keeping their indentation relative to the root.
 */
export const cutTaskBlocks = (
  lines: string[],
  rootLines: number[],
  listItems: ListItemRelation[],
): {remaining: string[]; blocks: string[][]; removedLines: number[]} => {
  const descendantsByRoot = new Map<number, Set<number>>()
  for (const root of rootLines) {
    descendantsByRoot.set(root, collectDescendantLineNumbers(listItems, root))
  }

  const roots = [...rootLines]
    .sort((a, b) => a - b)
    .filter(root =>
      rootLines.every(other => other === root || !descendantsByRoot.get(other)?.has(root)),
    )

  const removed = new Set<number>()
  const blocks: string[][] = []
  for (const root of roots) {
    const blockLines = [...(descendantsByRoot.get(root) ?? [root])]
      .sort((a, b) => a - b)
      .filter(line => line < lines.length)
    blockLines.forEach(line => removed.add(line))

    const indent = lines[root].match(/^\s*/)?.[0] ?? ''
    blocks.push(
      blockLines.map(line =>
        lines[line].startsWith(indent) ? lines[line].slice(indent.length) : lines[line],
      ),
    )
  }

  return {
    remaining: lines.filter((_, index) => !removed.has(index)),
    blocks,
    removedLines: [...removed].sort((a, b) => a - b),
  }
}

/**
 * Add task (#12): one new checkbox line, written verbatim after trimming —
 * typed Tasks-plugin syntax (📅, priorities) passes through unblessed; it is
 * a line, not a note name, so no character stripping. Blank input is inert.
 */
export const newTaskBlock = (text: string): string[][] | null => {
  const trimmed = text.trim()
  return trimmed ? [[`- [ ] ${trimmed}`]] : null
}

/** Heading text as a comparison key: marks dropped, case and edges ignored. */
export const normalizeHeading = (heading: string): string =>
  heading.replace(/^#+\s*/, '').trim().toLowerCase()

/**
 * The heading line a setting names: its own marks when it carries them
 * (`### Tasks`), level 2 otherwise (`Tasks` → `## Tasks`).
 */
export const headingLine = (heading: string): string => {
  const explicitMarks = heading.trim().match(/^#{1,6}(?=\s)/)?.[0]
  return `${explicitMarks ?? '##'} ${heading.replace(/^#+\s*/, '').trim()}`
}

/**
 * Appends blocks under the move-target heading: after the section's last
 * non-blank line, or right after the heading when the section is empty.
 * Reports where the flat block landed so callers can journal the insertion.
 * A missing heading is created at the end of the note (level 2) — unless
 * `createMissing` is off, in which case a missing heading refuses with null
 * (send-back never restructures a daily note).
 */
export const insertUnderHeadingAt = (
  lines: string[],
  heading: string,
  blocks: string[][],
  options: {createMissing: boolean} = {createMissing: true},
): {lines: string[]; insertAt: number; inserted: string[]} | null => {
  const target = normalizeHeading(heading)
  const flat = blocks.flat()

  let headingIndex = -1
  let headingLevel = 0
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.*)$/)
    if (match && normalizeHeading(match[2]) === target) {
      headingIndex = i
      headingLevel = match[1].length
      break
    }
  }

  if (headingIndex === -1) {
    if (!options.createMissing) return null
    const result = [...lines]
    if (result.length > 0 && result[result.length - 1].trim() !== '') result.push('')
    result.push(headingLine(heading), '')
    const insertAt = result.length
    result.push(...flat)
    return {lines: result, insertAt, inserted: flat}
  }

  let sectionEnd = lines.length
  for (let i = headingIndex + 1; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s/)
    if (match && match[1].length <= headingLevel) {
      sectionEnd = i
      break
    }
  }

  let insertAt = headingIndex + 1
  for (let i = sectionEnd - 1; i > headingIndex; i--) {
    if (lines[i].trim() !== '') {
      insertAt = i + 1
      break
    }
  }

  return {
    lines: [...lines.slice(0, insertAt), ...flat, ...lines.slice(insertAt)],
    insertAt,
    inserted: flat,
  }
}

