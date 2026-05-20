import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetState } from 'core/state';
import { handleSyncToken } from 'lib/downloaders/sync-token-handler';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('handleSyncToken', () => {
  describe('reset=false', () => {
    it('returns true (incremental sync) when token file exists and reset is false', async () => {
      const tokenPath = path.join(tmpDir, 'sync-exists.json');
      fs.writeFileSync(tokenPath, JSON.stringify({ token: 'abc' }));

      const result = await handleSyncToken(tokenPath, false);

      expect(result).toBe(true);
    });

    it('returns false (full sync) when token file does not exist and reset is false', async () => {
      const tokenPath = path.join(tmpDir, 'sync-missing.json');

      const result = await handleSyncToken(tokenPath, false);

      expect(result).toBe(false);
    });
  });

  describe('reset=true', () => {
    it('returns false (full sync) when token file exists and reset is true', async () => {
      const tokenPath = path.join(tmpDir, 'sync-to-delete.json');
      fs.writeFileSync(tokenPath, JSON.stringify({ token: 'abc' }));

      const result = await handleSyncToken(tokenPath, true);

      expect(result).toBe(false);
    });

    it('deletes the sync token file when reset is true and file exists', async () => {
      const tokenPath = path.join(tmpDir, 'sync-delete-check.json');
      fs.writeFileSync(tokenPath, JSON.stringify({ token: 'abc' }));

      await handleSyncToken(tokenPath, true);

      expect(fs.existsSync(tokenPath)).toBe(false);
    });

    it('returns false (full sync) when token file does not exist and reset is true', async () => {
      const tokenPath = path.join(tmpDir, 'sync-nonexistent.json');

      const result = await handleSyncToken(tokenPath, true);

      expect(result).toBe(false);
    });

    it('does not throw when the token file does not exist and reset is true', async () => {
      const tokenPath = path.join(tmpDir, 'sync-nonexistent2.json');

      await expect(handleSyncToken(tokenPath, true)).resolves.not.toThrow();
    });
  });

  describe('return value semantics', () => {
    it.each([
      { reset: false, fileExists: true,  expected: true,  label: 'no-reset + file → incremental' },
      { reset: false, fileExists: false, expected: false, label: 'no-reset + no file → full' },
      { reset: true,  fileExists: true,  expected: false, label: 'reset + file → full' },
      { reset: true,  fileExists: false, expected: false, label: 'reset + no file → full' },
    ])('$label', async ({ reset, fileExists, expected }) => {
      const tokenPath = path.join(tmpDir, `sync-table-${Date.now()}-${Math.random()}.json`);
      if (fileExists) {
        fs.writeFileSync(tokenPath, '{}');
      }

      const result = await handleSyncToken(tokenPath, reset);

      expect(result).toBe(expected);
    });
  });
});
