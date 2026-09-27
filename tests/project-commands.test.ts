import {describe, expect, it} from 'vitest'

import {
  commitStatus,
  moveProject,
  organizeProjects,
  placeProject,
  setProjectDate,
} from '../src/core/project-commands'
import {fakeProjectStore} from './fakes/project-store'

import type {ProjectGroup, ProjectMeta, Sections} from '../src/core/types'

const project = (path: string, meta: Partial<ProjectMeta> = {}): ProjectMeta => ({
  path: `Projects/Active/${path}.md`,
  name: path,
  status: 'later',
  deadline: null,
  order: null,
  start: null,
  ...meta,
})

const group = (p: ProjectMeta, extra: Partial<ProjectGroup> = {}): ProjectGroup => ({
  project: p,
  tasks: [],
  urgency: null,
  pressing: false,
  unstarted: false,
  ...extra,
})

const sections = (groups: ProjectGroup[]): Sections => ({
  today: [],
  slipped: [],
  upcoming: [],
  inbox: [],
  projects: groups,
  wipNowCount: groups.filter(g => g.project.status === 'now').length,
})

describe('commitStatus', () => {
  const a = project('a', {status: 'now', order: 1})
  const b = project('b', {status: 'now', order: 2})
  const c = project('c', {status: 'next'})

  it('commits to now in one write that also lifts the project to the top', async () => {
    const store = fakeProjectStore([a, b, c])
    const outcome = await commitStatus(store, c, 'now', {sections: sections([]), wipLimit: 3})
    expect(store.writes).toEqual([{path: c.path, patch: {status: 'now', order: 0}}])
    expect(outcome.written).toBe(true)
    expect(outcome.notice).toBe('Daily Task Panel: c → now')
  })

  it('names the capacity consequence past the limit — from the menu as from the → now button', async () => {
    const store = fakeProjectStore([a, b, c])
    const shown = sections([group(a), group(b)])
    const outcome = await commitStatus(store, c, 'now', {sections: shown, wipLimit: 2})
    expect(outcome.capacity).toEqual({count: 3, over: true})
    expect(outcome.notice).toBe('Daily Task Panel: c → now — now is full (3/2)')
  })

  it('ranks the lift over every active note, not only the ones on screen', async () => {
    const hidden = project('hidden', {status: 'next', order: -5})
    const store = fakeProjectStore([a, hidden, c])
    await commitStatus(store, c, 'now', {sections: sections([group(a)]), wipLimit: 3})
    expect(store.writes[0].patch.order).toBe(-6)
  })

  it('leaves the rank alone for any other status', async () => {
    const store = fakeProjectStore([a, b, c])
    const outcome = await commitStatus(store, a, 'later', {sections: sections([]), wipLimit: 3})
    expect(store.writes).toEqual([{path: a.path, patch: {status: 'later'}}])
    expect(outcome.capacity).toBeNull()
    expect(outcome.notice).toBe('Daily Task Panel: a → later')
  })

  it('reports nothing when the note is gone', async () => {
    const store = fakeProjectStore([a])
    const outcome = await commitStatus(store, c, 'now', {sections: sections([]), wipLimit: 3})
    expect(outcome).toEqual({written: false, notice: null, capacity: null})
  })
})

describe('order commands', () => {
  const a = project('a', {order: 1})
  const b = project('b', {order: 2})
  const c = project('c', {order: 3})
  const shown = [group(a), group(b), group(c)]

  it('moves within the band as shown and writes only the notes involved', async () => {
    const store = fakeProjectStore([a, b, c])
    expect(await moveProject(store, shown, c.path, 'up')).toBe(true)
    // c's rank already sits above a's; only b needs a new one to land below c.
    expect(store.writes).toEqual([{path: b.path, patch: {order: 4}}])
    expect(store.read().map(p => [p.name, p.order])).toEqual([
      ['a', 1],
      ['b', 4],
      ['c', 3],
    ])
  })

  it('a move that changes nothing writes nothing', async () => {
    const store = fakeProjectStore([a, b, c])
    expect(await moveProject(store, shown, a.path, 'up')).toBe(false)
    expect(store.writes).toEqual([])
  })

  it('a drop takes the target slot through the same writer', async () => {
    const store = fakeProjectStore([a, b, c])
    expect(await placeProject(store, shown, a.path, c.path)).toBe(true)
    const ranks = Object.fromEntries(store.read().map(p => [p.name, p.order ?? -Infinity]))
    expect(ranks.a).toBeGreaterThan(ranks.c)
  })

  it('organizes by status over every note and says how many moved', async () => {
    const later = project('later', {status: 'later', order: 1})
    const now = project('now', {status: 'now', order: 2})
    const store = fakeProjectStore([later, now])
    const outcome = await organizeProjects(store, 'hybrid')
    expect(outcome.written).toBe(true)
    expect(outcome.notice).toBe('Daily Task Panel: organized 2 projects by status')
    expect(store.read().map(p => [p.name, p.order])).toEqual([
      ['later', 2],
      ['now', 1],
    ])
    expect((await organizeProjects(store, 'hybrid')).notice).toBe(
      'Daily Task Panel: projects already organized by status',
    )
  })
})

describe('setProjectDate', () => {
  it('writes the field and names the contradiction when a start lands after the deadline', async () => {
    const p = project('p', {deadline: '2026-10-01'})
    const store = fakeProjectStore([p])
    const outcome = await setProjectDate(store, p, {field: 'start', date: '2026-10-05'})
    expect(store.writes).toEqual([{path: p.path, patch: {start: '2026-10-05'}}])
    expect(outcome.notice).toBe(
      'Daily Task Panel: p start → 2026-10-05 — start 10-05 is after deadline 10-01',
    )
  })

  it('clears with null and says so', async () => {
    const p = project('p', {deadline: '2026-10-01'})
    const store = fakeProjectStore([p])
    const outcome = await setProjectDate(store, p, {field: 'deadline', date: null})
    expect(store.writes).toEqual([{path: p.path, patch: {deadline: null}}])
    expect(outcome.notice).toBe('Daily Task Panel: p deadline cleared')
    expect(store.read()[0].deadline).toBeNull()
  })
})
