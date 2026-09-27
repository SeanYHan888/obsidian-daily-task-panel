import {FuzzySuggestModal, Modal} from 'obsidian'

import type {App, FuzzyMatch} from 'obsidian'
import type {ProjectMeta} from '../core/types'

/**
 * Every panel prompt behind one promise-returning seam. Escape or the
 * backdrop resolves the fallback (false / null), so callers read top to
 * bottom instead of nesting callbacks. The Modal subclasses are
 * implementation, not interface.
 */

const prompt = <T>(
  app: App,
  fallback: T,
  render: (modal: Modal, submit: (value: T) => void) => void,
): Promise<T> =>
  new Promise(resolve => {
    let settled = false
    const done = (value: T) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    new (class extends Modal {
      onOpen(): void {
        render(this, value => {
          // Settle before close(): Modal.close() runs onClose synchronously,
          // and its fallback must lose to the submitted value, not race it.
          done(value)
          this.close()
        })
      }
      onClose(): void {
        this.contentEl.empty()
        done(fallback)
      }
    })(app).open()
  })

const submitButton = (modal: Modal, label: string, onClick: () => void) => {
  const button = modal.contentEl.createEl('button', {
    text: label,
    cls: 'dtp-modal-submit',
  })
  button.addEventListener('click', onClick)
  return button
}

/** One question, one destructive-ish button. */
export const confirm = (
  app: App,
  opts: {title: string; body: string; confirmLabel: string},
): Promise<boolean> =>
  prompt(app, false, (modal, submit) => {
    modal.titleEl.setText(opts.title)
    modal.contentEl.createEl('p', {text: opts.body})
    submitButton(modal, opts.confirmLabel, () => submit(true)).focus()
  })

export const askDate = (
  app: App,
  opts: {defaultDate: string; title?: string; submitLabel?: string},
): Promise<string | null> =>
  prompt(app, null, (modal, submit: (value: string | null) => void) => {
    modal.titleEl.setText(opts.title ?? 'Start on')
    const input = modal.contentEl.createEl('input', {type: 'date'})
    input.value = opts.defaultDate
    const go = () => submit(input.value || null)
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') go()
    })
    submitButton(modal, opts.submitLabel ?? 'Set start', go)
    input.focus()
  })

export const askText = (
  app: App,
  opts: {title: string; placeholder: string; submitLabel: string; value?: string},
): Promise<string | null> =>
  prompt(app, null, (modal, submit: (value: string | null) => void) => {
    modal.titleEl.setText(opts.title)
    const input = modal.contentEl.createEl('input', {
      type: 'text',
      placeholder: opts.placeholder,
      value: opts.value ?? '',
    })
    input.addClass('dtp-modal-input')
    const go = () => {
      const value = input.value.trim()
      if (value) submit(value)
    }
    input.addEventListener('keydown', ev => {
      if (ev.key === 'Enter') go()
    })
    submitButton(modal, opts.submitLabel, go)
    input.focus()
  })

export type ProjectChoice = {kind: 'project'; project: ProjectMeta} | {kind: 'new'; name?: string}

export const pickProject = (
  app: App,
  projects: ProjectMeta[],
): Promise<ProjectChoice | null> =>
  new Promise(resolve => {
    let settled = false
    const done = (choice: ProjectChoice | null) => {
      if (settled) return
      settled = true
      resolve(choice)
    }
    new (class extends FuzzySuggestModal<ProjectChoice> {
      constructor() {
        super(app)
        this.setPlaceholder('Move to project')
      }
      getItems(): ProjectChoice[] {
        return projects.map(project => ({kind: 'project', project}))
      }
      // "+ New project" is pinned outside the fuzzy filter: typing a
      // fresh project's name must not filter away the only way to create
      // it. The typed query rides along as the suggested name.
      getSuggestions(query: string): FuzzyMatch<ProjectChoice>[] {
        const name = query.trim()
        return [
          ...super.getSuggestions(query),
          {item: {kind: 'new', name: name || undefined}, match: {score: 0, matches: []}},
        ]
      }
      getItemText(item: ProjectChoice): string {
        return item.kind === 'new'
          ? item.name
            ? `+ New project: ${item.name}`
            : '+ New project'
          : `${item.project.name}  (${item.project.status ?? 'no status'})`
      }
      onChooseItem(item: ProjectChoice): void {
        done(item)
      }
      onClose(): void {
        // Choosing also closes; give onChooseItem the tick to win first.
        window.setTimeout(() => done(null), 0)
      }
    })().open()
  })
