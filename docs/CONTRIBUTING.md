# Contributing to Daily Task Panel

Thanks for your interest. Daily Task Panel is a small, opinionated plugin; the fastest way to help is to open an issue first so we can agree on the shape of a change before code is written.

## Issues

File bugs and proposals at [SeanYHan888/obsidian-daily-task-panel/issues](https://github.com/SeanYHan888/obsidian-daily-task-panel/issues). For a bug, include your Obsidian and Tasks plugin versions, the task line(s) involved, and what the panel showed versus what you expected.

## Before you code

Read [`AGENTS.md`](../AGENTS.md) (the non-negotiable design rules), [`CONTEXT.md`](../CONTEXT.md) (the glossary — use its vocabulary in code and comments) and the decision records in [`docs/adr/`](adr/). In short: the panel is a stateless projection of the vault, the brain in `src/core/` is pure TypeScript with no Obsidian or Svelte imports, and every write edits a single source line the user asked to change.

## Development setup

Requirements: Node 20 or later and a throwaway Obsidian vault for testing. Never point a dev build at a vault you care about — the plugin edits task lines.

```bash
npm ci
npm run dev
```

`npm run dev` starts an esbuild watch that writes `main.js`, `manifest.json` and `styles.css` straight into a dev vault's plugin folder. By default that is `../taskflow-demo-vault/.obsidian/plugins/daily-task-panel/`; set `DTP_DEV_PLUGIN_DIR` to use another vault. Install the [Hot Reload](https://github.com/pjeby/hot-reload) plugin in that vault and the panel reloads on every rebuild. Enable the Tasks plugin there too, or the panel has nothing to read.

## Checks

Run all three before opening a pull request:

```bash
npm test
```

```bash
npm run lint
```

```bash
npm run build
```

Tests cover `src/core/` and the pure adapter helpers; new behaviour arrives as a core function with a test, then a port method, then the thinnest possible UI. Lint uses the same rule set the community-plugin submission scanner runs.

## Pull requests

1. Fork, branch from `main`, and reference the issue in your commits or PR description.
2. Keep the change to the agreed scope; unrelated cleanup goes in its own PR.
3. Describe what you tested in a real vault, not only in the test suite.

Daily Task Panel is MIT licensed; by contributing you agree your changes are too.
