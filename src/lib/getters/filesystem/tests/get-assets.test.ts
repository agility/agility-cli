import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetState, setState } from 'core/state';
import { fileOperations } from 'core/fileOperations';
import { getAssetsFromFileSystem } from '../get-assets';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-test-get-assets-'));
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

describe('getAssetsFromFileSystem', () => {
  it('returns an empty array when assets/json folder does not exist', () => {
    const fileOps = makeFileOps('assets-empty');
    const result = getAssetsFromFileSystem(fileOps);
    expect(result).toEqual([]);
  });

  it('returns an empty array when assets/json folder has no JSON files', () => {
    const fileOps = makeFileOps('assets-no-files');
    const jsonDir = path.join(fileOps.instancePath, 'assets', 'json');
    fs.mkdirSync(jsonDir, { recursive: true });
    const result = getAssetsFromFileSystem(fileOps);
    expect(result).toEqual([]);
  });

  it('returns assets from a single file with assetMedias array', () => {
    const fileOps = makeFileOps('assets-single');
    const jsonDir = path.join(fileOps.instancePath, 'assets', 'json');
    fs.mkdirSync(jsonDir, { recursive: true });
    const assetData = {
      assetMedias: [
        { mediaID: 1, fileName: 'test.png' },
        { mediaID: 2, fileName: 'logo.jpg' },
      ],
    };
    fs.writeFileSync(path.join(jsonDir, 'page1.json'), JSON.stringify(assetData));

    const result = getAssetsFromFileSystem(fileOps);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ mediaID: 1, fileName: 'test.png' });
    expect(result[1]).toMatchObject({ mediaID: 2, fileName: 'logo.jpg' });
  });

  it('returns combined assets from multiple JSON files', () => {
    const fileOps = makeFileOps('assets-multi');
    const jsonDir = path.join(fileOps.instancePath, 'assets', 'json');
    fs.mkdirSync(jsonDir, { recursive: true });
    fs.writeFileSync(
      path.join(jsonDir, 'file1.json'),
      JSON.stringify({ assetMedias: [{ mediaID: 10 }, { mediaID: 11 }] })
    );
    fs.writeFileSync(
      path.join(jsonDir, 'file2.json'),
      JSON.stringify({ assetMedias: [{ mediaID: 20 }] })
    );

    const result = getAssetsFromFileSystem(fileOps);

    expect(result).toHaveLength(3);
    const ids = result.map((a: any) => a.mediaID);
    expect(ids).toContain(10);
    expect(ids).toContain(11);
    expect(ids).toContain(20);
  });

  it('skips files where assetMedias is absent', () => {
    const fileOps = makeFileOps('assets-skip-no-prop');
    const jsonDir = path.join(fileOps.instancePath, 'assets', 'json');
    fs.mkdirSync(jsonDir, { recursive: true });
    fs.writeFileSync(path.join(jsonDir, 'no-medias.json'), JSON.stringify({ someOtherProp: [] }));
    fs.writeFileSync(
      path.join(jsonDir, 'with-medias.json'),
      JSON.stringify({ assetMedias: [{ mediaID: 5 }] })
    );

    const result = getAssetsFromFileSystem(fileOps);

    expect(result).toHaveLength(1);
    expect((result[0] as any).mediaID).toBe(5);
  });

  it('skips files where assetMedias is not an array', () => {
    const fileOps = makeFileOps('assets-skip-non-array');
    const jsonDir = path.join(fileOps.instancePath, 'assets', 'json');
    fs.mkdirSync(jsonDir, { recursive: true });
    fs.writeFileSync(path.join(jsonDir, 'bad.json'), JSON.stringify({ assetMedias: 'notAnArray' }));

    const result = getAssetsFromFileSystem(fileOps);

    expect(result).toEqual([]);
  });

  it('returns an empty array when assetMedias is an empty array', () => {
    const fileOps = makeFileOps('assets-empty-array');
    const jsonDir = path.join(fileOps.instancePath, 'assets', 'json');
    fs.mkdirSync(jsonDir, { recursive: true });
    fs.writeFileSync(path.join(jsonDir, 'empty.json'), JSON.stringify({ assetMedias: [] }));

    const result = getAssetsFromFileSystem(fileOps);

    expect(result).toEqual([]);
  });
});
