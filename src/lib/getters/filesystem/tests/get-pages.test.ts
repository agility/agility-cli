import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetState, setState } from 'core/state';
import { fileOperations } from 'core/fileOperations';
import { getPagesFromFileSystem } from '../get-pages';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-test-get-pages-'));
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

describe('getPagesFromFileSystem', () => {
  it('returns an empty array when page folder does not exist', () => {
    const fileOps = makeFileOps('pages-missing');
    const result = getPagesFromFileSystem(fileOps);
    expect(result).toEqual([]);
  });

  it('returns an empty array when page folder has no JSON files', () => {
    const fileOps = makeFileOps('pages-empty-dir');
    const pageDir = path.join(fileOps.instancePath, 'page');
    fs.mkdirSync(pageDir, { recursive: true });

    const result = getPagesFromFileSystem(fileOps);

    expect(result).toEqual([]);
  });

  it('returns page items from all JSON files', () => {
    const fileOps = makeFileOps('pages-has-data');
    const pageDir = path.join(fileOps.instancePath, 'page');
    fs.mkdirSync(pageDir, { recursive: true });
    const page1 = { pageID: 1, title: 'Home', path: '/' };
    const page2 = { pageID: 2, title: 'About', path: '/about' };
    fs.writeFileSync(path.join(pageDir, '1.json'), JSON.stringify(page1));
    fs.writeFileSync(path.join(pageDir, '2.json'), JSON.stringify(page2));

    const result = getPagesFromFileSystem(fileOps);

    expect(result).toHaveLength(2);
    const ids = result.map((p: any) => p.pageID);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
  });

  it('returns page data cast as PageItem', () => {
    const fileOps = makeFileOps('pages-cast');
    const pageDir = path.join(fileOps.instancePath, 'page');
    fs.mkdirSync(pageDir, { recursive: true });
    const page = { pageID: 10, title: 'Contact', zones: {} };
    fs.writeFileSync(path.join(pageDir, '10.json'), JSON.stringify(page));

    const result = getPagesFromFileSystem(fileOps);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject(page);
  });

  it('returns a single page when exactly one file exists', () => {
    const fileOps = makeFileOps('pages-single');
    const pageDir = path.join(fileOps.instancePath, 'page');
    fs.mkdirSync(pageDir, { recursive: true });
    const page = { pageID: 7, title: 'Blog' };
    fs.writeFileSync(path.join(pageDir, '7.json'), JSON.stringify(page));

    const result = getPagesFromFileSystem(fileOps);

    expect(result).toHaveLength(1);
    expect((result[0] as any).pageID).toBe(7);
  });
});
