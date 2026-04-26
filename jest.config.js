/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'node',
    testMatch: ['<rootDir>/src/**/*.test.ts'],
    // Spawned-task worktrees under .claude/ contain copies of package.json
    // and src files; keep Jest's haste-map and resolver out of them.
    modulePathIgnorePatterns: ['<rootDir>/.claude/'],
    testPathIgnorePatterns: ['/node_modules/', '<rootDir>/.claude/'],
    extensionsToTreatAsEsm: ['.ts'],
    transform: {
        '^.+\\.ts$': ['ts-jest', {
            useESM: true,
            tsconfig: {
                module: 'esnext',
                target: 'es2022',
                moduleResolution: 'bundler',
                // Match the project's tsconfig — legacy decorators play
                // nicely with istanbul's instrumentation, whereas stage-3
                // decorators leave phantom uncovered function entries.
                experimentalDecorators: true,
            },
        }],
    },
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    // Coverage is opt-in via `npm run test:coverage` (or `jest --coverage`).
    // The HTML report lands at .coverage/lcov-report/index.html; open that
    // file in a browser to inspect line/branch coverage interactively.
    coverageDirectory: '.coverage',
    coverageReporters: ['html', 'text', 'text-summary', 'lcov', 'json', 'json-summary'],
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.test.ts',
        '!src/examples/**',
        // src/index.ts is currently a demo (mirrors how kv-fs treats
        // src/examples/*); it'll graduate to acceptance-tested code later.
        '!src/index.ts',
    ],
};
