// The same rule set the community-directory submission scanner runs, with no
// local overrides, so a clean lint here means a clean scan there. (A brands
// list once let the plugin's name keep its capitals; the scanner has no such
// list, so UI copy writes it in sentence case: "Daily task panel".)
import obsidianmd from 'eslint-plugin-obsidianmd'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  ...obsidianmd.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    ignores: ['main.js', 'node_modules/**', 'tests/**', '*.mjs'],
  },
)
