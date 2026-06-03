import { Pull } from '../pull';
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

describe('Pull constructor', () => {
  it('creates an instance without throwing', () => {
    expect(() => new Pull()).not.toThrow();
  });
});

// ─── pullInstances – guard clauses ────────────────────────────────────────────

describe('Pull.pullInstances', () => {
  it('throws when no source GUIDs are set and update=true (default)', async () => {
    // Default state: update=true, sourceGuid=[], so allGuids stays empty
    setState({ update: true });
    const pull = new Pull();
    await expect(pull.pullInstances(false)).rejects.toThrow('No GUIDs specified');
  });

  it('throws when called from push with update=false and no targetGuid', async () => {
    setState({ update: false });
    // fromPush=true, update=false → allGuids = targetGuid = []
    const pull = new Pull();
    await expect(pull.pullInstances(true)).rejects.toThrow('No GUIDs specified');
  });

  it('throws when called from push with update=true and no source or target guids', async () => {
    setState({ update: true });
    // fromPush=true, update=true → allGuids = sourceGuid + targetGuid = []
    const pull = new Pull();
    await expect(pull.pullInstances(true)).rejects.toThrow('No GUIDs specified');
  });
});
