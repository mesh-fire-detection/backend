import path from 'node:path'

import js from '@eslint/js'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import eslintConfigPrettier from 'eslint-config-prettier'
import importPlugin, { createNodeResolver } from 'eslint-plugin-import-x'
import unicorn from 'eslint-plugin-unicorn'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const repoRoot = path.resolve(import.meta.dirname, '../..')

const promoteWarnings = (rules) =>
    Object.fromEntries(
        Object.entries(rules).map(([name, entry]) => {
            const [level, ...options] = Array.isArray(entry) ? entry : [entry]
            const isWarning = level === 'warn' || level === 1

            return [name, isWarning ? ['error', ...options] : entry]
        })
    )

/**
 * Layers call downward only: routes → service → repo. These zones turn the
 * AGENTS.md layer rules into build failures.
 */
const layerZones = [
    {
        target: './src/**/routes.ts',
        from: ['./src/**/repo.ts', './src/shared/db/**'],
        message: 'Routes never touch the database. Call a service.',
    },
    {
        target: './src/**/service.ts',
        from: './src/**/routes.ts',
        message: 'Services must not import routes.',
    },
    {
        target: './src/**/repo.ts',
        from: ['./src/**/service.ts', './src/**/routes.ts'],
        message: 'Repos contain SQL only and must not import services or routes.',
    },
    {
        target: './src/shared/**',
        from: './src/!(shared|app)/**',
        message: 'Shared code must not depend on a feature.',
    },
]

const httpImports = {
    group: ['hono', 'hono/*', '@hono/*'],
    message: 'Services and repos never see HTTP objects. Keep HTTP in routes.ts.',
}

export default tseslint.config(
    {
        ignores: ['dist', 'node_modules', 'data', 'logs', 'coverage'],
    },

    {
        files: ['**/*.{js,mjs,cjs}'],
        ...js.configs.recommended,
        languageOptions: {
            globals: { ...globals.node },
            ecmaVersion: 'latest',
        },
    },

    ...tseslint.configs.strictTypeChecked.map((config) => ({
        ...config,
        files: ['**/*.ts'],
    })),
    ...tseslint.configs.stylisticTypeChecked.map((config) => ({
        ...config,
        files: ['**/*.ts'],
    })),
    {
        files: ['**/*.ts'],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                projectService: true,
                tsconfigRootDir: repoRoot,
                sourceType: 'module',
                ecmaVersion: 'latest',
            },
            globals: { ...globals.node, ...globals.es2021 },
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin,
            import: importPlugin,
            unicorn,
        },
        settings: {
            'import-x/resolver-next': [
                createTypeScriptImportResolver({
                    alwaysTryTypes: true,
                    project: path.resolve(repoRoot, 'tsconfig.json'),
                    conditionNames: ['development', 'types', 'import', 'node', 'default'],
                }),
                createNodeResolver({
                    extensions: ['.js', '.mjs', '.cjs', '.ts', '.d.ts'],
                }),
            ],
        },
        rules: {
            ...promoteWarnings(unicorn.configs.recommended.rules),
            '@typescript-eslint/no-shadow': 'error',
            'no-console': 'error',
            'import/no-cycle': 'error',
            'import/no-duplicates': 'error',
            'import/no-self-import': 'error',
            'import/no-useless-path-segments': 'error',
            'import/no-empty-named-blocks': 'error',
            'import/no-unresolved': 'error',
            'import/no-restricted-paths': ['error', { basePath: repoRoot, zones: layerZones }],
            '@typescript-eslint/consistent-type-imports': [
                'error',
                { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
            ],
            '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            '@typescript-eslint/restrict-template-expressions': [
                'error',
                { allowNumber: true, allowBoolean: true },
            ],
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
            'import/order': [
                'error',
                {
                    groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
                    pathGroups: [{ pattern: '#src/**', group: 'internal' }],
                    'newlines-between': 'always',
                    alphabetize: { order: 'asc', caseInsensitive: true },
                },
            ],
            'unicorn/filename-case': [
                'error',
                { case: 'camelCase', ignore: ['vitest.config.ts'], checkDirectories: false },
            ],
            // Abbreviations such as `env`, `db` and `params` are the domain's own words.
            'unicorn/prevent-abbreviations': 'off',
            'unicorn/name-replacements': 'off',
            'unicorn/consistent-boolean-name': 'off',
            'unicorn/single-line-block-comment-style': 'off',
            // SQL and JSON both use null; the API contract (`batteryPct: null`) depends on it.
            'unicorn/no-null': 'off',
            'unicorn/prefer-string-raw': 'off',
        },
    },

    {
        files: ['src/**/*.ts'],
        rules: {
            'import/no-default-export': 'error',
        },
    },

    {
        files: ['src/**/service.ts', 'src/**/repo.ts'],
        rules: {
            'no-restricted-imports': ['error', { patterns: [httpImports] }],
        },
    },

    {
        files: ['config/lint/checkStructure.ts'],
        rules: {
            'unicorn/no-process-exit': 'off',
            'no-console': 'off',
        },
    },

    {
        files: ['config/build/vitest.config.ts'],
        rules: {
            // Vitest loads its config through a default export.
            'import/no-default-export': 'off',
        },
    },

    {
        files: ['tests/**/*.ts'],
        rules: {
            'unicorn/consistent-function-scoping': 'off',
            'unicorn/no-top-level-assignment-in-function': 'off',
            '@typescript-eslint/no-empty-function': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
            // Vitest's asymmetric matchers (expect.closeTo, objectContaining) are typed `any`
            // and are meant to be nested inside each other.
            '@typescript-eslint/no-unsafe-assignment': 'off',
            'unicorn/max-nested-calls': 'off',
        },
    },

    eslintConfigPrettier
)
