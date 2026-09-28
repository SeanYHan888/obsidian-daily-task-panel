import {assert, test} from 'vitest'

import {canMove, canPlace, compareProjects, movableProjects, moveWrites, organizeByStatus, placeWrites, placementEdge, topRank} from '../src/core/order'

import {projectMenuSpec} from '../src/core/menus'

import type {ProjectGroup, ProjectMeta} from '../src/core/types'

const meta = (name: string, overrides: Partial<ProjectMeta> = {}): ProjectMeta => ({
  path: `Projects/Active/${name}.md`,
  name,
  status: 'next',
  deadline: null,
  order: null,
  start: null,
  ...overrides,
})

/** Applies writes and re-sorts — what the panel shows after the notes are written. */
const after = (projects: ProjectMeta[], writes: {path: string; order: number}[]) =>
  projects
    .map(p => ({...p, order: writes.find(w => w.path === p.path)?.order ?? p.order}))
    .sort((a, b) => compareProjects(a, b, 'hybrid'))
    .map(p => p.name)

test('topRank goes one below the lowest rank, and starts at zero', () => {
  assert.equal(topRank([meta('a'), meta('b')]), 0)
  assert.equal(topRank([meta('a', {order: 3}), meta('b', {order: -1})]), -2)
})

test('move to top is one write; at the top already it is none', () => {
  const list = [meta('a', {order: 1}), meta('b', {order: 2}), meta('c')]
  assert.deepEqual(moveWrites(list, 'Projects/Active/c.md', 'top'), [
    {path: 'Projects/Active/c.md', order: 0},
  ])
  assert.deepEqual(after(list, moveWrites(list, 'Projects/Active/c.md', 'top')), ['c', 'a', 'b'])
  assert.deepEqual(moveWrites(list, 'Projects/Active/a.md', 'top'), [])
})

test('up and down among ranked projects re-stamp only what the new sequence needs', () => {
  const list = [meta('a', {order: 1}), meta('b', {order: 2}), meta('c', {order: 3}), meta('d', {order: 4})]
  const up = moveWrites(list, 'Projects/Active/c.md', 'up')
  assert.deepEqual(after(list, up), ['a', 'c', 'b', 'd'])
  assert.isAtMost(up.length, 2)
  const down = moveWrites(list, 'Projects/Active/a.md', 'down')
  assert.deepEqual(after(list, down), ['b', 'a', 'c', 'd'])
  assert.deepEqual(moveWrites(list, 'Projects/Active/a.md', 'up'), [])
  assert.deepEqual(moveWrites(list, 'Projects/Active/d.md', 'down'), [])
})

test('an unranked neighbour gets a rank on demand, and only the notes involved are written', () => {
  // Display order: ranked prefix, then unranked under the pacing rules.
  const list = [meta('a', {order: 1}), meta('b'), meta('c'), meta('d')]
  const up = moveWrites(list, 'Projects/Active/c.md', 'up')
  assert.deepEqual(after(list, up), ['a', 'c', 'b', 'd'])
  assert.notInclude(up.map(w => w.path), 'Projects/Active/d.md')
  const down = moveWrites(list, 'Projects/Active/a.md', 'down')
  assert.deepEqual(after(list, down), ['b', 'a', 'c', 'd'])
})

test('move to bottom lands below the unranked tail, ranking the tail on the way', () => {
  const list = [meta('a', {order: 1}), meta('b', {order: 2}), meta('c'), meta('d')]
  const writes = moveWrites(list, 'Projects/Active/a.md', 'bottom')
  assert.deepEqual(after(list, writes), ['b', 'c', 'd', 'a'])
  assert.deepEqual(moveWrites(list, 'Projects/Active/d.md', 'bottom'), [])
})

test('a project not in the movable list moves nothing', () => {
  assert.deepEqual(moveWrites([meta('a')], 'Projects/Active/zzz.md', 'up'), [])
})

test('organize by status regroups now → next → later, keeping order inside each tier', () => {
  const list = [
    meta('later-first', {status: 'later', order: 1}),
    meta('now-second', {status: 'now', order: 2}),
    meta('next-third', {status: 'next', order: 3}),
    meta('now-unranked', {status: 'now'}),
    meta('later-unranked', {status: 'later'}),
  ]
  const writes = organizeByStatus(list, 'hybrid')
  assert.deepEqual(after(list, writes), [
    'now-second',
    'now-unranked',
    'next-third',
    'later-first',
    'later-unranked',
  ])
  // Ranks are 1..n and the act is idempotent.
  const organized = list.map(p => ({...p, order: writes.find(w => w.path === p.path)?.order ?? p.order}))
  assert.deepEqual([...organized.map(p => p.order)].sort((x, y) => x! - y!), [1, 2, 3, 4, 5])
  assert.deepEqual(organizeByStatus(organized, 'hybrid'), [])
})

test('organize writes nothing for projects already holding their new rank', () => {
  const list = [meta('a', {status: 'now', order: 1}), meta('b', {status: 'next'})]
  assert.deepEqual(organizeByStatus(list, 'hybrid'), [{path: 'Projects/Active/b.md', order: 2}])
})

test('a dropped header takes the target slot: before it dragging up, after it dragging down (#21)', () => {
  const list = [meta('a', {order: 1}), meta('b', {order: 2}), meta('c', {order: 3}), meta('d')]
  const P = (n: string) => `Projects/Active/${n}.md`
  assert.deepEqual(after(list, placeWrites(list, P('a'), P('c'))), ['b', 'c', 'a', 'd'])
  assert.deepEqual(after(list, placeWrites(list, P('d'), P('b'))), ['a', 'd', 'b', 'c'])
  // Landing first is the one-write top rank.
  assert.deepEqual(placeWrites(list, P('c'), P('a')), [{path: P('c'), order: 0}])
  assert.deepEqual(after(list, placeWrites(list, P('c'), P('a'))), ['c', 'a', 'b', 'd'])
})

test('canPlace: both in the movable list and different; nothing else drops (#21)', () => {
  const list = [meta('a'), meta('b')]
  assert.isTrue(canPlace(list, 'Projects/Active/a.md', 'Projects/Active/b.md'))
  assert.isFalse(canPlace(list, 'Projects/Active/a.md', 'Projects/Active/a.md'))
  assert.isFalse(canPlace(list, 'Projects/Active/a.md', 'Projects/Active/arrived.md'))
  assert.deepEqual(placeWrites(list, 'Projects/Active/a.md', 'Projects/Active/a.md'), [])
})

test('the movable band is the Backlogs minus arrived deadlines and unstarted projects (#22)', () => {
  const group = (
    name: string,
    urgency: 'ahead' | 'arrived' | null,
    unstarted: boolean,
  ): ProjectGroup => ({project: meta(name), tasks: [], urgency, pressing: false, unstarted})
  const groups = [
    group('came-due', 'arrived', false),
    group('a', 'ahead', false),
    group('b', null, false),
    group('waiting', null, true),
  ]
  assert.deepEqual(
    movableProjects(groups).map(p => p.name),
    ['a', 'b'],
  )
})

test('canMove: the ends of the movable band and anything outside it are pinned (#20, #22)', () => {
  const group = (name: string, urgency: 'arrived' | null, unstarted: boolean): ProjectGroup => ({
    project: meta(name),
    tasks: [],
    urgency,
    pressing: false,
    unstarted,
  })
  const groups = [
    group('came-due', 'arrived', false),
    group('first', null, false),
    group('middle', null, false),
    group('last', null, false),
    group('waiting', null, true),
  ]
  const P = (n: string) => `Projects/Active/${n}.md`
  assert.deepEqual(canMove(groups, P('first')), {up: false, down: true})
  assert.deepEqual(canMove(groups, P('middle')), {up: true, down: true})
  assert.deepEqual(canMove(groups, P('last')), {up: true, down: false})
  assert.deepEqual(canMove(groups, P('came-due')), {up: false, down: false})
  assert.deepEqual(canMove(groups, P('waiting')), {up: false, down: false})
  // Which is what disables all four Move items for an unstarted project.
  const disabled = projectMenuSpec(meta('waiting'), {
    pacingMode: 'hybrid',
    pressing: false,
    canMove: canMove(groups, P('waiting')),
  }).filter(e => e.kind === 'item' && e.action.type === 'move' && e.disabled)
  assert.lengthOf(disabled, 4)
})

test('placementEdge names the side placeWrites lands on, and nothing when a drop changes nothing', () => {
  const P = (n: string) => `Projects/Active/${n}.md`
  const list = ['a', 'b', 'c', 'd'].map((n, i) => ({...meta(n), order: i + 1}))
  assert.equal(placementEdge(list, P('a'), P('c')), 'after')
  assert.equal(placementEdge(list, P('d'), P('b')), 'before')
  assert.equal(placementEdge(list, P('c'), P('a')), 'before')
  assert.equal(placementEdge(list, P('a'), P('a')), null)
  assert.equal(placementEdge(list, P('zzz'), P('a')), null)
  // The highlight's side and the write's landing agree: a lands after c, d before b.
  assert.deepEqual(after(list, placeWrites(list, P('a'), P('c'))), ['b', 'c', 'a', 'd'])
  assert.deepEqual(after(list, placeWrites(list, P('d'), P('b'))), ['a', 'd', 'b', 'c'])
})
