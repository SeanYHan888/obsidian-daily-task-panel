import {Notice, TAbstractFile, TFile, TFolder, Vault, normalizePath} from 'obsidian'

import {inFolder} from '../core/classify'

import type {App} from 'obsidian'
import type {ProjectMeta, ProjectStatus} from '../core/types'

const ACTIVE_STATUSES: ReadonlySet<string> = new Set(['now', 'next', 'later'])

/** Manual rank (#20): any integer counts; anything else is unranked. */
const readOrder = (raw: unknown): number | null =>
  typeof raw === 'number' && Number.isInteger(raw) ? raw : null

/** Anything that isn't a plain ISO date string is treated as no date — deadline and start alike. */
const readIsoDate = (raw: unknown): string | null =>
  typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null

/**
 * The markdown notes under one folder, subfolders included — a walk of that
 * folder, not a filter over every file in the vault, so the cost follows the
 * projects folder's size rather than the vault's.
 */
const markdownFilesUnder = (app: App, folder: string): TFile[] => {
  const root = app.vault.getFolderByPath(normalizePath(folder))
  if (!(root instanceof TFolder)) return []
  const files: TFile[] = []
  Vault.recurseChildren(root, file => {
    if (file instanceof TFile && file.extension === 'md') files.push(file)
  })
  return files
}

/**
 * Projects are notes in the projects folder; membership is location, status is
 * frontmatter. Retired statuses (done/dropped) fall out of the panel entirely.
 */
export const readProjects = (app: App, projectsFolder: string): ProjectMeta[] => {
  return markdownFilesUnder(app, projectsFolder)
    .map(file => {
      const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter
      const rawStatus: unknown = frontmatter?.status
      const status =
        typeof rawStatus === 'string' && ACTIVE_STATUSES.has(rawStatus)
          ? (rawStatus as ProjectStatus)
          : typeof rawStatus === 'string'
            ? undefined
            : null
      return {
        file,
        status,
        deadline: readIsoDate(frontmatter?.deadline),
        order: readOrder(frontmatter?.order),
        start: readIsoDate(frontmatter?.start),
      }
    })
    .filter(({status}) => status !== undefined)
    .map(({file, status, deadline, order, start}) => ({
      path: file.path,
      name: file.basename,
      status: status as ProjectStatus | null,
      deadline,
      order,
      start,
    }))
}

/**
 * The project store's change signal. Frontmatter edits arrive as metadata
 * changes, filtered to the projects folder so typing elsewhere in the vault
 * costs no projection; a note created, renamed, or deleted anywhere fires
 * unfiltered — rare events, and a rename can carry a note into or out of
 * the folder from either side.
 */
export const onProjectsChange = (
  app: App,
  projectsFolder: () => string,
  listener: () => void,
): (() => void) => {
  const inProjects = (file: TAbstractFile) => inFolder(file.path, projectsFolder())
  const metadataRef = app.metadataCache.on('changed', file => {
    if (inProjects(file)) listener()
  })
  const vaultRefs = [
    app.vault.on('create', listener),
    app.vault.on('delete', listener),
    app.vault.on('rename', listener),
  ]
  return () => {
    app.metadataCache.offref(metadataRef)
    for (const ref of vaultRefs) app.vault.offref(ref)
  }
}

/**
 * Every frontmatter write goes through here: find the note (a missing one
 * is a notice, not a throw), then edit its frontmatter in place. Never
 * journaled — the frontmatter is its own text-editable record.
 */
const editFrontmatter = async (
  app: App,
  projectPath: string,
  mutate: (frontmatter: Record<string, unknown>) => void,
): Promise<boolean> => {
  const file = app.vault.getAbstractFileByPath(projectPath)
  if (!(file instanceof TFile)) {
    new Notice(`Daily Task Panel: project note not found: ${projectPath}`)
    return false
  }
  await app.fileManager.processFrontMatter(file, mutate)
  return true
}

/** Sets one frontmatter key, or removes it on null. */
const setKey = (app: App, projectPath: string, key: string, value: unknown): Promise<boolean> =>
  editFrontmatter(app, projectPath, frontmatter => {
    if (value == null) delete frontmatter[key]
    else frontmatter[key] = value
  })

/** Stamps an active status (now/next/later) into the project's frontmatter. */
export const setProjectStatus = (
  app: App,
  projectPath: string,
  status: ProjectStatus,
): Promise<boolean> => setKey(app, projectPath, 'status', status)

/** Stamps (or clears, on null) the project's deadline. */
export const setProjectDeadline = (
  app: App,
  projectPath: string,
  deadline: string | null,
): Promise<boolean> => setKey(app, projectPath, 'deadline', deadline)

/**
 * Stamps (or clears, on null) the project's start (#23). A start past the
 * deadline is written as asked; naming the contradiction is the notice's job.
 */
export const setProjectStart = (
  app: App,
  projectPath: string,
  start: string | null,
): Promise<boolean> => setKey(app, projectPath, 'start', start)

/** Stamps (or clears, on null) the project's manual rank (#20). */
export const setProjectOrder = (
  app: App,
  projectPath: string,
  order: number | null,
): Promise<boolean> => setKey(app, projectPath, 'order', order)

/**
 * Retires a project: stamps the terminal status into frontmatter and moves
 * the note to the archive folder (renameFile, so links keep working). Task
 * lines are never touched — retiring silences a project, never erases it.
 * The status flip alone already removes it from the panel, so a failed move
 * leaves a consistent, visible-in-vault state.
 */
export const archiveProject = async (
  app: App,
  projectPath: string,
  status: 'done' | 'dropped',
  archiveFolder: string,
): Promise<boolean> => {
  const file = app.vault.getAbstractFileByPath(projectPath)
  if (!(file instanceof TFile)) {
    new Notice(`Daily Task Panel: project note not found: ${projectPath}`)
    return false
  }

  const folder = normalizePath(archiveFolder)
  const target = normalizePath(`${folder}/${file.name}`)
  if (app.vault.getAbstractFileByPath(target)) {
    new Notice(`Daily Task Panel: "${file.basename}" already exists in ${folder} — move it by hand`)
    return false
  }

  await editFrontmatter(app, projectPath, frontmatter => {
    frontmatter.status = status
  })
  if (!app.vault.getAbstractFileByPath(folder)) {
    await app.vault.createFolder(folder)
  }
  await app.fileManager.renameFile(file, target)
  return true
}

/**
 * Renames a project note in its own folder (renameFile, so links keep
 * working). A name already taken is a notice, not an overwrite. Not
 * journaled: the note's name is its own text record.
 */
export const renameProject = async (
  app: App,
  projectPath: string,
  name: string,
): Promise<string | null> => {
  const file = app.vault.getAbstractFileByPath(projectPath)
  if (!(file instanceof TFile)) {
    new Notice(`Daily Task Panel: project note not found: ${projectPath}`)
    return null
  }
  const target = normalizePath(`${file.parent?.path ?? ''}/${name}.${file.extension}`)
  if (target === file.path) return null
  if (app.vault.getAbstractFileByPath(target)) {
    new Notice(`Daily Task Panel: "${name}" already exists — pick another name`)
    return null
  }
  try {
    await app.fileManager.renameFile(file, target)
  } catch (error) {
    new Notice(`Daily Task Panel: could not rename to "${name}" — ${String(error)}`)
    return null
  }
  return target
}
