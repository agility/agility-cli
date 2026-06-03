import { resetState } from 'core/state';
import { state } from 'core/state';
import { LoggingModes } from 'lib/ui/console/logging-modes';

beforeEach(() => {
  resetState();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── determineMode ─────────────────────────────────────────────────────────────

describe('LoggingModes.determineMode', () => {
  it('returns "plain" by default', () => {
    expect(LoggingModes.determineMode()).toBe('plain');
  });

  it('returns "headless" when useHeadless is true', () => {
    state.useHeadless = true;
    expect(LoggingModes.determineMode()).toBe('headless');
  });

  it('returns "verbose" when useVerbose is true', () => {
    state.useVerbose = true;
    expect(LoggingModes.determineMode()).toBe('verbose');
  });

  it('prioritises "headless" over "verbose" when both are set', () => {
    state.useHeadless = true;
    state.useVerbose = true;
    expect(LoggingModes.determineMode()).toBe('headless');
  });
});

// ─── getConfig ─────────────────────────────────────────────────────────────────

describe('LoggingModes.getConfig', () => {
  it('returns correct config for "headless"', () => {
    const config = LoggingModes.getConfig('headless');
    expect(config.mode).toBe('headless');
    expect(config.shouldLogToFile).toBe(true);
    expect(config.shouldLogToConsole).toBe(false);
    expect(config.shouldRedirectToUI).toBe(false);
    expect(config.shouldShowProgress).toBe(false);
    expect(config.shouldShowVerboseOutput).toBe(false);
  });

  it('returns correct config for "verbose"', () => {
    const config = LoggingModes.getConfig('verbose');
    expect(config.mode).toBe('verbose');
    expect(config.shouldLogToFile).toBe(true);
    expect(config.shouldLogToConsole).toBe(true);
    expect(config.shouldShowProgress).toBe(true);
    expect(config.shouldShowVerboseOutput).toBe(true);
  });

  it('returns correct config for "plain"', () => {
    const config = LoggingModes.getConfig('plain');
    expect(config.mode).toBe('plain');
    expect(config.shouldLogToFile).toBe(true);
    expect(config.shouldLogToConsole).toBe(true);
    expect(config.shouldShowProgress).toBe(true);
    expect(config.shouldShowVerboseOutput).toBe(false);
  });
});

// ─── getCurrentConfig ──────────────────────────────────────────────────────────

describe('LoggingModes.getCurrentConfig', () => {
  it('reflects state change to headless', () => {
    state.useHeadless = true;
    const config = LoggingModes.getCurrentConfig();
    expect(config.mode).toBe('headless');
    expect(config.shouldLogToConsole).toBe(false);
  });

  it('reflects state change to verbose', () => {
    state.useVerbose = true;
    const config = LoggingModes.getCurrentConfig();
    expect(config.mode).toBe('verbose');
    expect(config.shouldShowVerboseOutput).toBe(true);
  });
});

// ─── supports* / requires* helpers ────────────────────────────────────────────

describe('LoggingModes support helpers', () => {
  it('supportsInteractiveUI always returns false', () => {
    expect(LoggingModes.supportsInteractiveUI()).toBe(false);
    state.useHeadless = true;
    expect(LoggingModes.supportsInteractiveUI()).toBe(false);
  });

  it('supportsProgressBars returns false in headless mode', () => {
    state.useHeadless = true;
    expect(LoggingModes.supportsProgressBars()).toBe(false);
  });

  it('supportsProgressBars returns true in plain mode', () => {
    expect(LoggingModes.supportsProgressBars()).toBe(true);
  });

  it('supportsVerboseOutput returns true only in verbose mode', () => {
    expect(LoggingModes.supportsVerboseOutput()).toBe(false);
    state.useVerbose = true;
    expect(LoggingModes.supportsVerboseOutput()).toBe(true);
  });

  it('supportsConsoleOutput returns false in headless mode', () => {
    state.useHeadless = true;
    expect(LoggingModes.supportsConsoleOutput()).toBe(false);
  });

  it('requiresFileLogging returns true for all modes', () => {
    expect(LoggingModes.requiresFileLogging()).toBe(true);
    state.useHeadless = true;
    expect(LoggingModes.requiresFileLogging()).toBe(true);
  });

  it('requiresUIRedirection returns false for all modes', () => {
    expect(LoggingModes.requiresUIRedirection()).toBe(false);
    state.useVerbose = true;
    expect(LoggingModes.requiresUIRedirection()).toBe(false);
  });
});

// ─── shouldLog ─────────────────────────────────────────────────────────────────

describe('LoggingModes.shouldLog', () => {
  it('shouldLog("console") returns false in headless mode', () => {
    state.useHeadless = true;
    expect(LoggingModes.shouldLog('console')).toBe(false);
  });

  it('shouldLog("file") returns true in all modes', () => {
    expect(LoggingModes.shouldLog('file')).toBe(true);
    state.useHeadless = true;
    expect(LoggingModes.shouldLog('file')).toBe(true);
  });

  it('shouldLog("verbose") returns true only in verbose mode', () => {
    expect(LoggingModes.shouldLog('verbose')).toBe(false);
    state.useVerbose = true;
    expect(LoggingModes.shouldLog('verbose')).toBe(true);
  });

  it('shouldLog("progress") returns false in headless mode', () => {
    state.useHeadless = true;
    expect(LoggingModes.shouldLog('progress')).toBe(false);
  });

  it('shouldLog("ui") returns false for all modes', () => {
    expect(LoggingModes.shouldLog('ui')).toBe(false);
    state.useHeadless = true;
    expect(LoggingModes.shouldLog('ui')).toBe(false);
  });
});

// ─── getLogFormat ──────────────────────────────────────────────────────────────

describe('LoggingModes.getLogFormat', () => {
  it('headless format includes timestamp and level, no colors', () => {
    const fmt = LoggingModes.getLogFormat('headless');
    expect(fmt.includeTimestamp).toBe(true);
    expect(fmt.includeLevel).toBe(true);
    expect(fmt.includeColors).toBe(false);
    expect(fmt.includeProgressBars).toBe(false);
  });

  it('verbose format has no timestamp/level but has colors and progress bars', () => {
    const fmt = LoggingModes.getLogFormat('verbose');
    expect(fmt.includeTimestamp).toBe(false);
    expect(fmt.includeLevel).toBe(false);
    expect(fmt.includeColors).toBe(true);
    expect(fmt.includeProgressBars).toBe(true);
  });

  it('plain format has no timestamp/level but has colors and progress bars', () => {
    const fmt = LoggingModes.getLogFormat('plain');
    expect(fmt.includeTimestamp).toBe(false);
    expect(fmt.includeColors).toBe(true);
    expect(fmt.includeProgressBars).toBe(true);
  });
});

// ─── getModeSpecificBehavior ───────────────────────────────────────────────────

describe('LoggingModes.getModeSpecificBehavior', () => {
  it('headless redirects console, disables inline progress', () => {
    const b = LoggingModes.getModeSpecificBehavior('headless');
    expect(b.redirectConsole).toBe(true);
    expect(b.showInlineProgress).toBe(false);
    expect(b.enableColors).toBe(false);
  });

  it('verbose does not redirect console and enables inline progress', () => {
    const b = LoggingModes.getModeSpecificBehavior('verbose');
    expect(b.redirectConsole).toBe(false);
    expect(b.showInlineProgress).toBe(true);
    expect(b.enableColors).toBe(true);
  });

  it('plain does not redirect console', () => {
    const b = LoggingModes.getModeSpecificBehavior('plain');
    expect(b.redirectConsole).toBe(false);
  });
});

// ─── shouldShowContent ─────────────────────────────────────────────────────────

describe('LoggingModes.shouldShowContent', () => {
  it('always shows errors', () => {
    expect(LoggingModes.shouldShowContent('errors')).toBe(true);
    state.useHeadless = true;
    expect(LoggingModes.shouldShowContent('errors')).toBe(true);
  });

  it('always shows warnings', () => {
    expect(LoggingModes.shouldShowContent('warnings')).toBe(true);
  });

  it('shows debug only in verbose mode', () => {
    expect(LoggingModes.shouldShowContent('debug')).toBe(false);
    state.useVerbose = true;
    expect(LoggingModes.shouldShowContent('debug')).toBe(true);
  });

  it('shows stats when progress is enabled (plain mode)', () => {
    expect(LoggingModes.shouldShowContent('stats')).toBe(true);
  });

  it('does not show stats in headless mode (no progress)', () => {
    state.useHeadless = true;
    expect(LoggingModes.shouldShowContent('stats')).toBe(false);
  });
});

// ─── validateLoggingState ──────────────────────────────────────────────────────

describe('LoggingModes.validateLoggingState', () => {
  it('is valid with default state (rootPath, sourceGuid, locale populated)', () => {
    state.rootPath = 'agility-files';
    state.sourceGuid = ['test-guid'];
    state.locale = ['en-us'];
    const result = LoggingModes.validateLoggingState();
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('reports error when rootPath is missing', () => {
    state.rootPath = '';
    state.sourceGuid = ['test-guid'];
    state.locale = ['en-us'];
    const result = LoggingModes.validateLoggingState();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('rootPath'))).toBe(true);
  });

  it('reports error when sourceGuid is empty array', () => {
    state.rootPath = 'agility-files';
    state.sourceGuid = [];
    state.locale = ['en-us'];
    const result = LoggingModes.validateLoggingState();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('sourceGuid'))).toBe(true);
  });

  it('reports error when locale is empty array', () => {
    state.rootPath = 'agility-files';
    state.sourceGuid = ['test-guid'];
    state.locale = [];
    const result = LoggingModes.validateLoggingState();
    expect(result.isValid).toBe(false);
    expect(result.errors.some(e => e.includes('locale'))).toBe(true);
  });

  it('warns when both headless and verbose are set', () => {
    state.rootPath = 'agility-files';
    state.sourceGuid = ['test-guid'];
    state.locale = ['en-us'];
    state.useHeadless = true;
    state.useVerbose = true;
    const result = LoggingModes.validateLoggingState();
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ─── getModeDescription ────────────────────────────────────────────────────────

describe('LoggingModes.getModeDescription', () => {
  it.each([
    ['headless', 'Headless'],
    ['verbose', 'Verbose'],
    ['plain', 'Plain'],
  ] as const)('includes mode keyword for "%s"', (mode, keyword) => {
    expect(LoggingModes.getModeDescription(mode)).toContain(keyword);
  });
});
