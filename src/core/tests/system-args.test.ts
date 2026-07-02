import { systemArgs } from "../system-args";

// ─── Structure ─────────────────────────────────────────────────────────────────

describe("systemArgs – required keys exist", () => {
  const expectedKeys = [
    "token",
    "dev",
    "headless",
    "verbose",
    "locales",
    "channel",
    "elements",
    "models",
    "modelsWithDeps",
    "contentIDs",
    "pageIDs",
    "sourceGuid",
    "targetGuid",
    "overwrite",
    "autoPublish",
  ];

  it.each(expectedKeys)('has key "%s"', (key) => {
    expect(systemArgs).toHaveProperty(key);
  });
});

describe("systemArgs – removed keys do not exist", () => {
  const removedKeys = [
    "local",
    "preprod",
    "rootPath",
    "legacyFolders",
    "locale",
    "preview",
    "insecure",
    "baseUrl",
    "test",
    "dryRun",
    "force",
    "update",
    "reset",
  ];

  it.each(removedKeys)('no longer exposes "%s"', (key) => {
    expect(systemArgs).not.toHaveProperty(key);
  });
});

describe("systemArgs – types", () => {
  it('boolean args declare type "boolean"', () => {
    const boolArgs = ["dev", "headless", "verbose", "overwrite"];
    for (const key of boolArgs) {
      expect((systemArgs as any)[key].type).toBe("boolean");
    }
  });

  it('string args declare type "string"', () => {
    const strArgs = [
      "token",
      "locales",
      "channel",
      "elements",
      "models",
      "modelsWithDeps",
      "contentIDs",
      "pageIDs",
      "sourceGuid",
      "targetGuid",
    ];
    for (const key of strArgs) {
      expect((systemArgs as any)[key].type).toBe("string");
    }
  });
});

describe("systemArgs – defaults", () => {
  it('channel defaults to "website"', () => {
    expect(systemArgs.channel.default).toBe("website");
  });

  it("headless defaults to false", () => {
    expect(systemArgs.headless.default).toBe(false);
  });

  it("overwrite defaults to false", () => {
    expect(systemArgs.overwrite.default).toBe(false);
  });

  it("elements includes all expected element types", () => {
    const defaultElements = systemArgs.elements.default as string;
    const expected = ["Models", "Galleries", "Assets", "Containers", "Content", "Templates", "Pages", "Sitemaps"];
    for (const element of expected) {
      expect(defaultElements).toContain(element);
    }
  });
});

// ─── autoPublish coerce function ─────────────────────────────────────────────

describe("systemArgs.autoPublish coerce", () => {
  const coerce = systemArgs.autoPublish.coerce as (v: string | boolean) => string;

  it('converts boolean true → "both"', () => {
    expect(coerce(true)).toBe("both");
  });

  it('converts empty string → "both"', () => {
    expect(coerce("")).toBe("both");
  });

  it('converts boolean false → ""', () => {
    expect(coerce(false)).toBe("");
  });

  it('passes through "content"', () => {
    expect(coerce("content")).toBe("content");
  });

  it('passes through "pages"', () => {
    expect(coerce("pages")).toBe("pages");
  });

  it('passes through "both"', () => {
    expect(coerce("both")).toBe("both");
  });

  it("is case-insensitive for valid values", () => {
    expect(coerce("CONTENT")).toBe("content");
    expect(coerce("Pages")).toBe("pages");
    expect(coerce("BOTH")).toBe("both");
  });

  it('defaults to "both" for unrecognized values', () => {
    expect(coerce("unknown-value")).toBe("both");
  });
});

// ─── aliases ─────────────────────────────────────────────────────────────────

describe("systemArgs – aliases", () => {
  it('locales has "LOCALES" alias', () => {
    expect((systemArgs.locales as any).alias).toContain("LOCALES");
  });

  it('autoPublish has "auto-publish" alias', () => {
    expect((systemArgs.autoPublish as any).alias).toContain("auto-publish");
  });

  it('models no longer has a "model" alias', () => {
    expect((systemArgs.models as any).alias).toBeUndefined();
  });

  it('sourceGuid has "source-guid" alias', () => {
    expect((systemArgs.sourceGuid as any).alias).toContain("source-guid");
  });

  it('targetGuid has "target-guid" alias', () => {
    expect((systemArgs.targetGuid as any).alias).toContain("target-guid");
  });

  // Regression guard: yargs silently drops an option from `--help` when its
  // alias array contains the option's own key name. Keep keys out of aliases.
  it("no option lists its own key name as an alias", () => {
    for (const [key, def] of Object.entries(systemArgs)) {
      const alias = (def as any).alias;
      if (alias) {
        const aliases = Array.isArray(alias) ? alias : [alias];
        expect(aliases).not.toContain(key);
      }
    }
  });
});

describe("systemArgs – help text", () => {
  it("every option has a non-empty describe (shown in --help)", () => {
    for (const def of Object.values(systemArgs)) {
      expect(typeof (def as any).describe).toBe("string");
      expect((def as any).describe.length).toBeGreaterThan(0);
    }
  });
});
