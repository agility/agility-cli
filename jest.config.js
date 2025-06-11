module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/tests/**/*.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/src/index.ts'],
}; 