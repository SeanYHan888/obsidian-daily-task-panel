import {fakeProjectStore} from './project-store'

import type {Prompter, ProjectChoice} from '../../src/core/actions'
import type {JournalEntry} from '../../src/core/journal'
import type {LineEditor, Ports, TaskSource} from '../../src/core/ports'
import type {ProjectMeta, Task} from '../../src/core/types'

/**
 * The second adapters at the task-source and line-editor seams: in memory,
 * for tests. The editor performs nothing — it records what it was asked and
 * answers with a journal entry whose label names the call, so a suite can
 * assert exactly which edit reached which lines.
 */
export type EditorCall = {op: string; tasks: string[]; args: unknown[]}

export type FakeEditor = LineEditor & {calls: EditorCall[]}

const entry = (label: string, tasks: readonly Task[]): JournalEntry | null =>
  tasks.length === 0
    ? null
    : {
        label,
        records: tasks.map(t => ({
          kind: 'replace' as const,
          file: t.filePath,
          line: t.line,
          before: t.sourceLine,
          after: t.sourceLine,
        })),
      }

export const fakeEditor = (): FakeEditor => {
  const editor: FakeEditor = {
    calls: [],
    reschedule: (tasks, date, today) => {
      editor.calls.push({op: 'reschedule', tasks: tasks.map(t => t.description), args: [date, today]})
      return Promise.resolve(entry(`start → ${date}`, tasks))
    },
    unschedule: tasks => {
      editor.calls.push({op: 'unschedule', tasks: tasks.map(t => t.description), args: []})
      return Promise.resolve(entry('start cleared', tasks))
    },
    setDue: (tasks, date) => {
      editor.calls.push({op: 'setDue', tasks: tasks.map(t => t.description), args: [date]})
      return Promise.resolve(entry(`due → ${date}`, tasks))
    },
    clearDue: tasks => {
      editor.calls.push({op: 'clearDue', tasks: tasks.map(t => t.description), args: []})
      return Promise.resolve(entry('due cleared', tasks))
    },
    cancel: task => {
      editor.calls.push({op: 'cancel', tasks: [task.description], args: []})
      return Promise.resolve(entry('cancelled 1 task', [task]))
    },
    editText: (task, text) => {
      editor.calls.push({op: 'editText', tasks: [task.description], args: [text]})
      return Promise.resolve(entry('edited the text of 1 task', [task]))
    },
    moveToProject: (tasks, projectPath) => {
      editor.calls.push({op: 'moveToProject', tasks: tasks.map(t => t.description), args: [projectPath]})
      return Promise.resolve({moved: tasks.length, entry: entry(`moved to ${projectPath}`, tasks)})
    },
    sendBackToInbox: (tasks, today) => {
      editor.calls.push({op: 'sendBackToInbox', tasks: tasks.map(t => t.description), args: [today]})
      return Promise.resolve({moved: tasks.length, entry: entry('sent back to To-do', tasks)})
    },
    addTask: (projectPath, text) => {
      editor.calls.push({op: 'addTask', tasks: [], args: [projectPath, text]})
      return Promise.resolve({label: `added a task to ${projectPath}`, records: []})
    },
  }
  return editor
}

export type FakeTaskSource = TaskSource & {tasks: Task[]; toggled: string[]}

export const fakeTaskSource = (tasks: Task[]): FakeTaskSource => {
  const source: FakeTaskSource = {
    tasks,
    toggled: [],
    available: () => true,
    read: () => source.tasks,
    toggle: task => {
      source.toggled.push(task.description)
      return Promise.resolve()
    },
    onChange: () => () => {},
  }
  return source
}

/** Answers in the order the acts ask; an unscripted question answers null (the user closed the modal). */
export type FakePrompter = Prompter & {asked: string[]}

export const fakePrompter = (script: {
  text?: (string | null)[]
  date?: (string | null)[]
  confirm?: boolean[]
  project?: (ProjectChoice | null)[]
}): FakePrompter => {
  const text = [...(script.text ?? [])]
  const date = [...(script.date ?? [])]
  const confirms = [...(script.confirm ?? [])]
  const project = [...(script.project ?? [])]
  const prompter: FakePrompter = {
    asked: [],
    askText: opts => {
      prompter.asked.push(`text:${opts.title}`)
      return Promise.resolve(text.shift() ?? null)
    },
    askDate: opts => {
      prompter.asked.push(`date:${opts.title}`)
      return Promise.resolve(date.shift() ?? null)
    },
    confirm: opts => {
      prompter.asked.push(`confirm:${opts.title}`)
      return Promise.resolve(confirms.shift() ?? false)
    },
    pickProject: () => {
      prompter.asked.push('project')
      return Promise.resolve(project.shift() ?? null)
    },
  }
  return prompter
}

export const fakePorts = (tasks: Task[], projects: ProjectMeta[]): Ports & {
  tasks: FakeTaskSource
  editor: FakeEditor
  projects: ReturnType<typeof fakeProjectStore>
} => ({
  tasks: fakeTaskSource(tasks),
  projects: fakeProjectStore(projects),
  editor: fakeEditor(),
  layout: () => {
    throw new Error('tests pass the layout in the action context')
  },
})
