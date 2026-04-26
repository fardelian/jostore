import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import stylistic from '@stylistic/eslint-plugin';

export default tseslint.config(
    {
        ignores: [
            'dist/',
            'node_modules/',
            '.coverage/',
            '.claude/',
            '.idea/',
            'src/examples/example-data-dir/',
        ],
    },

    js.configs.recommended,
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,

    // Type-aware rules need to know which tsconfig drives type info.
    {
        files: ['**/*.ts'],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },

    // Uniform style: 4-space indent, single quotes, always-semicolons,
    // trailing commas in multi-line literals, eol-at-eof, no-trailing-whitespace.
    stylistic.configs.customize({
        flat: true,
        indent: 4,
        quotes: 'single',
        semi: true,
        commaDangle: 'always-multiline',
        arrowParens: true,
        braceStyle: '1tbs',
    }),

    {
        files: ['**/*.ts'],
        rules: {
            // Numbers in template literals are idiomatic in error messages.
            '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],

            // Wrapping callback APIs in `new Promise(...)` legitimately yields
            // an async function without an explicit await.
            '@typescript-eslint/require-await': 'off',

            // Always `return await` when returning a Promise — keeps the
            // current function on the stack trace and inside the right
            // try/catch frame.
            '@typescript-eslint/return-await': ['error', 'always'],

            // `no-explicit-any` stays on as the gatekeeper: introducing
            // `any` requires an explicit per-line opt-out comment. But once
            // a value is `any` (because the dev consciously chose it),
            // operations downstream on that value should just work — so the
            // unsafe-value-flow rules are off globally. This matches the
            // pattern of dynamic Proxy-based APIs (e.g. jostore's root
            // object) where every property access is intrinsically unsafe.
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/restrict-plus-operands': ['error', { allowAny: true }],
        },
    },

    // Tests legitimately exercise the dynamic Proxy API where the proxy's
    // type is fundamentally `any` — turn off the gatekeeper there too.
    {
        files: ['**/*.test.ts', 'src/mocks/**/*.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },

    // jest.config.js is CommonJS; tell ESLint about its globals and disable
    // type-aware rules (it isn't part of the TS project).
    {
        files: ['jest.config.js', '**/*.cjs'],
        ...tseslint.configs.disableTypeChecked,
        languageOptions: {
            sourceType: 'commonjs',
            globals: {
                module: 'readonly',
                require: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
            },
        },
    },

    // The eslint config itself isn't covered by tsconfig.
    {
        files: ['eslint.config.mjs'],
        ...tseslint.configs.disableTypeChecked,
    },
);
