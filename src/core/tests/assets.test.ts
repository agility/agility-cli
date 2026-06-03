import { assets } from '../assets';
import { fileOperations } from '../fileOperations';
import { resetState, setState } from '../state';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-assets-tests-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir });
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function makeMultibarStub() {
  return {
    create: jest.fn().mockReturnValue({
      update: jest.fn(),
      increment: jest.fn(),
      stop: jest.fn(),
    }),
    stop: jest.fn(),
  } as any;
}

// ─── Constructor ──────────────────────────────────────────────────────────────

describe('assets constructor', () => {
  it('creates an instance without throwing', () => {
    const fileOps = new fileOperations('test-guid', 'en-us');
    const multibar = makeMultibarStub();
    expect(() => new assets({} as any, multibar, fileOps)).not.toThrow();
  });

  it('initializes unProcessedAssets as an empty object', () => {
    const fileOps = new fileOperations('test-guid', 'en-us');
    const multibar = makeMultibarStub();
    const instance = new assets({} as any, multibar, fileOps);
    expect(instance.unProcessedAssets).toEqual({});
  });

  it('accepts an optional progressCallback', () => {
    const fileOps = new fileOperations('test-guid', 'en-us');
    const multibar = makeMultibarStub();
    const cb = jest.fn();
    expect(() => new assets({} as any, multibar, fileOps, false, cb)).not.toThrow();
  });

  it('accepts legacyFolders flag', () => {
    const fileOps = new fileOperations('test-guid', 'en-us');
    const multibar = makeMultibarStub();
    expect(() => new assets({} as any, multibar, fileOps, true)).not.toThrow();
  });
});
