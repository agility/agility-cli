import { Push } from '../push';
import { resetState, setState } from '../state';

beforeEach(() => {
  resetState();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── Constructor ──────────────────────────────────────────────────────────────

describe('Push constructor', () => {
  it('creates an instance without throwing', () => {
    expect(() => new Push()).not.toThrow();
  });
});

// ─── pushInstances – guard clauses ───────────────────────────────────────────

describe('Push.pushInstances', () => {
  it('throws when neither sourceGuid nor targetGuid are set', async () => {
    const push = new Push();
    await expect(push.pushInstances()).rejects.toThrow('No GUIDs specified');
  });

  it('resolves (passes the GUID guard) when sourceGuid and targetGuid are both set', async () => {
    setState({ sourceGuid: 'source-guid-u', targetGuid: 'target-guid-u' });
    const push = new Push();
    // Should not throw "No GUIDs specified" — it may resolve or fail later for other reasons
    const result = await push.pushInstances().catch((err: Error) => err);
    if (result instanceof Error) {
      expect(result.message).not.toContain('No GUIDs specified');
    } else {
      expect(result).toBeDefined();
    }
  });
});
