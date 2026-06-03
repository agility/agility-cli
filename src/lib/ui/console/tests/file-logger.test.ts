import { resetState } from 'core/state';
import { state } from 'core/state';
import { FileLogger, FileLoggerConfig, LogEntry } from 'lib/ui/console/file-logger';
import { fileOperations } from 'core/fileOperations';

// Mock fileOperations so no file I/O occurs
jest.mock('core/fileOperations');

const MockFileOps = fileOperations as jest.MockedClass<typeof fileOperations>;

function makeLogger(overrides: Partial<FileLoggerConfig> = {}): FileLogger {
  const config: FileLoggerConfig = {
    rootPath: 'agility-files',
    guid: 'test-guid',
    locale: 'en-us',
    preview: false,
    operationType: 'pull',
    ...overrides,
  };
  return new FileLogger(config);
}

beforeEach(() => {
  resetState();
  MockFileOps.mockClear();
  MockFileOps.prototype.appendLogFile = jest.fn();
  MockFileOps.prototype.finalizeLogFile = jest.fn().mockReturnValue('/path/to/log.txt');
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── formatLogEntry (via log) ──────────────────────────────────────────────────

describe('FileLogger formatLogEntry', () => {
  it('calls appendLogFile with a line containing timestamp, level, and message', () => {
    const logger = makeLogger();
    logger.logInfo('hello world');

    const call = MockFileOps.prototype.appendLogFile as jest.Mock;
    expect(call).toHaveBeenCalledTimes(1);
    const written: string = call.mock.calls[0][0];
    expect(written).toMatch(/\[.*\] \[INFO\] hello world\n/);
  });

  it('includes context in square brackets when provided', () => {
    const logger = makeLogger();
    logger.log('WARNING', 'watch out', 'MY_CTX');

    const call = MockFileOps.prototype.appendLogFile as jest.Mock;
    const written: string = call.mock.calls[0][0];
    expect(written).toContain('[MY_CTX]');
  });

  it('omits context brackets when context is undefined', () => {
    const logger = makeLogger();
    logger.logError('something failed');

    const call = MockFileOps.prototype.appendLogFile as jest.Mock;
    const written: string = call.mock.calls[0][0];
    // Should not contain an extra empty bracket pair
    expect(written).not.toMatch(/\[\]/);
  });
});

// ─── getLogStats ───────────────────────────────────────────────────────────────

describe('FileLogger.getLogStats', () => {
  it('returns all zeros when no entries have been logged', () => {
    const logger = makeLogger();
    const stats = logger.getLogStats();
    expect(stats).toEqual({ INFO: 0, ERROR: 0, WARNING: 0, SUCCESS: 0 });
  });

  it('counts each level correctly', () => {
    const logger = makeLogger();
    logger.logInfo('a');
    logger.logInfo('b');
    logger.logError('c');
    logger.logWarning('d');
    logger.logSuccess('e');
    logger.logSuccess('f');

    const stats = logger.getLogStats();
    expect(stats.INFO).toBe(2);
    expect(stats.ERROR).toBe(1);
    expect(stats.WARNING).toBe(1);
    expect(stats.SUCCESS).toBe(2);
  });
});

// ─── getLogEntriesByLevel ──────────────────────────────────────────────────────

describe('FileLogger.getLogEntriesByLevel', () => {
  it('returns empty array when no entries match', () => {
    const logger = makeLogger();
    logger.logInfo('msg');
    expect(logger.getLogEntriesByLevel('ERROR')).toHaveLength(0);
  });

  it('returns only entries with the requested level', () => {
    const logger = makeLogger();
    logger.logInfo('info1');
    logger.logError('err1');
    logger.logError('err2');

    const errors = logger.getLogEntriesByLevel('ERROR');
    expect(errors).toHaveLength(2);
    errors.forEach(e => expect(e.level).toBe('ERROR'));
  });

  it('returns LogEntry objects with the correct shape', () => {
    const logger = makeLogger();
    logger.logInfo('msg');
    const entries = logger.getLogEntriesByLevel('INFO');
    expect(entries[0]).toHaveProperty('level', 'INFO');
    expect(entries[0]).toHaveProperty('message', 'msg');
    expect(entries[0]).toHaveProperty('timestamp');
  });
});

// ─── getLogEntries ─────────────────────────────────────────────────────────────

describe('FileLogger.getLogEntries', () => {
  it('returns all logged entries in order', () => {
    const logger = makeLogger();
    logger.logInfo('first');
    logger.logError('second');

    const entries = logger.getLogEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].message).toBe('first');
    expect(entries[1].message).toBe('second');
  });

  it('each entry has timestamp, level, and message', () => {
    const logger = makeLogger();
    logger.logWarning('test');

    const [entry] = logger.getLogEntries();
    expect(entry.timestamp).toBeDefined();
    expect(entry.level).toBe('WARNING');
    expect(entry.message).toBe('test');
  });
});

// ─── getLogEntriesByContext ────────────────────────────────────────────────────

describe('FileLogger.getLogEntriesByContext', () => {
  it('returns entries matching context', () => {
    const logger = makeLogger();
    logger.logStepStart('step-one', 'details');
    logger.logInfo('plain info');

    const stepEntries = logger.getLogEntriesByContext('STEP');
    expect(stepEntries.length).toBeGreaterThan(0);
    stepEntries.forEach(e => expect(e.context).toBe('STEP'));
  });
});

// ─── clearLogEntries ───────────────────────────────────────────────────────────

describe('FileLogger.clearLogEntries', () => {
  it('empties the in-memory log after clearing', () => {
    const logger = makeLogger();
    logger.logInfo('a');
    logger.logError('b');
    expect(logger.getLogEntries()).toHaveLength(2);

    logger.clearLogEntries();
    expect(logger.getLogEntries()).toHaveLength(0);
  });

  it('getLogStats returns zeros after clear', () => {
    const logger = makeLogger();
    logger.logInfo('a');
    logger.clearLogEntries();
    expect(logger.getLogStats()).toEqual({ INFO: 0, ERROR: 0, WARNING: 0, SUCCESS: 0 });
  });
});

// ─── logProgress ───────────────────────────────────────────────────────────────

describe('FileLogger.logProgress', () => {
  it('creates an INFO entry with percentage in PROGRESS context', () => {
    const logger = makeLogger();
    logger.logProgress('Download', { current: 50, total: 100 });

    const entries = logger.getLogEntriesByContext('PROGRESS');
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('INFO');
    expect(entries[0].message).toContain('50%');
  });
});

// ─── logDownloadStats / logUploadStats ────────────────────────────────────────

describe('FileLogger.logDownloadStats', () => {
  it('logs STATS context entry with successful/failed/skipped counts', () => {
    const logger = makeLogger();
    logger.logDownloadStats('Photos', { total: 10, successful: 8, failed: 1, skipped: 1 });

    const entries = logger.getLogEntriesByContext('STATS');
    expect(entries).toHaveLength(1);
    expect(entries[0].message).toContain('8/10');
  });

  it('includes duration when provided', () => {
    const logger = makeLogger();
    logger.logDownloadStats('Photos', { total: 10, successful: 10, failed: 0, skipped: 0, duration: 2000 });
    const [entry] = logger.getLogEntriesByContext('STATS');
    expect(entry.message).toContain('2.0s');
  });
});

describe('FileLogger.logUploadStats', () => {
  it('logs STATS context entry mentioning "uploaded"', () => {
    const logger = makeLogger();
    logger.logUploadStats('Articles', { total: 5, successful: 5, failed: 0, skipped: 0 });
    const [entry] = logger.getLogEntriesByContext('STATS');
    expect(entry.message).toContain('uploaded');
  });
});

// ─── finalize ─────────────────────────────────────────────────────────────────

describe('FileLogger.finalize', () => {
  it('calls finalizeLogFile on the underlying fileOps', () => {
    const logger = makeLogger();
    logger.finalize();
    expect(MockFileOps.prototype.finalizeLogFile).toHaveBeenCalledWith('pull');
  });

  it('adds a FINALIZE context entry before finalizing', () => {
    const logger = makeLogger();
    logger.finalize();
    const entries = logger.getLogEntriesByContext('FINALIZE');
    expect(entries).toHaveLength(1);
  });
});

// ─── fromState ────────────────────────────────────────────────────────────────

describe('FileLogger.fromState', () => {
  it('creates a logger using sourceGuid and locale from state', () => {
    state.sourceGuid = ['from-state-guid'];
    state.locale = ['fr-ca'];
    state.rootPath = 'agility-files';

    const logger = FileLogger.fromState('push');
    expect(logger).toBeInstanceOf(FileLogger);
    // Constructor was called with the state-derived guid/locale
    expect(MockFileOps).toHaveBeenCalledWith('from-state-guid', 'fr-ca');
  });
});
