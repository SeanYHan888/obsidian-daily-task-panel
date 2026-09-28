<script lang="ts">
  import TaskRow from './TaskRow.svelte'
  import {icon} from './icon'
  import {locationKey} from '../core/hierarchy'
  import {sourceLabel as labelFor} from '../core/labels'
  import {rowAffordances} from '../core/machine-note'
  import {chipLabel, rowChip} from '../core/schedule'

  import type {Subject, Task} from '../core/types'
  import type {RowContext} from './panel-types'

  let {
    task,
    ctx,
    showSource = true,
    slippedActions = false,
    selectMode = false,
    selectedKeys = null,
    onToggleSelect = null,
    nested = false,
  }: {
    task: Task
    ctx: RowContext
    showSource?: boolean
    slippedActions?: boolean
    selectMode?: boolean
    selectedKeys?: ReadonlySet<string> | null
    onToggleSelect?: ((task: Task) => void) | null
    nested?: boolean
  } = $props()

  // Core owns the read-only guard (machine-managed rows get check-off only,
  // ADR-0003); the row just renders it.
  const aff = $derived(
    rowAffordances(task, {
      machineNotePath: ctx.machineNotePath,
      selectMode,
      dragEnabled: ctx.draggable,
    }),
  )
  const canSchedule = $derived(aff.canSchedule)
  const selectable = $derived(aff.selectable && onToggleSelect != null)
  /** This row, as the subject its buttons act on. */
  const subject: Subject = $derived({kind: 'tasks', tasks: [task]})
  const rowDraggable = $derived(aff.draggable)
  const selected = $derived(
    selectedKeys?.has(locationKey(task.filePath, task.line)) ?? false,
  )

  const chipText = (date: string) => chipLabel(date, ctx.today)
  const sourceLabel = $derived(labelFor(task.filePath))
  // The chip rule (CONTEXT.md): one chip, the date that matters next; core decides which.
  const chip = $derived(rowChip(task, ctx.today))
</script>

<div class="dtp-item" class:dtp-item-nested={nested}>
<div
  class="dtp-row"
  class:dtp-row-selected={selected}
  draggable={rowDraggable}
  role="listitem"
  ondragstart={ev => {
    ev.dataTransfer?.setData('text/plain', task.description)
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move'
    ctx.onDragStart(task)
  }}
  ondragend={() => ctx.onDragEnd()}
  oncontextmenu={ev => {
    ev.preventDefault()
    ctx.callbacks.menu({kind: 'row', task, state: {selectable: onToggleSelect != null, selected}}, ev)
  }}
>
  {#if selectable && onToggleSelect}
    <button
      class="dtp-select-box"
      class:dtp-selected={selected}
      role="checkbox"
      aria-checked={selected}
      aria-label="Select task"
      onclick={() => onToggleSelect(task)}
    >{#if selected}<span class="dtp-select-mark" aria-hidden="true" use:icon={'check'}></span>{/if}</button>
  {:else}
    <button
      class="dtp-check"
      aria-label="Complete task"
      onclick={() => ctx.callbacks.act(subject, {type: 'complete'})}
    ></button>
  {/if}
  <button
    class="dtp-text"
    onclick={ev =>
      selectable && onToggleSelect ? onToggleSelect(task) : ctx.callbacks.act(subject, {type: 'open-note'}, ev)}
    onauxclick={ev => {
      if (ev.button === 1 && !(selectable && onToggleSelect)) ctx.callbacks.act(subject, {type: 'open-note'}, ev)
    }}
  >
    <span class="dtp-desc">{task.description}</span>
    {#if showSource}
      <span class="dtp-source">{sourceLabel}</span>
    {/if}
  </button>
  <!-- One chip, the date that matters next (chip rule): the start while it
       is ahead, then the due, else the start. A chip opens what edits it —
       the start menu or the due menu — and the other field is edited from
       the row menu. -->
  {#if chip}
    {#if canSchedule}
      <button
        class="dtp-chip dtp-chip-button"
        class:dtp-chip-due={chip.field === 'due'}
        class:dtp-chip-past={chip.past}
        aria-label={chip.field === 'due' ? 'Edit due date' : 'Edit start'}
        onclick={ev =>
          chip.field === 'due'
            ? ctx.callbacks.menu({kind: 'due', task}, ev)
            : ctx.callbacks.menu({kind: 'start', tasks: [task]}, ev)}
      >
        {chipText(chip.date)}
      </button>
    {:else}
      <span
        class="dtp-chip"
        class:dtp-chip-due={chip.field === 'due'}
        class:dtp-chip-past={chip.past}
      >
        {chipText(chip.date)}
      </span>
    {/if}
  {:else if canSchedule}
    <!-- A press that wanders must stay a click, never lift the row. -->
    <button
      class="dtp-add-date"
      aria-label="Set start"
      onclick={ev => ctx.callbacks.menu({kind: 'start', tasks: [task]}, ev)}
      ondragstart={ev => {
        ev.preventDefault()
        ev.stopPropagation()
      }}
      use:icon={'calendar-plus'}
    ></button>
  {/if}
</div>
{#if slippedActions && canSchedule}
  <div class="dtp-actions">
    <button class="dtp-action" onclick={() => ctx.callbacks.act(subject, {type: 'schedule', kind: 'today'})}>
      today
    </button>
    <button class="dtp-action" onclick={() => ctx.callbacks.act(subject, {type: 'schedule', kind: 'tomorrow'})}>
      tomorrow
    </button>
    <button
      class="dtp-action"
      aria-label="Pick a date"
      onclick={() => ctx.callbacks.act(subject, {type: 'pick-date'})}
      use:icon={'calendar'}
    ></button>
    <button
      class="dtp-action dtp-action-danger"
      aria-label="Cancel task"
      onclick={() => ctx.callbacks.act(subject, {type: 'cancel'})}
      use:icon={'x'}
    ></button>
  </div>
{/if}
{#if task.children.length > 0}
  <div class="dtp-children">
    {#each task.children as child (locationKey(child.filePath, child.line))}
      <TaskRow
        task={child}
        {ctx}
        {showSource}
        {slippedActions}
        {selectMode}
        {selectedKeys}
        {onToggleSelect}
        nested
      />
    {/each}
  </div>
{/if}
</div>
