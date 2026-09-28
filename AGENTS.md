# Daily Task Panel

The core GUI for Sean's daily-note → project task system: an Obsidian sidebar panel with four sections (To-do incl. inbox capture / Overdue & slipped / Upcoming / Project backlogs) over the vault's task pipeline.

Named Taskflow (plugin id `taskflow`, repo `obsidian-taskflow`) until 2026-09-27, when the directory already held an unrelated `taskflow`. The GitHub repo is now `SeanYHan888/obsidian-daily-task-panel` (the old URL redirects); the local checkout folders, the dev vault's folder name and the git history keep the old name. The CSS prefix is `dtp-`. On first load with no settings of its own, the plugin copies the old folder's `data.json` once (`src/settings-migration.ts`).

Originally forked from `delashum/obsidian-checklist-plugin` — its card-list visual language (group headers, subtask hierarchy from `82579e9`) is kept; the tag-based data layer is replaced. History preserved; MIT credit retained. This is now a standalone plugin: repo `SeanYHan888/obsidian-daily-task-panel`.

Read `CONTEXT.md` (glossary — use its vocabulary) and `docs/adr/` before working.

## Design rules (non-negotiable)

- **Stateless projection.** No task cache, no synthetic IDs in `data.json`. Read tasks from the Obsidian Tasks plugin API (`getTasks()`) + project frontmatter from the metadata cache; write by editing source lines (complete via the Tasks API so ✅ done-dates and Apple Reminders write-back keep working). See ADR-0001.
- **Daily Task Panel is the reminder; Day Planner is the calendar.** The panel never reads or writes `# Events:` sections, and never projects the machine-managed note's scheduled time-blocks (in Sean's vault: the Apple Sync note's Calendar section). Its dated reminders are in scope. See ADR-0003 (as amended) and `core/machine-note.ts`.
- **Face, not organ.** The panel replaces only the vault's `Indexes/System/Work Queue.md` query note (which stays as fallback). Tasks, Bases, Day Planner, and templates own everything else.
- **Interop-clean.** Personal-first (workflow model hardcoded, paths in settings), but never assume Daily Task Panel owns a note's layout — e.g. a project note may become an obsidian-kanban board, so the move-to-project target heading is a setting (default `## Tasks`).
- The workflow being served is documented in the vault: `Indexes/System/Project Workflow.md` (vault repo: `SeanYHan888/obsidian-vault`, branch `pipeline-panel`).

## Workflow model the panel must mirror

- Tasks are checkbox lines; emoji format (`⏳` scheduled = planned day, `📅` due = hard deadline, `✅`/`[-]`). Never write dataview-style `[scheduled:: ]` fields.
- Projects = notes in `Projects/Active/` with frontmatter `status: now|next|later`; location = membership (no project tags on task lines).
- Section rules (panel order: To-do → Overdue & slipped → Upcoming → Projects — capture renders inside To-do, directly under the day's commitments):
  - **To-do** (internal key `today`) = open tasks scheduled or due today, followed by the undated inbox captures (one section since 2026-08-22 — the day's list and its triage queue are one working surface). Excludes the Apple Sync note's Calendar section (calendar blocks are Day Planner's world; its Reminders section is included).
  - **Overdue & slipped** = due before today, OR scheduled before today outside the Apple Sync note. (Overdue Reminders nag; missed calendar blocks never surface — intended asymmetry.)
  - **Inbox** (rendered inside To-do) = undated open tasks under a daily note's `# Inbox` heading only, excluding blank descriptions. Checkboxes under other headings are not Daily Task Panel's business.
  - **Upcoming** (collapsed by default) = open tasks dated later than today, outside `Projects/Active/` (backlog rows already show their own date chips). Exists so no dated task is ever invisible.
  - **Backlogs** = open tasks in the projects folder, grouped by project, paced by the pacing mode (capacity / deadlines / hybrid — see CONTEXT.md). Order: arrived deadlines first (deadline and hybrid modes; chip red), then projects with an integer `order` frontmatter ascending (the user's hand-arranged rank — header-menu moves, a transition to `now` lifts to the top, the Backlogs menu's Organize by status renumbers by tier; see CONTEXT.md "Order"), then unranked projects: dated ones soonest first (chip amber while ahead), undated ones `now` first; unstarted projects (a future `start`, status not `now` — #22, ADR-0006) tail the list regardless of rank, folded by default, with a neutral start chip in place of the deadline chip, their move items disabled. In capacity and hybrid modes, a `n/limit` WIP badge counts projects in `now` (limit configurable, default 3; red past the limit, warn never block). Hybrid additionally runs the pressing loop: a project that isn't `now` whose start has arrived — or, without a start, whose deadline is inside the attention window — offers `→ now` on its header; promoting past the limit goes through with a consequence-naming notice.
- Sections are disjoint projections of one field (the date); tasks never "move" between them except by date edits or the passage of days.

## Tech stack

TypeScript 5 (strict) + Svelte 5 (runes) + esbuild + Vitest. See ADR-0002. The brain is framework-free: `src/core/` is pure TS (classification, date rules, line moves, menu specs, section queries, setup state) with zero Svelte/Obsidian imports, and declares the three ports it consumes (`core/ports.ts`: task source, project store, line editor — see ADR-0004). `src/adapters/` implements them (`adapters/compose.ts` does the wiring; Tasks-plugin internals live only in `adapters/tasks-plugin.ts`); `src/main.ts` is the composition root (the ports are wired once per plugin and shared by every view); `src/view.ts` is the shell (mount, project, render menus, apply UI effects — every act is performed in `core/actions.ts`); `src/ui/` is thin Svelte. New capabilities arrive as core functions plus port methods, never as view-layer logic.

## Roadmap (each version ships usable; tracked as GitHub issues)

- **v0.1** — four read-only sections + check-off + click-to-jump + settings.
- **v0.2** — `⏳` date chip menu (today/tomorrow/weekend/pick), one-tap reschedule row on slipped, bulk "all → today". No date edits on Apple Sync tasks (machine-rewritten note).
- **v0.3** — triage: select mode, bulk move-to-project (fuzzy picker + create-from-template `Templates/project.md`), physically cuts lines with subtask children into the project's target heading.
- **v0.4** — polish: WIP badge, counts, empty states, mobile pass.

## Dev loop

Two vaults, strictly separated:

- **Dev vault** — `~/Projects/taskflow-demo-vault` (override: `DTP_DEV_PLUGIN_DIR`). `npm install && npm run dev` (esbuild watch) builds straight into its `.obsidian/plugins/daily-task-panel/` → Hot Reload plugin or the obsidian-cli skill to reload, capture console errors, and screenshot the panel there. All development and testing happens here.
- **Live vault** — Sean's personal vault (iCloud). It NEVER receives dev builds. The only path to it is `npm run deploy:prod` (`scripts/deploy-prod.mjs`), which refuses to run unless on `main` (env `DTP_PROD_BRANCH`) with a clean tree — `-- --force` overrides, for emergencies only — then runs tests, lint and the production build, backs up the vault's current files as `*.prev`, copies, and writes a `.build-info` (version, commit, date) next to them. `npm run rollback:prod` restores the `*.prev` set (one level of undo). `npm run release:patch` / `release:minor` bump the version (`npm version` commits and tags — `.npmrc` drops npm's `v` prefix so the tag equals the manifest version, as Obsidian and BRAT require) and then deploy — the normal way to ship. Pushing the tag (`git push origin main --tags`) triggers `.github/workflows/release.yml`, which runs the checks and publishes a GitHub release with `main.js`, `manifest.json` and `styles.css`. Never run any of these as part of a dev loop. Never mass-edit notes there — the plugin edits single task lines on explicit user action only. Day Planner's `data.json` contains private calendar URLs — never commit or copy it.
- **Two checkouts, so the watch never stops.** `main` lives in a git worktree at `~/Projects/obsidian-taskflow-main` (`git worktree add ../obsidian-taskflow-main main`, then `npm ci` there). Develop and run `npm run dev` from this checkout on `pipeline` (or a feature branch); merge to `main` and run `release:*` / `deploy:prod` from the worktree. Switching branches in the dev checkout would change what the running watch builds into the dev vault — the worktree avoids that.
- After deploying, `obsidian plugin:reload` can report success while the old module keeps running. Hard-cycle instead: `obsidian eval code="app.plugins.disablePlugin('daily-task-panel').then(()=>app.plugins.enablePlugin('daily-task-panel'))"` (the deploy script prints this).

## Agent skills

### Issue tracker

Issues are tracked as GitHub Issues on `SeanYHan888/obsidian-daily-task-panel` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
