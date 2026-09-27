// The same rule set the community-directory submission scanner is built on.
import obsidianmd from 'eslint-plugin-obsidianmd'
import {DEFAULT_BRANDS} from 'eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js'
import tseslint from 'typescript-eslint'

// The plugin's own name (and its former one) are proper nouns, so sentence
// case keeps their capitals. A `brands` list replaces the rule's defaults
// rather than adding to them, hence the spread.
const BRANDS = [...DEFAULT_BRANDS, 'Daily Task Panel', 'Taskflow']

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
    rules: {
      'obsidianmd/ui/sentence-case': ['warn', {brands: BRANDS, enforceCamelCaseLower: true}],
    },
  },
  {
    ignores: ['main.js', 'node_modules/**', 'tests/**', '*.mjs'],
  },
)
