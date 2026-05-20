import { Logs, LogLevel } from '../logs';
import { resetState } from '../state';

beforeEach(() => {
  resetState();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── Constructor ──────────────────────────────────────────────────────────────

describe('Logs constructor', () => {
  it('creates an instance with an operation type', () => {
    const logs = new Logs('pull');
    expect(logs).toBeInstanceOf(Logs);
  });

  it('starts with zero log entries', () => {
    const logs = new Logs('push');
    expect(logs.getLogCount()).toBe(0);
  });

  it('accepts optional entityType and guid', () => {
    const logs = new Logs('sync', 'content', 'my-guid');
    expect(logs.getGuid()).toBe('my-guid');
  });
});

// ─── guid management ─────────────────────────────────────────────────────────

describe('setGuid / getGuid', () => {
  it('getGuid returns undefined when not set', () => {
    const logs = new Logs('pull');
    expect(logs.getGuid()).toBeUndefined();
  });

  it('setGuid then getGuid returns the set value', () => {
    const logs = new Logs('pull');
    logs.setGuid('test-guid-123');
    expect(logs.getGuid()).toBe('test-guid-123');
  });
});

// ─── configure ────────────────────────────────────────────────────────────────

describe('configure', () => {
  it('can disable console logging', () => {
    const logs = new Logs('pull');
    logs.configure({ logToConsole: false });
    logs.info('should not print');
    expect(console.log).not.toHaveBeenCalled();
  });

  it('can disable file logging', () => {
    const logs = new Logs('pull');
    logs.configure({ logToFile: false });
    // saveLogs with logToFile: false returns null
    const result = logs.saveLogs();
    expect(result).toBeNull();
  });

  it('can disable colors', () => {
    const logs = new Logs('pull');
    logs.configure({ showColors: false });
    // Should not throw
    logs.info('no colors');
    expect(logs.getLogCount()).toBe(1);
  });
});

// ─── log / info / error / warning / debug ─────────────────────────────────────

describe('logging methods', () => {
  it('log() increments count', () => {
    const logs = new Logs('pull');
    logs.log('INFO', 'test message');
    expect(logs.getLogCount()).toBe(1);
  });

  it('info() increments count', () => {
    const logs = new Logs('pull');
    logs.info('info message');
    expect(logs.getLogCount()).toBe(1);
  });

  it('error() increments count', () => {
    const logs = new Logs('pull');
    logs.error('error message');
    expect(logs.getLogCount()).toBe(1);
  });

  it('warning() increments count', () => {
    const logs = new Logs('pull');
    logs.warning('warning message');
    expect(logs.getLogCount()).toBe(1);
  });

  it('debug() increments count', () => {
    const logs = new Logs('pull');
    logs.debug('debug message');
    expect(logs.getLogCount()).toBe(1);
  });

  it('multiple calls accumulate', () => {
    const logs = new Logs('pull');
    logs.info('a');
    logs.info('b');
    logs.info('c');
    expect(logs.getLogCount()).toBe(3);
  });

  it('log() outputs to console when logToConsole is true', () => {
    const logs = new Logs('pull');
    logs.log('INFO', 'hello');
    expect(console.log).toHaveBeenCalled();
  });
});

// ─── fileOnly ────────────────────────────────────────────────────────────────

describe('fileOnly', () => {
  it('increments log count but does not write to console', () => {
    const logs = new Logs('pull');
    logs.fileOnly('secret log');
    expect(logs.getLogCount()).toBe(1);
    expect(console.log).not.toHaveBeenCalled();
  });
});

// ─── clearLogs ────────────────────────────────────────────────────────────────

describe('clearLogs', () => {
  it('resets count to zero', () => {
    const logs = new Logs('pull');
    logs.info('a');
    logs.info('b');
    logs.clearLogs();
    expect(logs.getLogCount()).toBe(0);
  });
});

// ─── saveLogs ─────────────────────────────────────────────────────────────────

describe('saveLogs', () => {
  it('returns null and clears logs when logToFile is false', () => {
    const logs = new Logs('pull');
    logs.configure({ logToFile: false });
    logs.info('something');
    const result = logs.saveLogs();
    expect(result).toBeNull();
    expect(logs.getLogCount()).toBe(0);
  });

  it('returns null when there are no logs', () => {
    const logs = new Logs('pull');
    const result = logs.saveLogs();
    expect(result).toBeNull();
  });
});

// ─── summary / changeDetectionSummary ─────────────────────────────────────────

describe('summary', () => {
  it('does not throw', () => {
    const logs = new Logs('push');
    expect(() => logs.summary('push', 5, 1, 2)).not.toThrow();
  });
});

describe('changeDetectionSummary', () => {
  it('does not throw and increments log count', () => {
    const logs = new Logs('pull');
    expect(() => logs.changeDetectionSummary('content', 10, 3)).not.toThrow();
    expect(logs.getLogCount()).toBeGreaterThan(0);
  });
});

// ─── logDataElement ───────────────────────────────────────────────────────────

describe('logDataElement', () => {
  it('does not throw for various statuses', () => {
    const logs = new Logs('push');
    const statuses = ['success', 'failed', 'skipped', 'conflict', 'pending', 'in_progress', 'info'] as const;
    for (const status of statuses) {
      expect(() =>
        logs.logDataElement('content', 'uploaded', status, 'TestItem', 'some-guid', 'details', 'en-us')
      ).not.toThrow();
    }
  });
});

// ─── Entity logging namespaces ─────────────────────────────────────────────────

describe('entity log namespaces', () => {
  it('asset.downloaded does not throw', () => {
    const logs = new Logs('pull', undefined, 'guid1');
    expect(() => logs.asset.downloaded({ fileName: 'photo.jpg', mediaID: 1 })).not.toThrow();
  });

  it('asset.skipped does not throw', () => {
    const logs = new Logs('pull', undefined, 'guid1');
    expect(() => logs.asset.skipped({ fileName: 'photo.jpg' })).not.toThrow();
  });

  it('model.created does not throw', () => {
    const logs = new Logs('push', undefined, 'guid1');
    expect(() => logs.model.created({ referenceName: 'MyModel', id: 5 })).not.toThrow();
  });

  it('model.skipped does not throw', () => {
    const logs = new Logs('push');
    expect(() => logs.model.skipped({ referenceName: 'MyModel' })).not.toThrow();
  });

  it('content.created does not throw', () => {
    const logs = new Logs('push');
    expect(() => logs.content.created({ properties: { referenceName: 'blog' }, contentID: 1 })).not.toThrow();
  });

  it('content.error does not throw', () => {
    const logs = new Logs('push');
    expect(() =>
      logs.content.error({ properties: { referenceName: 'blog' }, contentID: 1 }, new Error('fail'), 'en-us')
    ).not.toThrow();
  });

  it('page.downloaded does not throw', () => {
    const logs = new Logs('pull');
    expect(() => logs.page.downloaded({ name: 'Home', pageID: 1 })).not.toThrow();
  });

  it('container.created does not throw', () => {
    const logs = new Logs('push');
    expect(() => logs.container.created({ referenceName: 'BlogPosts', contentViewID: 10 })).not.toThrow();
  });

  it('template.created does not throw', () => {
    const logs = new Logs('push');
    expect(() => logs.template.created({ pageTemplateName: 'Default', pageTemplateID: 1 })).not.toThrow();
  });

  it('gallery.created does not throw', () => {
    const logs = new Logs('push');
    expect(() => logs.gallery.created({ name: 'My Gallery', id: 1 })).not.toThrow();
  });

  it('sitemap.downloaded does not throw', () => {
    const logs = new Logs('pull');
    expect(() => logs.sitemap.downloaded({ name: 'website' })).not.toThrow();
  });
});

// ─── timer helpers ─────────────────────────────────────────────────────────────

describe('timer helpers', () => {
  it('startTimer and endTimer do not throw', () => {
    const logs = new Logs('pull');
    expect(() => {
      logs.startTimer();
      logs.endTimer();
    }).not.toThrow();
  });
});
