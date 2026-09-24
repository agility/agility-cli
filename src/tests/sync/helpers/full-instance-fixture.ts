import { SyncFixture } from "./run-sync";

/**
 * One small instance that exercises **all eight push phases**.
 *
 * Hand-authored minimal JSON on purpose. A scrubbed capture from a real pull must never be
 * committed here: this repo is public and git history is permanent, and scrubbing is easy to
 * get subtly wrong (asset URLs, reference names, author names inside versions).
 *
 * Every field below is load-bearing. The ones that are non-obvious, because omitting them
 * produces a *passing* run that silently did nothing:
 *
 * - **`en-us/nestedsitemap/website.json`** — pages are driven by the sitemap, not by the page
 *   files. No sitemap means zero channels, the page loop never executes, and every page is
 *   dropped with `successful`/`failed`/`skipped` all zero.
 * - **`assets/json/*.json` wraps an `assetMedias` array** — the getter unwraps that key, so a
 *   bare media object reads back as zero assets.
 * - **`sourceFiles`** — the asset pusher streams real bytes off disk and rejects a missing or
 *   empty file. The path comes from `originUrl`, reduced to its filename.
 * - **URL redirections are locale-level** (`<locale>/urlredirections/`), not guid-level.
 * - **`gallery.modifiedOn`** in `MM/DD/YYYY hh:mma` — change detection parses it with date-fns,
 *   which calls `.match()` on the value; absent, the next sync dies with
 *   "Cannot read properties of null (reading 'match')".
 */

export const FIXTURE_LOCALE = "en-us";

export const MODEL_POST = {
  id: 10,
  displayName: "Post",
  referenceName: "Post",
  description: "Defines a blog post.",
  lastModifiedDate: "2025-01-01T00:00:00.000",
  contentDefinitionTypeName: "Content List",
  fields: [
    { type: "Text", name: "Title", label: "Title", required: true },
    { type: "Text", name: "Slug", label: "URL Slug", required: true },
  ],
};

export const CONTAINER_POSTS = {
  contentViewID: 200,
  referenceName: "Posts",
  title: "Posts",
  contentDefinitionID: 10,
  contentDefinitionName: "Post",
  lastModifiedDate: "01/01/2025 12:00AM",
  isShared: false,
};

export const GALLERY_HERO = {
  mediaGroupingID: 300,
  name: "Hero Images",
  description: null,
  media: [],
  modifiedOn: "01/01/2025 12:00AM",
};

export const ASSET_HERO = {
  mediaID: 400,
  fileName: "hero.jpg",
  originKey: "images/hero.jpg",
  originUrl: "https://cdn.test.invalid/images/hero.jpg",
  edgeUrl: "https://cdn.test.invalid/images/hero.jpg",
  size: 1234,
  mediaGroupingID: 300,
  isFolder: false,
};

export const TEMPLATE_STANDARD = {
  pageTemplateID: 700,
  pageTemplateName: "Standard",
  referenceName: "standard",
  contentSectionDefinitions: [
    { pageItemTemplateID: 71, pageItemTemplateReferenceName: "Main", itemOrder: 0, contentViewID: -1 },
  ],
  lastModifiedDate: "2025-01-01T00:00:00.000",
};

export const CONTENT_HELLO = {
  contentID: 500,
  properties: {
    state: 2,
    modified: "2025-01-01T00:00:00.000",
    versionID: 900,
    referenceName: "Posts",
    definitionName: "Post",
    itemOrder: 0,
  },
  fields: { title: "Hello" },
};

export const PAGE_HOME = {
  pageID: 800,
  name: "home",
  title: "Home",
  menuText: "Home",
  pageType: "static",
  templateName: "Standard",
  parentPageID: -1,
  placeBeforePageItemID: -1,
  channelID: 1,
  zones: {},
  properties: { state: 2, modified: "2025-01-01T00:00:00.000", versionID: 950 },
};

export const SITEMAP_WEBSITE = [
  {
    title: "Home",
    name: "home",
    pageID: 800,
    menuText: "Home",
    visible: { menu: true, sitemap: true },
    path: "/home",
    redirect: null,
    isFolder: false,
    children: [],
  },
];

export const REDIRECTIONS = {
  items: [{ id: 1, originUrl: "/old", destinationUrl: "/new", statusCode: 301 }],
  lastAccessDate: "2025-01-01T00:00:00.000",
};

/** Every element name this fixture covers, in the CLI's comma-separated form. */
export const ALL_ELEMENTS = "Models,Galleries,Assets,Containers,Content,Templates,Pages,UrlRedirections";

/** A fresh copy each call, so a test that mutates one entity cannot leak into the next. */
export function fullInstanceFixture(): SyncFixture {
  return {
    source: {
      "models/10.json": { ...MODEL_POST },
      "containers/200.json": { ...CONTAINER_POSTS },
      "galleries/300.json": { ...GALLERY_HERO },
      "assets/json/1.json": { assetMedias: [{ ...ASSET_HERO }] },
      "templates/700.json": { ...TEMPLATE_STANDARD },
      [`${FIXTURE_LOCALE}/item/500.json`]: { ...CONTENT_HELLO },
      [`${FIXTURE_LOCALE}/page/800.json`]: { ...PAGE_HOME },
      [`${FIXTURE_LOCALE}/nestedsitemap/website.json`]: SITEMAP_WEBSITE,
      [`${FIXTURE_LOCALE}/urlredirections/urlredirections.json`]: { ...REDIRECTIONS },
    },
    sourceFiles: { "assets/hero.jpg": "fake-image-bytes" },
  };
}

/** The eight push operations, in the order the orchestrator runs them. */
export const ALL_OPERATIONS = [
  "pushModels",
  "pushGalleries",
  "pushAssets",
  "pushContainers",
  "pushUrlRedirections",
  "pushTemplates",
  "pushContent",
  "pushPages",
] as const;
