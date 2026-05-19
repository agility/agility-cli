import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetState, setState, state, initializeGuidLogger } from 'core/state';

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-tpl-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir, sourceGuid: 'src-tpl-u', targetGuid: 'tgt-tpl-u', token: 'test-token' });
  initializeGuidLogger('src-tpl-u', 'push');
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

let templateCounter = 0;

function makeTemplate(overrides: Record<string, any> = {}): any {
  templateCounter++;
  return {
    pageTemplateID: templateCounter,
    pageTemplateName: `Template ${templateCounter}`,
    referenceName: `template-${templateCounter}`,
    contentSectionDefinitions: [],
    lastModifiedDate: new Date(2020, 0, 1).toISOString(),
    ...overrides,
  };
}

// ─── pushTemplates — empty sourceData guard ───────────────────────────────────

describe('pushTemplates — empty sourceData guard', () => {
  it('returns success with zeros when sourceData is empty', async () => {
    state.cachedApiClient = {
      pageMethods: { savePageTemplate: jest.fn() },
    } as any;

    const { pushTemplates } = await import('../template-pusher');
    const result = await pushTemplates([], [], 'en-us');

    expect(result.status).toBe('success');
    expect(result.successful).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('returns success with zeros when sourceData is null', async () => {
    state.cachedApiClient = {
      pageMethods: { savePageTemplate: jest.fn() },
    } as any;

    const { pushTemplates } = await import('../template-pusher');
    const result = await pushTemplates(null as any, [], 'en-us');

    expect(result.status).toBe('success');
    expect(result.successful).toBe(0);
  });

  it('logs "No templates found" when empty', async () => {
    state.cachedApiClient = {
      pageMethods: { savePageTemplate: jest.fn() },
    } as any;

    const consoleSpy = jest.spyOn(console, 'log');
    const { pushTemplates } = await import('../template-pusher');
    await pushTemplates([], [], 'en-us');

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('No templates'));
  });
});

// ─── pushTemplates — skip when template exists in target by name ───────────────

describe('pushTemplates — skip when template exists in target by name (no mapping)', () => {
  it('skips template that exists in target by name and creates mapping', async () => {
    const savePageTemplate = jest.fn().mockResolvedValue(makeTemplate());
    state.cachedApiClient = {
      pageMethods: { savePageTemplate },
    } as any;

    const { pushTemplates } = await import('../template-pusher');

    const sourceTpl = makeTemplate({ pageTemplateName: 'SharedTemplate' });
    const targetTpl = makeTemplate({ pageTemplateName: 'SharedTemplate' });

    const result = await pushTemplates([sourceTpl], [targetTpl], 'en-us');

    expect(result.skipped).toBe(1);
    expect(result.successful).toBe(0);
    expect(savePageTemplate).not.toHaveBeenCalled();
  });
});

// ─── pushTemplates — create path ──────────────────────────────────────────────

describe('pushTemplates — create new template', () => {
  it('calls savePageTemplate when no existing mapping and not in target by name', async () => {
    const savedTpl = makeTemplate({ pageTemplateID: 99 });
    const savePageTemplate = jest.fn().mockResolvedValue(savedTpl);
    state.cachedApiClient = {
      pageMethods: { savePageTemplate },
    } as any;

    const { pushTemplates } = await import('../template-pusher');

    const sourceTpl = makeTemplate({ pageTemplateName: 'UniqueNewTemplate' });

    const result = await pushTemplates([sourceTpl], [], 'en-us');

    expect(savePageTemplate).toHaveBeenCalledTimes(1);
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('counts as failed when savePageTemplate throws', async () => {
    const savePageTemplate = jest.fn().mockRejectedValue(new Error('API error'));
    state.cachedApiClient = {
      pageMethods: { savePageTemplate },
    } as any;

    const { pushTemplates } = await import('../template-pusher');

    const sourceTpl = makeTemplate({ pageTemplateName: 'ErrorTemplate' });

    const result = await pushTemplates([sourceTpl], [], 'en-us');

    expect(result.failed).toBe(1);
    expect(result.successful).toBe(0);
    expect(result.status).toBe('error');
  });
});

// ─── pushTemplates — result shape ────────────────────────────────────────────

describe('pushTemplates — result shape', () => {
  it('returns status, successful, failed, skipped fields', async () => {
    state.cachedApiClient = {
      pageMethods: { savePageTemplate: jest.fn() },
    } as any;

    const { pushTemplates } = await import('../template-pusher');
    const result = await pushTemplates([], [], 'en-us');

    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('successful');
    expect(result).toHaveProperty('failed');
    expect(result).toHaveProperty('skipped');
  });
});

// ─── pushTemplates — overwrite mode ──────────────────────────────────────────

describe('pushTemplates — overwrite mode', () => {
  it('calls savePageTemplate for new template regardless of overwrite setting', async () => {
    state.overwrite = false;

    const savedTpl = makeTemplate({ pageTemplateID: 88 });
    const savePageTemplate = jest.fn().mockResolvedValue(savedTpl);
    state.cachedApiClient = {
      pageMethods: { savePageTemplate },
    } as any;

    const { pushTemplates } = await import('../template-pusher');

    // Template not in target, no mapping — goes through create path
    const sourceTpl = makeTemplate({ pageTemplateName: 'NewUniqueTemplate2' });

    const result = await pushTemplates([sourceTpl], [], 'en-us');

    expect(savePageTemplate).toHaveBeenCalledTimes(1);
    expect(result.successful).toBe(1);
  });
});
