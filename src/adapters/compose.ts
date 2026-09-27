import {TFolder, normalizePath} from 'obsidian'

import {
  cancelTask,
  clearDueTasks,
  editTaskText,
  rescheduleTasks,
  setDueTasks,
  unscheduleTasks,
} from './edit-lines'
import {dailyNotesConfig, resolveLayout} from './layout'
import {
  addTaskToProject,
  createProjectFromTemplate,
  moveTasksToProject,
  sendTasksBackToInbox,
} from './move-tasks'
import {
  archiveProject,
  readProjects,
  renameProject,
  setProjectDeadline,
  setProjectOrder,
  setProjectStart,
  setProjectStatus,
} from './projects'
import {getTasksPlugin, onTasksChange, readTasks, toggleTask} from './tasks-plugin'

import type {App} from 'obsidian'
import type {Ports} from '../core/ports'
import type {SetupFacts} from '../core/setup'
import type {PanelSettings} from '../settings'

/**
 * The environment facts setupState maps to messages (#6). Gathered on every
 * refresh, never once at load — a plugin the user enables later must be
 * noticed without a restart.
 */
export const gatherSetupFacts = (app: App, settings: PanelSettings): SetupFacts => ({
  tasksPluginAvailable: getTasksPlugin(app) != null,
  dailyNotesConfigured: dailyNotesConfig(app) != null,
  projectsFolderExists:
    app.vault.getAbstractFileByPath(normalizePath(settings.projectsFolder)) instanceof TFolder,
  templateConfigured: settings.projectTemplatePath !== '',
  templateExists:
    settings.projectTemplatePath !== '' &&
    app.vault.getAbstractFileByPath(normalizePath(settings.projectTemplatePath)) != null,
})

/**
 * Wires the adapter implementations to the core ports (ADR-0004) — the one
 * module that names them. Settings are read through the getter on every call,
 * so a settings change needs no rewiring; the layout is resolved the same way.
 */
export const createPorts = (app: App, settings: () => PanelSettings): Ports => {
  const layout = () => resolveLayout(app, settings())
  return {
    layout,
    tasks: {
      available: () => getTasksPlugin(app) != null,
      read: () => readTasks(app),
      toggle: task => toggleTask(app, task),
      onChange: listener => onTasksChange(app, listener),
    },
    projects: {
      read: () => readProjects(app, layout().projectsFolder),
      setStatus: (path, status) => setProjectStatus(app, path, status),
      setDeadline: (path, deadline) => setProjectDeadline(app, path, deadline),
      setStart: (path, start) => setProjectStart(app, path, start),
      setOrder: (path, order) => setProjectOrder(app, path, order),
      archive: (path, status) => archiveProject(app, path, status, layout().archiveFolder),
      create: async (name, today) => {
        const current = layout()
        const file = await createProjectFromTemplate(
          app,
          name,
          current.projectsFolder,
          current.projectTemplatePath,
          current.moveTargetHeading,
          today,
        )
        return file?.path ?? null
      },
      rename: (path, name) => renameProject(app, path, name),
    },
    editor: {
      reschedule: (tasks, date, today) => rescheduleTasks(app, tasks, date, today),
      unschedule: tasks => unscheduleTasks(app, tasks),
      setDue: (tasks, date) => setDueTasks(app, tasks, date),
      clearDue: tasks => clearDueTasks(app, tasks),
      cancel: task => cancelTask(app, task),
      editText: (task, text) => editTaskText(app, task, text),
      moveToProject: (tasks, projectPath) =>
        moveTasksToProject(app, tasks, projectPath, layout().moveTargetHeading),
      sendBackToInbox: (tasks, today) => sendTasksBackToInbox(app, tasks, layout(), today),
      addTask: (projectPath, text) =>
        addTaskToProject(app, projectPath, text, layout().moveTargetHeading),
    },
  }
}
