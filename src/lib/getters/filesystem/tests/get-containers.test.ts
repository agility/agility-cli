import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetState, setState } from 'core/state';
import { fileOperations } from 'core/fileOperations';
import { getListsFromFileSystem, getContainersFromFileSystem } from '../get-containers';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-test-get-containers-'));
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

function makeFileOps(subDir: string): fileOperations {
  const root = path.join(tmpDir, subDir);
  fs.mkdirSync(root, { recursive: true });
  setState({ rootPath: root });
  return new fileOperations('test-guid', 'en-us');
}

// ─── getListsFromFileSystem ──────────────────────────────────────────────────

describe('getListsFromFileSystem', () => {
  it('returns an empty array when list folder does not exist', async () => {
    const fileOps = makeFileOps('lists-missing');
    const result = await getListsFromFileSystem(fileOps);
    expect(result).toEqual([]);
  });

  it('returns containers from all JSON files in list folder', async () => {
    const fileOps = makeFileOps('lists-has-data');
    const listDir = path.join(fileOps.instancePath, 'list');
    fs.mkdirSync(listDir, { recursive: true });
    const container1 = { referenceName: 'blogposts', contentCount: 5 };
    const container2 = { referenceName: 'articles', contentCount: 3 };
    fs.writeFileSync(path.join(listDir, 'blogposts.json'), JSON.stringify(container1));
    fs.writeFileSync(path.join(listDir, 'articles.json'), JSON.stringify(container2));

    const result = await getListsFromFileSystem(fileOps);

    expect(result).toHaveLength(2);
    const refs = (result as any[]).map((c: any) => c.referenceName);
    expect(refs).toContain('blogposts');
    expect(refs).toContain('articles');
  });

  it('returns an empty array when list folder is empty', async () => {
    const fileOps = makeFileOps('lists-empty-dir');
    const listDir = path.join(fileOps.instancePath, 'list');
    fs.mkdirSync(listDir, { recursive: true });

    const result = await getListsFromFileSystem(fileOps);

    expect(result).toEqual([]);
  });
});

// ─── getContainersFromFileSystem ─────────────────────────────────────────────

describe('getContainersFromFileSystem', () => {
  it('returns an empty array when containers folder does not exist', () => {
    const fileOps = makeFileOps('containers-missing');
    const result = getContainersFromFileSystem(fileOps);
    expect(result).toEqual([]);
  });

  it('returns containers from all JSON files in containers folder', () => {
    const fileOps = makeFileOps('containers-has-data');
    const containersDir = path.join(fileOps.instancePath, 'containers');
    fs.mkdirSync(containersDir, { recursive: true });
    const c1 = { referenceName: 'news', contentViewID: 100 };
    const c2 = { referenceName: 'events', contentViewID: 101 };
    fs.writeFileSync(path.join(containersDir, '100.json'), JSON.stringify(c1));
    fs.writeFileSync(path.join(containersDir, '101.json'), JSON.stringify(c2));

    const result = getContainersFromFileSystem(fileOps);

    expect(result).toHaveLength(2);
    const refs = result.map((c: any) => c.referenceName);
    expect(refs).toContain('news');
    expect(refs).toContain('events');
  });

  it('returns an empty array when containers folder is empty', () => {
    const fileOps = makeFileOps('containers-empty-dir');
    const containersDir = path.join(fileOps.instancePath, 'containers');
    fs.mkdirSync(containersDir, { recursive: true });

    const result = getContainersFromFileSystem(fileOps);

    expect(result).toEqual([]);
  });
});
