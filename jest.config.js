module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/tests/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/src/index.ts'],
  globalSetup: '<rootDir>/src/tests/globalSetup.ts',
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.ts'],
  testTimeout: 360000, // 6 minutes default timeout for integration tests
  maxWorkers: 1, // Run tests sequentially to avoid conflicts
  verbose: true,
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/tests/**',
    '!src/index.ts',
    '!**/*.d.ts'
  ]
}; 