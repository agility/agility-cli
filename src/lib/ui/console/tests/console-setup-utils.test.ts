import { resetState } from 'core/state';
import { state } from 'core/state';
import { validateConsoleSetup, ConsoleSetupConfig } from 'lib/ui/console/console-setup-utils';

// Mock heavy dependencies that touch the filesystem or console internals
jest.mock('core/fileOperations');
jest.mock('lib/ui/console/console-manager');
jest.mock('lib/ui/console/file-logger');

beforeEach(() => {
  resetState();
  // Provide valid state so validateLoggingState passes by default
  state.rootPath = 'agility-files';
  state.sourceGuid = ['test-guid'];
  state.locale = ['en-us'];
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── validateConsoleSetup ─────────────────────────────────────────────────────

describe('validateConsoleSetup', () => {
  it('is valid for "pull" operation with complete state', () => {
    const config: ConsoleSetupConfig = { operationType: 'pull' };
    const result = validateConsoleSetup(config);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('is valid for "push" operation', () => {
    const result = validateConsoleSetup({ operationType: 'push' });
    expect(result.isValid).toBe(true);
  });

  it('is valid for "sync" operation', () => {
    const result = validateConsoleSetup({ operationType: 'sync' });
    expect(result.isValid).toBe(true);
  });

  it('is invalid for an unknown operation type', () => {
    const config = { operationType: 'delete' as any };
    const result = validateConsoleSetup(config);
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('delete'))).toBe(true);
  });

  it('surfaces logging-state errors when rootPath is empty', () => {
    state.rootPath = '';
    const result = validateConsoleSetup({ operationType: 'pull' });
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.toLowerCase().includes('rootpath'))).toBe(true);
  });

  it('reports error when sourceGuid is an empty array', () => {
    state.sourceGuid = [];
    const result = validateConsoleSetup({ operationType: 'pull' });
    expect(result.errors.some(e => e.toLowerCase().includes('sourceguid'))).toBe(true);
  });

  it('reports error when locale is an empty array', () => {
    state.locale = [];
    const result = validateConsoleSetup({ operationType: 'pull' });
    expect(result.errors.some(e => e.toLowerCase().includes('locale'))).toBe(true);
  });

  it('returns warnings (not errors) when both headless and verbose are set', () => {
    state.useHeadless = true;
    state.useVerbose = true;
    const result = validateConsoleSetup({ operationType: 'sync' });
    // Should still be valid (warnings, not errors)
    expect(result.isValid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('returns an errors array and warnings array in the result shape', () => {
    const result = validateConsoleSetup({ operationType: 'pull' });
    expect(Array.isArray(result.errors)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});
