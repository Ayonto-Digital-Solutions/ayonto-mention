/**
 * Jest configuration for the Ayonto Mention PCF project.
 *
 * Tests live in `tests/` and are compiled by ts-jest through
 * `tsconfig.spec.json`, which switches the module format to CommonJS.
 * The production build is unaffected: webpack bundles only what is
 * reachable from the control's `index.ts`.
 */
/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  // Fills jsdom's missing platform APIs (see tests/setup/jsdomShims.ts).
  setupFiles: ['<rootDir>/tests/setup/jsdomShims.ts'],
  // Replaces the geometry engine Fluent positions the popup with, which cannot
  // work in an environment that does no layout (see the file's own comment).
  setupFilesAfterEnv: ['<rootDir>/tests/setup/floatingUiLayout.ts'],
  roots: ['<rootDir>/tests'],
  testMatch: ['<rootDir>/tests/**/*.test.ts?(x)'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  collectCoverageFrom: [
    'MentionControl/**/*.{ts,tsx}',
    'src/**/*.{ts,tsx}',
    '!MentionControl/generated/**',
    '!**/*.d.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
};
