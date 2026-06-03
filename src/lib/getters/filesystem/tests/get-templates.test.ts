import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetState, setState } from 'core/state';
import { fileOperations } from 'core/fileOperations';
import { getTemplatesFromFileSystem } from '../get-templates';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-test-get-templates-'));
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

describe('getTemplatesFromFileSystem', () => {
  it('returns an empty array when templates folder does not exist', () => {
    const fileOps = makeFileOps('templates-missing');
    const result = getTemplatesFromFileSystem(fileOps);
    expect(result).toEqual([]);
  });

  it('returns an empty array when templates folder has no JSON files', () => {
    const fileOps = makeFileOps('templates-empty-dir');
    const templatesDir = path.join(fileOps.instancePath, 'templates');
    fs.mkdirSync(templatesDir, { recursive: true });

    const result = getTemplatesFromFileSystem(fileOps);

    expect(result).toEqual([]);
  });

  it('returns templates from all JSON files', () => {
    const fileOps = makeFileOps('templates-has-data');
    const templatesDir = path.join(fileOps.instancePath, 'templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    const t1 = { pageModelID: 1, referenceName: 'FullWidthTemplate' };
    const t2 = { pageModelID: 2, referenceName: 'TwoColumnTemplate' };
    fs.writeFileSync(path.join(templatesDir, '1.json'), JSON.stringify(t1));
    fs.writeFileSync(path.join(templatesDir, '2.json'), JSON.stringify(t2));

    const result = getTemplatesFromFileSystem(fileOps);

    expect(result).toHaveLength(2);
    const refs = result.map((t: any) => t.referenceName);
    expect(refs).toContain('FullWidthTemplate');
    expect(refs).toContain('TwoColumnTemplate');
  });

  it('returns template data cast as PageModel', () => {
    const fileOps = makeFileOps('templates-cast');
    const templatesDir = path.join(fileOps.instancePath, 'templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    const template = { pageModelID: 5, referenceName: 'LandingPage', zones: ['main', 'sidebar'] };
    fs.writeFileSync(path.join(templatesDir, '5.json'), JSON.stringify(template));

    const result = getTemplatesFromFileSystem(fileOps);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject(template);
  });

  it('returns a single template when exactly one file exists', () => {
    const fileOps = makeFileOps('templates-single');
    const templatesDir = path.join(fileOps.instancePath, 'templates');
    fs.mkdirSync(templatesDir, { recursive: true });
    const template = { pageModelID: 3, referenceName: 'BlogPost' };
    fs.writeFileSync(path.join(templatesDir, '3.json'), JSON.stringify(template));

    const result = getTemplatesFromFileSystem(fileOps);

    expect(result).toHaveLength(1);
    expect((result[0] as any).referenceName).toBe('BlogPost');
  });
});
