import { execSync } from 'child_process';
import path from 'path';

/**
 * Jest setup file for integration tests
 * This runs before all tests to ensure the CLI is built and ready
 */

beforeAll(async () => {
  // CLI is built once in globalSetup.ts
  // Tests assume authentication is already configured
  // Use 'npm run clear-tokens' to reset authentication state if needed

  // Set longer timeout for integration tests
  jest.setTimeout(360000); // 6 minutes default timeout
});

// Global test configuration
process.env.NODE_ENV = 'test';

// Suppress console output during tests unless explicitly needed
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

beforeEach(() => {
  // Only suppress if not in verbose mode
  if (!process.env.TEST_VERBOSE) {
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
  }
});

afterEach(() => {
  // Restore console functions
  if (!process.env.TEST_VERBOSE) {
    console.log = originalConsoleLog;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  }
});
