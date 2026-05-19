import { systemArgs } from '../system-args';

// ─── Structure ─────────────────────────────────────────────────────────────────

describe('systemArgs – required keys exist', () => {
  const expectedKeys = [
    'token', 'dev', 'local', 'preprod', 'headless', 'verbose',
    'rootPath', 'legacyFolders', 'locale', 'channel', 'preview',
    'elements', 'insecure', 'baseUrl', 'models', 'modelsWithDeps',
    'test', 'dryRun', 'contentIDs', 'pageIDs', 'sourceGuid', 'targetGuid',
    'overwrite', 'force', 'update', 'reset', 'autoPublish',
  ];

  it.each(expectedKeys)('has key "%s"', (key) => {
    expect(systemArgs).toHaveProperty(key);
  });
});

describe('systemArgs – types', () => {
  it('boolean args declare type "boolean"', () => {
    const boolArgs = ['dev', 'local', 'preprod', 'headless', 'verbose',
                      'legacyFolders', 'preview', 'insecure', 'test', 'dryRun',
                      'overwrite', 'force', 'update', 'reset'];
    for (const key of boolArgs) {
      expect((systemArgs as any)[key].type).toBe('boolean');
    }
  });

  it('string args declare type "string"', () => {
    const strArgs = ['token', 'rootPath', 'locale', 'channel', 'elements',
                     'baseUrl', 'models', 'modelsWithDeps', 'contentIDs',
                     'pageIDs', 'sourceGuid', 'targetGuid'];
    for (const key of strArgs) {
      expect((systemArgs as any)[key].type).toBe('string');
    }
  });
});

describe('systemArgs – defaults', () => {
  it('rootPath defaults to "agility-files"', () => {
    expect(systemArgs.rootPath.default).toBe('agility-files');
  });

  it('channel defaults to "website"', () => {
    expect(systemArgs.channel.default).toBe('website');
  });

  it('preview defaults to true', () => {
    expect(systemArgs.preview.default).toBe(true);
  });

  it('headless defaults to false', () => {
    expect(systemArgs.headless.default).toBe(false);
  });

  it('overwrite defaults to false', () => {
    expect(systemArgs.overwrite.default).toBe(false);
  });

  it('force defaults to false', () => {
    expect(systemArgs.force.default).toBe(false);
  });

  it('test defaults to false', () => {
    expect(systemArgs.test.default).toBe(false);
  });

  it('dryRun defaults to false', () => {
    expect(systemArgs.dryRun.default).toBe(false);
  });

  it('elements includes all expected element types', () => {
    const defaultElements = systemArgs.elements.default as string;
    const expected = ['Models', 'Galleries', 'Assets', 'Containers', 'Content', 'Templates', 'Pages', 'Sitemaps'];
    for (const element of expected) {
      expect(defaultElements).toContain(element);
    }
  });
});

// ─── autoPublish coerce function ─────────────────────────────────────────────

describe('systemArgs.autoPublish coerce', () => {
  const coerce = systemArgs.autoPublish.coerce as (v: string | boolean) => string;

  it('converts boolean true → "both"', () => {
    expect(coerce(true)).toBe('both');
  });

  it('converts empty string → "both"', () => {
    expect(coerce('')).toBe('both');
  });

  it('converts boolean false → ""', () => {
    expect(coerce(false)).toBe('');
  });

  it('passes through "content"', () => {
    expect(coerce('content')).toBe('content');
  });

  it('passes through "pages"', () => {
    expect(coerce('pages')).toBe('pages');
  });

  it('passes through "both"', () => {
    expect(coerce('both')).toBe('both');
  });

  it('is case-insensitive for valid values', () => {
    expect(coerce('CONTENT')).toBe('content');
    expect(coerce('Pages')).toBe('pages');
    expect(coerce('BOTH')).toBe('both');
  });

  it('defaults to "both" for unrecognized values', () => {
    expect(coerce('unknown-value')).toBe('both');
  });
});

// ─── aliases ─────────────────────────────────────────────────────────────────

describe('systemArgs – aliases', () => {
  it('locale has "locales" alias', () => {
    expect((systemArgs.locale as any).alias).toContain('locales');
  });

  it('dryRun has "dry-run" alias', () => {
    expect((systemArgs.dryRun as any).alias).toContain('dry-run');
  });

  it('autoPublish has "auto-publish" alias', () => {
    expect((systemArgs.autoPublish as any).alias).toContain('auto-publish');
  });

  it('models has "model" alias', () => {
    expect((systemArgs.models as any).alias).toContain('model');
  });

  it('sourceGuid has "source-guid" alias', () => {
    expect((systemArgs.sourceGuid as any).alias).toContain('source-guid');
  });

  it('targetGuid has "target-guid" alias', () => {
    expect((systemArgs.targetGuid as any).alias).toContain('target-guid');
  });
});
