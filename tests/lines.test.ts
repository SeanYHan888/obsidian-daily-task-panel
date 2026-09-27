import {assert, test} from 'vitest'

import {carriageReturn, editLine, sameLine, stripCr, withEnding} from '../src/adapters/lines'
import {setScheduled} from '../src/core/schedule'

test('a CRLF note is recognised from its raw text; an LF note carries nothing', () => {
  assert.equal(carriageReturn('- [ ] a\r\n- [ ] b\r\n'), '\r')
  assert.equal(carriageReturn('- [ ] a\n- [ ] b\n'), '')
  assert.equal(carriageReturn(''), '')
})

test('the fingerprint check ignores only a trailing carriage return', () => {
  assert.isTrue(sameLine('- [ ] a\r', '- [ ] a'))
  assert.isTrue(sameLine('- [ ] a', '- [ ] a\r'))
  assert.isFalse(sameLine('- [ ] a\r', '- [ ] b\r'))
  assert.isFalse(sameLine('- [ ] a \r', '- [ ] a\r'))
  assert.equal(stripCr('- [ ] a\r'), '- [ ] a')
  assert.equal(stripCr('- [ ] a'), '- [ ] a')
})

test('a date stamped onto a CRLF line lands before the carriage return', () => {
  const after = editLine('- [ ] write intro\r', line => setScheduled(line, '2026-09-28', '2026-09-27'))
  assert.equal(after, '- [ ] write intro ⏳ 2026-09-28\r')
  // The same edit on an LF line adds nothing it didn't have.
  assert.equal(
    editLine('- [ ] write intro', line => setScheduled(line, '2026-09-28', '2026-09-27')),
    '- [ ] write intro ⏳ 2026-09-28',
  )
})

test('a transform that yields two lines terminates both the way the original did', () => {
  const toggle = (bare: string) => `${bare.replace('[ ]', '[x]')}\n${bare}`
  assert.equal(editLine('- [ ] daily 🔁 every day\r', toggle), '- [x] daily 🔁 every day\r\n- [ ] daily 🔁 every day\r')
  assert.equal(editLine('- [ ] daily 🔁 every day', toggle), '- [x] daily 🔁 every day\n- [ ] daily 🔁 every day')
})

test('lines moving between notes take the destination ending', () => {
  assert.deepEqual(withEnding(['- [ ] a\r', '  - [ ] b\r'], ''), ['- [ ] a', '  - [ ] b'])
  assert.deepEqual(withEnding(['- [ ] a', '  - [ ] b'], '\r'), ['- [ ] a\r', '  - [ ] b\r'])
  assert.deepEqual(withEnding(['- [ ] a\r'], '\r'), ['- [ ] a\r'])
})
