import { resetState } from 'core/state';
import { ConsoleManager } from 'lib/ui/console/console-manager';

beforeEach(() => {
  resetState();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── formatMessage (pure, via getConsoleState round-trip) ─────────────────────

describe('ConsoleManager', () => {
  it('starts with mode "plain" and isRedirected false', () => {
    const mgr = new ConsoleManager();
    const s = mgr.getConsoleState();
    expect(s.mode).toBe('plain');
    expect(s.isRedirected).toBe(false);
  });

  it('getMode returns the current mode', () => {
    const mgr = new ConsoleManager();
    expect(mgr.getMode()).toBe('plain');
  });
});
