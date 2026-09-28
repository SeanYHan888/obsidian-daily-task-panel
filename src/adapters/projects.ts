import {Notice, TAbstractFile, TFile, TFolder, Vault, normalizePath} from 'obsidian'

import {inFolder} from '../core/classify'
import {headingLine} from '../core/move'

import type {App} from 'obsidian'
import type {ProjectMeta, ProjectPatch, ProjectStatus} from '../core/types'

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
    new Notice(`Daily task panel: project note not found: ${projectPath}`)
    return false
  }
  await app.fileManager.processFrontMatter(file, mutate)
  return true
}

/** Applies a patch to the note's frontmatter in one edit; a null value removes its key. */
export const writeProject = (app: App, projectPath: string, patch: ProjectPatch): Promise<boolean> =>
  editFrontmatter(app, projectPath, frontmatter => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      if (value === null) delete frontmatter[key]
      else frontmatter[key] = value
    }
  })

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
    new Notice(`Daily task panel: project note not found: ${projectPath}`)
    return false
  }

  const folder = normalizePath(archiveFolder)
  const target = normalizePath(`${folder}/${file.name}`)
  if (app.vault.getAbstractFileByPath(target)) {
    new Notice(`Daily task panel: "${file.basename}" already exists in ${folder} — move it by hand`)
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
    new Notice(`Daily task panel: project note not found: ${projectPath}`)
    return null
  }
  const target = normalizePath(`${file.parent?.path ?? ''}/${name}.${file.extension}`)
  if (target === file.path) return null
  if (app.vault.getAbstractFileByPath(target)) {
    new Notice(`Daily task panel: "${name}" already exists — pick another name`)
    return null
  }
  try {
    await app.fileManager.renameFile(file, target)
  } catch (error) {
    new Notice(`Daily task panel: could not rename to "${name}" — ${String(error)}`)
    return null
  }
  return target
}

/** The built-in scaffold: only what the panel itself reads — a status and the move-target heading. No vault-specific frontmatter conventions (#6). */
const FALLBACK_TEMPLATE = (name: string, heading: string) => `---
status: later
---
# ${name}

${heading}
`

/**
 * Creates a project note from the configured template, or from the built-in
 * scaffold when no template is set or the note is missing — "New project"
 * never dead-ends (#6). The heading comes from the move-target setting,
 * never hardcoded. Returns the existing note if the name is already taken.
 */
export const createProjectFromTemplate = async (
  app: App,
  rawName: string,
  projectsFolder: string,
  templatePath: string,
  targetHeading: string,
  today: string,
): Promise<TFile | null> => {
  const name = rawName.replace(/[\\/:#^[\]|]/g, ' ').trim()
  if (!name) return null
  const folder = projectsFolder.replace(/\/$/, '')
  const path = `${folder}/${name}.md`

  const existing = app.vault.getAbstractFileByPath(path)
  if (existing instanceof TFile) {
    new Notice(`Daily task panel: project "${name}" already exists — moving into it`)
    return existing
  }
  if (folder && !app.vault.getAbstractFileByPath(folder)) {
    await app.vault.createFolder(folder)
  }

  const templateFile = templatePath ? app.vault.getAbstractFileByPath(templatePath) : null
  if (templateFile instanceof TFile) {
    const content = (await app.vault.read(templateFile))
      .replaceAll('{{title}}', name)
      .replaceAll('{{date:YYYY-MM-DD}}', today)
    return app.vault.create(path, content)
  }

  return app.vault.create(path, FALLBACK_TEMPLATE(name, headingLine(targetHeading)))
}
