# Daily Task Panel

The sidebar panel that projects the vault's daily-note → project task workflow into four sections. Every task lives in exactly one markdown file; every view (this panel included) is a projection. Daily Task Panel is the reminder; Day Planner is the calendar — time blocks are never Daily Task Panel's business.

## Language

### Tasks and dates

**Task**:
One markdown checkbox line in the vault. Its file is its home; it has no identity beyond its line.
_Avoid_: todo, item, card

**Scheduled (⏳)**:
The day the user plans to work on a task — the day it enters To-do. Slideable without guilt; the only date most tasks ever get. In every menu, chip and notice this field is the task's **start** (2026-09-12), the twin of the project start the way due twins the project deadline; "scheduled" stays the field's Tasks-canon name in code and in the glossary only.
_Avoid_: schedule, scheduled, plan, date (in UI copy — "date" alone named both fields and nobody could tell which)

**Due (📅)**:
A real external deadline. Rare; mostly arrives via Apple Reminders sync or is typed into a daily note. Edited only by its own chip's **due menu** and the row menu's Due group ("Set due date" / "Clear due" — no quick dates, no postpone: a deadline is picked, never guessed); scheduling never touches a live one. A task holding both fields shows one chip, the one that matters next (see Chip rule, 2026-09-12); a plan set onto the due day is not written (the deadline already puts the task in To-do). A deadline already behind today is **spent**: re-dating an overdue task (quick date, picker, drop on To-do, Start all today) moves its 📅 to the new date and withdraws any ⏳ — one date, never a fresh plan stacked beside a stale deadline that would pin the task in Overdue & slipped.
_Avoid_: deadline (in code/UI — the emoji vocabulary is Tasks-plugin canon)

**Undated**:
A task with neither scheduled nor due date. Undated means untriaged (in a daily note), backlog (in a project note), or a reminder without a deadline (in the machine-managed note).

**Slipped**:
A task whose scheduled day has passed without completion. A slipped calendar block from the Apple Sync note is not slipped — a missed calendar event is not a debt.
_Avoid_: overdue (reserved for past **due** dates)

**Overdue**:
A task whose due date has passed. Always a debt, even in the Apple Sync note.

### Sections (the panel's projections)

**To-do**:
The panel's first section: open tasks scheduled or due today, followed by undated inbox captures and machine-managed reminders. Nothing from the past, and no calendar blocks — the Apple Sync note's Calendar section never appears here. The execution surface and the triage queue, one working list (merged 2026-08-22).
_Avoid_: Today (renamed 2026-08-22; the dated-today rule is unchanged)

**Overdue & slipped**:
Open tasks due before today, or scheduled before today outside the Apple Sync note. A repair queue: reschedule, complete, or cancel.

**Inbox**:
Undated open tasks under the configured daily-note inbox heading, plus undated reminders from the configured machine-managed note, rendered at the tail of the To-do section. Daily captures form a triage queue: give each a date, a project, or a cancellation. Managed reminders keep their source and allow check-off and navigation only; dates and text are edited in the source app. Other daily-note headings remain outside this projection. An internal name only: the panel presents this surface as part of To-do, and user-facing copy (menu items, notices, empty states) says To-do, never inbox (#13).
_Avoid_: capture list, unsorted, inbox (in UI copy)

**Upcoming**:
Open tasks dated later than today, outside the projects folder — visible while they wait, so scheduling ahead never makes a task disappear. Collapsed by default.
_Avoid_: scheduled (as a section name — ⏳ is the field, Upcoming is the projection)

**Backlog**:
The open tasks in one project's note. Grouped by project in the panel's fourth section.

### Projects

**Project**:
A note in `Projects/Active/` with `status` frontmatter. Membership is location: a task belongs to a project because its line lives in that note's `## Tasks`.
_Avoid_: project tags on task lines

**Status (now / next / later)**:
Project-level commitment frontmatter. `now` = being worked, `next` = queued, `later` = someday. Lifecycle continues to `done` / `dropped` on retirement to `Projects/Archive/`. Orders the unranked, undated Backlogs and tiebreaks equal deadlines — a project deadline outranks it, and a manual order outranks both. A transition to `now` lifts the project to the top of the list (#20).

**Project command**:
One frontmatter write to a project note performed as one act with its consequences (`core/project-commands.ts`): commit a status (to `now`: lift to the top in the same write, and name the capacity consequence past the WIP limit — from the header's → now and the menu alike, 2026-09-27), move or place within the shown band, organize by status, set or clear a date. Absolute ranks (lift, organize) are computed over every active note; relative moves over the band as shown. The view runs a command and shows its notice; the rules live in core, tested against an in-memory project store.

**Order**:
Optional integer `order` frontmatter on a project note — the user's hand-arranged rank (#20). Ranked projects lead the Backlogs ascending; unranked ones follow under the pacing rules. Written only by the header menu's four moves (Move to top / up / down / to bottom — sparse integers, only the notes involved are touched), by dragging a header onto another (desktop; the dragged project takes the target's slot — before it dragging up, after it dragging down; #21), by a transition to `now` (min − 1: above everything), and by the Backlogs menu's **Organize by status** (renumbers every active project 1..n grouped now → next → later, keeping the order inside each tier — idempotent, notice-only, no confirmation). Never journaled: frontmatter is its own text record. An arrived deadline still leads regardless of rank, and its move items render disabled.
_Avoid_: pin, priority (order is placement, not importance)

**WIP limit**:
How many projects `now` may hold (configurable, default 3). Exceeding it warns (red badge), never blocks.

**Project deadline**:
Optional `deadline` frontmatter (ISO date) on a project note — a project-level commitment date, distinct from a task's due (📅) field. Among unranked projects, dated ones lead soonest-first and undated ones follow in status order; a manual order sits above that, and an *arrived* deadline sits above everything (#20). The header chip is amber while ahead, red once arrived — the same urgency grammar as task due chips. Rendered in the deadline and hybrid pacing modes; capacity mode ignores it (the frontmatter stays).

**Project start**:
Optional `start` frontmatter (ISO date) on a project note — the project-level twin of a task's ⏳, the way the project deadline twins 📅. From its start day (arrival included) a project presses in hybrid mode in place of the deadline attention window; before it, it never presses. Rendered in the deadline and hybrid pacing modes; capacity mode ignores it (the frontmatter stays). Edited only by the header menu's "Set start date / Clear start" and, while unstarted, its own chip — picked, never guessed; a start past the deadline is written with a notice naming the contradiction, never refused.
_Avoid_: begin, from, kickoff

**Unstarted**:
A project whose start is still ahead and whose status isn't `now`. Renders folded by default (a stored fold toggle wins) at the tail of the Backlogs regardless of manual order, sorted by start ascending then the pacing rules, showing a neutral start chip in place of its deadline chip; it never presses, its Move items render disabled, and it neither lifts nor lands in a header drag. A `now` status makes a project started by declaration, and an arrived deadline still leads the list (a debt beats a plan). A project without a start key is simply undated, not unstarted.
_Avoid_: pending, queued, upcoming, dormant

**Pacing mode (capacity / deadlines / hybrid)**:
Which pacing signals the Backlogs render and act on. Capacity (`wip`): the WIP badge only, status order. Deadlines (`deadline`): chips and deadline-first sort, no badge. Hybrid (default): both signals plus the pressing loop. A pure rendering filter — statuses and deadlines live in frontmatter regardless, so switching is instant and lossless.

**Pressing**:
Hybrid mode's reconciliation signal: a project whose deadline is inside the attention window (`pressWindow` days, default 7, arrival included) — or, when it carries a start, whose start has arrived, the window then ignored — while its status isn't `now`: the calendar and the commitments disagree. A pressing header offers a hover-revealed `→ now` (and a "Move to now" menu item); one tap commits, ignoring it is a legitimate refusal. Promoting past the WIP limit goes through and the notice names the consequence — warn, never block, on both signals at once.
_Avoid_: urgent, overdue (pressing is about commitment, not the chip's color)

**Triage**:
The act of emptying the Inbox: moving a task to a project, stamping a date, or cancelling it.

**Move to project**:
Physically cutting a task line (with its subtask children) out of its source note into a project note's `## Tasks`. Not a copy, not a link. The source may be a daily note (triage) or another project note (refiling) — the cut defines the move, not the source. Reachable from every row's context menu (#19), the select bar, and a drop on a project header; its picker leads with "+ New project" while nothing is typed, and offers it after the matches once a name is (never for a name that already is a project — 2026-10-06), so a selection can start a project as easily as join one; "Send back to To-do" is the project-row-only inverse. The row menu's "Select multiple" (selectable sections only; renamed from "Select to move" 2026-09-13, since the selection can also be bulk-started) sits beside "Move to project" in the refile group and enters select mode with that row in hand — a refile act, not a mode switch (2026-09-12). The header's "Select tasks" keeps the general name: from a header there is no "this one", and bulk scheduling is a legitimate reason to select.

**Events (`# Events:`)**:
Day Planner's section of the daily note — time blocks, not tasks. Daily Task Panel never reads or writes it.

### Panel grammar

UI copy names the plugin in sentence case — "Daily task panel" in the tab title, the ribbon tooltip and every notice's prefix — because the community-directory scanner's sentence-case rule has no notion of a product name (2026-09-27). The manifest, the command palette (which prints the manifest name) and the docs keep "Daily Task Panel".

**Undo journal**:
The session's log of line edits (`core/journal.ts`, ADR-0001 upheld: never a store of tasks), bounded at fifty entries, in memory only. Each panel action that changed lines is one entry, shown with an Undo link; undoing takes the entry out of the journal (an old link is fine, the same link twice is "already undone") and reverts its records note by note — notes getting lines back before notes losing them, so an interruption can leave a duplicate but never a lost task — skipping any line that no longer reads what the action left. Undo goes through the line editor like every write (2026-09-27).

**Note edit**:
A task-line write as text in, text out (`core/note-edit.ts`): verify-and-replace (each line must still read what was selected — a stale line is skipped, never guessed at), land blocks under a heading, and cut blocks only if the note still reads as the snapshot the cut was planned from (a changed note keeps its lines: a duplicate to clean up, never a lost task). Line endings and the journal records undo relies on are made here. The line editor adapter is the file lookup around these steps; a `TaskEdit` names each per-line edit and its label from one value (2026-09-27).

**Panel action**:
One act the panel offers, performed in full by core (`core/actions.ts`): a `MenuAction` (the menus' vocabulary, which every button, chip and drop speaks too) on a subject — a task list, a project, a section — guarded (machine-managed rows survive only check-off and the jump), dated against the projection it was offered on (its `today`, never a fresh clock read), written through the ports, and named. It returns what only the shell can finish: a journal entry or notice to show, and a UI effect (a jump, select mode, a fold, the start menu after a drop). The acts ask through a prompter — the shell's modals, a script in tests. The view is the shell and decides nothing (2026-09-27).


The rules every menu and affordance obeys (#14), so the next one has a rule to follow instead of a precedent to drift from:

**Menu order**:
Every context menu reads navigate → capture/commit → pacing → refile → destructive, separators only between non-empty sections. The first group is the thing itself: the jump ("Open note", file-text, always first) and its words ("Edit text" on a row, "Rename project" on a header); destructive acts are always last. No item carries an ellipsis, whether or not a dialog follows (Sean's call, 2026-09-13): menus read as plain verbs, and a date item says Set / Change / Clear rather than showing the date the chip already shows. An item naming a state the thing is already in is marked "✓" and disabled — project statuses and quick dates alike. A row's pacing section is two labelled groups, **Start** and **Due**, the only place a menu shows structure beyond separators (2026-09-12); "Clear start" / "Clear due" are the withdrawals, the project menu's words. Notices and undo labels speak the same words as the menu.

**Chip rule**:
A chip opens what edits it: the start (⏳) chip and the add-date button open the start menu, the due (📅) chip opens the due menu, the project deadline chip opens the deadline picker, the project start chip opens the start picker. Chips are the only date-shaped buttons on any row or header. A row shows **one chip**, the date that matters next, the way a project header does (2026-09-12): an arrived due first (red — a debt beats a plan, whatever the start says); else the start chip while the start is ahead (blue, the plan's colour); once started, the due chip if there is one, else the start chip (red when slipped). The other field is edited from the row menu.

**Quick date**:
The Start group's one-tap targets: Today, Tomorrow, Weekend, Next week (Monday), and the relative pair +1 day / +1 week, anchored on the current start while it is ahead and on today once it has arrived or slipped (2026-09-12). Every quick date is a re-dating and obeys the spent-deadline rule; none ever touches a live due.
_Avoid_: postpone, snooze, defer (as UI words — the items read as dates, not verbs)

**Quick-button rule**:
At most one quick button per header, shown only when the panel is pressing for a decision — today: `→ now` on a pressing project header — in the one shared quick-action style, always mirrored by a menu item. (The repair queue's `All → to-do` was retired to its section menu's "Start all today": one visible accelerator vocabulary, not two.)

**Header chrome**:
Signals (the count, the WIP badge) sit with the title inside the fold toggle; the right edge of any header holds acts only — a `…` menu when the section has acts (#15). Mode toggles (select) are menu items, not buttons: a mode is not a pressing decision. A header with no acts (Upcoming) shows nothing, by rule. On project headers the deadline chip — or, while unstarted, the start chip in its place — renders last, past the hover-revealed `…`, so at rest every date in the panel — task chips and the one project date that matters next — sits flush against the same right edge.

**Primary-click rule**:
Primary click does the surface's dominant act — task text jumps, project name folds. Because a header's click folds, headers carry a visible … entry point; rows carry none. The jump on a header is mod+click, middle-click, or the menu's Open note (the ↗ button was retired — three paths didn't need a fourth). The context menu (right-click, long-press) carries every act on both surfaces: visible buttons are accelerators, never the only path.

### Sources

**Daily note**:
A note under `Daily Notes/` (pattern `YYYY/MM/MM-DD, ddd`). Where tasks are captured.

**Vault layout**:
Where things live, as one value (`core/layout.ts`): the daily-notes folder and name format, the projects and archive folders, the machine-managed note, the inbox and move-target headings, the project template. Resolved once per projection from settings plus the Daily Notes plugin's say (its folder and format win while it is on; the settings folder is the fallback, for reading the inbox and writing send-back alike — 2026-09-27, before which the two halves of triage fell back differently). Every projection, drop, menu and line edit reads the same value; nothing re-derives a folder from settings on its own.
_Avoid_: config, paths (as the concept's name)

**Machine-managed note**:
The one configured note some external tool rewrites on its own schedule (optional; blank means the vault has none). Two rules follow from "machine-rewritten," both stated once in `core/machine-note.ts`: its ⏳-dated lines are calendar blocks and are never projected, and its rows are read-only in the panel except check-off. Any sync tool that owns a note fits.
_Avoid_: Apple Sync path (as the concept's name — Apple Sync is one instance)

**Apple Sync note**:
`Indexes/System/Apple Sync.md`, machine-written every 15 minutes by apple-planner-sync — the machine-managed note in Sean's vault. Its Reminders section is Daily Task Panel's business (📅 reminders follow their dates; undated reminders appear in To-do); its Calendar section (⏳ time blocks) is Day Planner's world and is never projected. Check-off propagates back to Apple Reminders; any other edit gets clobbered on next sync.
