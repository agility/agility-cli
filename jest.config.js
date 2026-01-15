module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Default: unit tests only (exclude integration tests)
  testMatch: ['**/src/tests/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/src/index.ts', 'integration\\.test\\.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.ts'],
  // Map TypeScript path aliases to actual paths
  moduleNameMapper: {
    '^core/(.*)$': '<rootDir>/src/core/$1',
    '^core$': '<rootDir>/src/core',
    '^lib/(.*)$': '<rootDir>/src/lib/$1',
    '^types/(.*)$': '<rootDir>/src/types/$1',
  },
}; 