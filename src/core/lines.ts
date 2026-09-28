/**
 * Line endings at the file boundary. Obsidian hands over a note's raw text,
 * and splitting it on '\n' leaves a trailing '\r' on every line of a CRLF
 * note. The Tasks plugin splits the same way, so its originalMarkdown — the
 * write fingerprint — carries the same '\r'. Core's line transforms anchor on
 * the end of the line and know nothing of this: they get bare lines, and the
 * '\r' goes back on afterwards. Lines that travel between notes take the
 * ending of the note they land in, never the one they left.
 */

/** The line without its trailing '\r', if it had one. */
export const stripCr = (line: string): string => (line.endsWith('\r') ? line.slice(0, -1) : line)

/** Two raw lines are the same task line when they agree apart from a trailing '\r'. */
export const sameLine = (a: string, b: string): boolean => stripCr(a) === stripCr(b)

/** The '\r' a note's lines carry — '' for an LF note — read off its raw text. */
export const carriageReturn = (data: string): '\r' | '' => (data.includes('\r\n') ? '\r' : '')

/**
 * Applies a core transform to one raw line: bare in, and every line the
 * transform produces (completion may yield two — a recurrence and the done
 * task) ends the way the original did.
 */
export const editLine = (line: string, transform: (bare: string) => string): string => {
  const cr = line.endsWith('\r') ? '\r' : ''
  return transform(stripCr(line))
    .split('\n')
    .map(l => l + cr)
    .join('\n')
}

/** Lines re-terminated for the note they are about to land in. */
export const withEnding = (lines: readonly string[], cr: '\r' | ''): string[] =>
  lines.map(l => stripCr(l) + cr)
