import type {ProjectStore} from '../../src/core/ports'
import type {ProjectMeta, ProjectPatch} from '../../src/core/types'

/**
 * The second adapter at the project-store seam: in memory, for tests. Holds
 * the projects, applies patches the way the frontmatter adapter does (null
 * clears), and records every write in order so a suite can assert exactly
 * what would have reached the notes.
 */
export type FakeProjectStore = ProjectStore & {
  projects: ProjectMeta[]
  writes: {path: string; patch: ProjectPatch}[]
}

export const fakeProjectStore = (projects: ProjectMeta[]): FakeProjectStore => {
  const store: FakeProjectStore = {
    projects: projects.map(p => ({...p})),
    writes: [],
    read: () => store.projects.map(p => ({...p})),
    onChange: () => () => {},
    write: (path, patch) => {
      const project = store.projects.find(p => p.path === path)
      if (!project) return Promise.resolve(false)
      store.writes.push({path, patch})
      Object.assign(project, patch)
      return Promise.resolve(true)
    },
    archive: () => Promise.resolve(true),
    create: () => Promise.resolve(null),
    rename: () => Promise.resolve(null),
  }
  return store
}
