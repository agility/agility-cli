/**
 * Small hand-built fixtures for the verify checks. Not a test file (no `.test.ts`), so Jest only
 * loads it through the tests that import it.
 */
import { buildMappingIndex, MappingIndex, MappingType } from "../mapping-index";
import { createVerifyContext, SideEntities, VerifyContext } from "../verify-context";

export const LOCALE = "en-us";
export const SRC = "src-guid";
export const TGT = "tgt-guid";

export function emptySide(overrides: Partial<SideEntities> = {}): SideEntities {
  return {
    models: [],
    containers: [],
    templates: [],
    assets: [],
    galleries: [],
    content: [],
    pages: [],
    sitemaps: {},
    ...overrides,
  };
}

export interface MappingFixture {
  models?: any[];
  containers?: any[];
  templates?: any[];
  sections?: any[];
  galleries?: any[];
  assets?: any[];
  /** Per locale: item / page mapping records. */
  locales?: Record<string, { item?: any[]; page?: any[] }>;
}

export function mappingIndex(fixture: MappingFixture, locales: string[] = [LOCALE]): MappingIndex {
  return buildMappingIndex((type: MappingType, locale?: string) => {
    if (locale) return (fixture.locales?.[locale] as any)?.[type] ?? [];
    return (fixture as any)[type] ?? [];
  }, locales);
}

export function context(input: {
  source: Partial<SideEntities>;
  target: Partial<SideEntities>;
  mappings: MappingFixture;
  locale?: string;
  scoped?: boolean;
  channels?: string[];
}): VerifyContext {
  const locale = input.locale ?? LOCALE;
  return createVerifyContext({
    sourceGuid: SRC,
    targetGuid: TGT,
    locale,
    mappings: mappingIndex(input.mappings, [locale]),
    source: emptySide(input.source),
    target: emptySide(input.target),
    scoped: input.scoped,
    channels: input.channels,
  });
}

/** Content mapping records from [sourceID, targetID] pairs. */
export function itemMappings(pairs: Array<[number, number]>): any[] {
  return pairs.map(([s, t]) => ({ sourceGuid: SRC, targetGuid: TGT, sourceContentID: s, targetContentID: t }));
}

export function pageMappings(pairs: Array<[number, number]>): any[] {
  return pairs.map(([s, t]) => ({ sourceGuid: SRC, targetGuid: TGT, sourcePageID: s, targetPageID: t }));
}

export function item(contentID: number, fields: any, props: Partial<Record<string, any>> = {}): any {
  return {
    contentID,
    properties: {
      state: 2,
      modified: "2026-01-01T00:00:00",
      versionID: contentID * 10,
      referenceName: "posts",
      definitionName: "Post",
      itemOrder: 0,
      ...props,
    },
    fields,
  };
}

export const POST_MODEL_SOURCE = {
  id: 10,
  referenceName: "Post",
  fields: [
    { name: "Title", type: "Text", settings: { Required: "True" } },
    { name: "Body", type: "HTML", settings: { Required: "False" } },
    { name: "Related", type: "Content", settings: { Required: "False" } },
  ],
};

export const POST_MODEL_TARGET = { ...POST_MODEL_SOURCE, id: 110 };

export function module(name: string, contentID: number): any {
  return { title: name, module: name, item: { contentid: contentID, fulllist: false } };
}

export function section(id: number, referenceName: string, itemOrder: number): any {
  return { pageItemTemplateID: id, pageItemTemplateReferenceName: referenceName, itemOrder };
}

export function page(pageID: number, zones: Record<string, any[]>, overrides: Record<string, any> = {}): any {
  return {
    pageID,
    name: "home",
    title: "Home",
    menuText: "Home",
    pageType: "static",
    templateName: "Standard",
    redirectUrl: "",
    securePage: false,
    visible: { menu: true, sitemap: true },
    seo: { metaDescription: "", metaKeywords: "" },
    scripts: { excludedFromGlobal: false, top: "", bottom: "" },
    properties: { state: 2, modified: "2026-01-01T00:00:00", versionID: pageID * 10 },
    zones,
    ...overrides,
  };
}
