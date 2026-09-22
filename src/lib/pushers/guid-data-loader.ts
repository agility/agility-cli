/**
 * GUID Data Loader Service
 *
 * Loads all entity types from the filesystem using consistent getter patterns.
 * Provides unified data loading for sync operations for any specified GUID.
 *
 * ✅ USES: Proven filesystem getter pattern
 * ✅ HANDLES: Correct directory structure (page/, item/, list/, etc.)
 * ✅ SUPPORTS: All Agility CMS entity types
 * ✅ FLEXIBLE: Works with any GUID (source or target)
 */

import * as fs from "fs";
import ansiColors from "ansi-colors";
import { fileOperations } from "../../core/fileOperations";
import { getState } from "../../core/state";
import * as mgmtApi from "@agility/management-sdk";

// Shared model→model reference resolver, defined alongside the dependency-tree builder so both the
// --models (here) and --models-with-deps (tree builder) paths use the same logic. 
import { resolveReferencedModels, ModelDependencyTree } from "../models/model-dependency-tree-builder";
import { PageSyncScope } from "../pages/resolve-page-sync-scope";
export { resolveReferencedModels };

export interface ModelFilterOptions {
  models?: string[]; // Simple model filtering
  modelsWithDeps?: string[]; // Model filtering with dependency tree
  // PROD-2546: selective page sync. Already resolved (and validated) by
  // resolvePageSyncScope before any pusher runs.
  pageScope?: PageSyncScope;
}

export interface GuidEntities {
  pages: any[];
  templates: mgmtApi.PageModel[];
  containers: any[];
  lists: any[];
  models: any[];
  content: any[];
  assets: any[];
  galleries: any[];
  urlRedirections: any[];
}

export class GuidDataLoader {
  private guid: string;
  private static hasLoggedDependencyTree = false;
  // PROD-2546: one dependency tree per locale, built on first use. loadGuidEntities is called
  // once per phase per locale, and each build re-reads every entity off disk.
  private pageScopeTrees = new Map<string, ModelDependencyTree>();

  constructor(guid: string) {
    this.guid = guid;
  }

  /**
   * Reset logging flags for a new operation
   */
  static resetLoggingFlags(): void {
    GuidDataLoader.hasLoggedDependencyTree = false;
  }

  /**
   * Load all entities for the specified GUID and locale - guarantees arrays are always returned
   */
  async loadGuidEntities(locale: string, filterOptions?: ModelFilterOptions): Promise<GuidEntities> {
    const state = getState();

    // For sync operations, models-with-deps, or a --pages scope, we need ALL elements for proper
    // change detection and dependency resolution.
    // Element filtering happens at the processing level, not the loading level: --elements still
    // decides which push phases run, it just no longer hides a dependency from the scope builder.
    // Both the flag and the resolved scope are checked: the flag covers the unfiltered target-side
    // load, and the resolved scope covers a caller that passes one without going through state.
    const needsCompleteData = state.isSync || state.modelsWithDeps || state.pages || !!filterOptions?.pageScope;
    const elements = needsCompleteData
      ? ["Galleries", "Assets", "Models", "Containers", "Content", "Templates", "Pages", "Sitemaps", "UrlRedirections"]
      : state.elements.split(",");

    const guidFileOps = new fileOperations(this.guid);
    const localeFileOps = new fileOperations(this.guid, locale);

    // Initialize with empty arrays - no nulls/undefined ever
    const guidEntities: GuidEntities = {
      assets: [],
      galleries: [],
      models: [],
      containers: [],
      lists: [],
      content: [],
      pages: [],
      templates: [],
      urlRedirections: [],
    };

    // Load different entity types using pure getters for consistent architecture
    if (elements.includes("Galleries")) {
      const { getGalleriesFromFileSystem } = await import("../getters/filesystem/get-galleries");
      const galleries = getGalleriesFromFileSystem(guidFileOps);
      guidEntities.galleries = Array.isArray(galleries) ? galleries : [];
    }

    if (elements.includes("Assets")) {
      const { getAssetsFromFileSystem } = await import("../getters/filesystem/get-assets");
      const assets = getAssetsFromFileSystem(guidFileOps);
      guidEntities.assets = Array.isArray(assets) ? assets : [];
    }

    if (elements.includes("Models")) {
      const { getModelsFromFileSystem } = await import("../getters/filesystem/get-models");
      const models = getModelsFromFileSystem(guidFileOps);
      guidEntities.models = Array.isArray(models) ? models : [];
    }

    if (elements.includes("Containers")) {
      const { getListsFromFileSystem, getContainersFromFileSystem } =
        await import("../getters/filesystem/get-containers");
      const containers = getContainersFromFileSystem(guidFileOps);
      guidEntities.containers = Array.isArray(containers) ? containers : [];

      const lists = getListsFromFileSystem(guidFileOps);
      guidEntities.lists = Array.isArray(lists) ? lists : [];
    }

    if (elements.includes("Content")) {
      const { getContentItemsFromFileSystem } = await import("../getters/filesystem/get-content-items");
      const content = getContentItemsFromFileSystem(localeFileOps);
      guidEntities.content = Array.isArray(content) ? content : [];
    }

    if (elements.includes("Templates")) {
      const { getTemplatesFromFileSystem } = await import("../getters/filesystem/get-templates");
      const templates = getTemplatesFromFileSystem(guidFileOps);
      guidEntities.templates = Array.isArray(templates) ? templates : [];
    }

    if (elements.includes("Pages")) {
      const { getPagesFromFileSystem } = await import("../getters/filesystem/get-pages");
      const pages = getPagesFromFileSystem(localeFileOps);
      guidEntities.pages = Array.isArray(pages) ? pages : [];
    }

    if (elements.includes("UrlRedirections")) {
      const { getUrlRedirectionsFromFileSystem } = await import("../getters/filesystem/get-url-redirections");
      // Redirections are instance-wide but stored per-locale by the sync SDK — one locale's file is the full set
      const urlRedirections = getUrlRedirectionsFromFileSystem(localeFileOps);
      guidEntities.urlRedirections = Array.isArray(urlRedirections) ? urlRedirections : [];
    }

    // PROD-2546: a --pages scope replaces model filtering entirely (the two are rejected as a
    // combination up front), so it is applied first and returns directly.
    if (filterOptions?.pageScope) {
      return await this.applyPageScopeFiltering(guidEntities, filterOptions.pageScope, locale);
    }

    // Apply model filtering if requested
    if (filterOptions) {
      return await this.applyModelFiltering(guidEntities, filterOptions, locale, state.targetGuid, state.sourceGuid);
    }

    return guidEntities;
  }

  /**
   * Narrow the loaded entities to a selective page sync (PROD-2546).
   *
   * Pages and content are filtered against THIS locale's tree, since both are locale-scoped.
   * Everything else — models, containers, templates, assets, galleries — is instance-wide and
   * filtered against the union of every locale's tree: the guid-level push phases run once
   * with the first locale, so scoping them to that locale alone would drop a model or template
   * that only a page in another locale needs.
   *
   * URL redirections are instance-wide and unrelated to any page subtree, so a page-scoped
   * sync never touches them.
   */
  private async applyPageScopeFiltering(
    guidEntities: GuidEntities,
    pageScope: PageSyncScope,
    locale: string
  ): Promise<GuidEntities> {
    const localeTree = await this.getPageScopeTree(pageScope, locale);
    const instanceWide = await this.getInstanceWidePageScope(pageScope);

    const assetKey = (asset: any): string => asset?.url || asset?.originUrl || asset?.edgeUrl;
    // Templates are keyed by pageTemplateID; `id` is tolerated for any caller that supplies it.
    const templateKey = (template: any): number => template?.pageTemplateID ?? template?.id;

    return {
      models: guidEntities.models.filter((m: any) => instanceWide.models.has(m.referenceName)),
      containers: guidEntities.containers.filter((c: any) => instanceWide.containers.has(c.contentViewID)),
      lists: [],
      content: guidEntities.content.filter((c: any) => localeTree.content.has(c.contentID)),
      templates: guidEntities.templates.filter((t: any) => instanceWide.templates.has(templateKey(t))),
      pages: guidEntities.pages.filter((p: any) => localeTree.pages.has(p.pageID)),
      assets: guidEntities.assets.filter((a: any) => instanceWide.assets.has(assetKey(a))),
      galleries: guidEntities.galleries.filter((g: any) => instanceWide.galleries.has(g.galleryID)),
      urlRedirections: [],
    };
  }

  /** Build (and cache) the dependency tree for one locale's in-scope pages. */
  private async getPageScopeTree(pageScope: PageSyncScope, locale: string): Promise<ModelDependencyTree> {
    const cached = this.pageScopeTrees.get(locale);
    if (cached) return cached;

    // The tree has to be built from complete data — the same reason the models-with-deps path
    // reloads everything — or a dependency outside the requested --elements is invisible.
    const completeEntities = await this.loadCompleteGuidEntities(locale);
    const localeScope = pageScope.byLocale.get(locale);
    const pageIDs = localeScope ? Array.from(localeScope.pageIDs) : [];

    const { ModelDependencyTreeBuilder } = await import("../models/model-dependency-tree-builder");
    const state = getState();
    const treeBuilder = new ModelDependencyTreeBuilder(completeEntities, state.targetGuid, state.sourceGuid);
    const tree = treeBuilder.buildDependencyTreeFromPages(pageIDs);

    this.pageScopeTrees.set(locale, tree);
    return tree;
  }

  /** Union the instance-wide parts of every locale's tree. */
  private async getInstanceWidePageScope(pageScope: PageSyncScope): Promise<{
    models: Set<string>;
    containers: Set<number>;
    templates: Set<number>;
    assets: Set<string>;
    galleries: Set<number>;
  }> {
    const union = {
      models: new Set<string>(),
      containers: new Set<number>(),
      templates: new Set<number>(),
      assets: new Set<string>(),
      galleries: new Set<number>(),
    };

    const locales: string[] = [];
    pageScope.byLocale.forEach((_scope, scopeLocale) => locales.push(scopeLocale));

    for (const scopeLocale of locales) {
      const tree = await this.getPageScopeTree(pageScope, scopeLocale);
      tree.models.forEach((m) => union.models.add(m));
      tree.containers.forEach((c) => union.containers.add(c));
      tree.templates.forEach((t) => union.templates.add(t));
      tree.assets.forEach((a) => union.assets.add(a));
      tree.galleries.forEach((g) => union.galleries.add(g));
    }

    return union;
  }

  /**
   * Apply model filtering using existing ModelDependencyTreeBuilder
   */
  private async applyModelFiltering(
    guidEntities: GuidEntities,
    filterOptions: ModelFilterOptions,
    locale: string,
    targetGuid: string,
    sourceGuid: string
  ): Promise<GuidEntities> {
    // Determine which filtering mode to use
    let modelNames: string[] = [];
    let useFullDependencyTree = false;

    if (filterOptions.modelsWithDeps && filterOptions.modelsWithDeps.length > 0) {
      modelNames = filterOptions.modelsWithDeps;
      useFullDependencyTree = true;
    } else if (filterOptions.models && filterOptions.models.length > 0) {
      modelNames = filterOptions.models;
      useFullDependencyTree = false;
    } else {
      // No filtering requested
      return guidEntities;
    }

    let completeEntities: GuidEntities | null = null;
    if (useFullDependencyTree) {
      // Only log the filtering message once per operation
      if (!GuidDataLoader.hasLoggedDependencyTree) {
        GuidDataLoader.hasLoggedDependencyTree = true;
      }
      // CRITICAL FIX: For dependency tree filtering, we need to load ALL entities first
      // to ensure the dependency tree builder has complete data to work with
      completeEntities = await this.loadCompleteGuidEntities(locale);

      // Safety check: ensure completeEntities has models loaded
      if (!completeEntities || !completeEntities.models || completeEntities.models.length === 0) {
        throw new Error(
          `Failed to load models for dependency tree filtering. ` +
            `Please ensure you have pulled data first: ` +
            `agility pull --guid ${this.guid} --locale ${locale}`
        );
      }
    }

    // Import and use ModelDependencyTreeBuilder with complete data
    const { ModelDependencyTreeBuilder } = await import("../models/model-dependency-tree-builder");
    const treeBuilder = new ModelDependencyTreeBuilder(useFullDependencyTree ? completeEntities! : guidEntities, targetGuid, sourceGuid);

    // Validate that specified models exist
    const validation = treeBuilder.validateModels(modelNames, (completeEntities ?? guidEntities).models);
    if (validation.invalid.length > 0) {
      // Use the correct source for available models (same as validation)
      const sourceForValidation = useFullDependencyTree ? completeEntities : guidEntities;
      const availableModels = sourceForValidation?.models?.map((m: any) => m.referenceName) || [];

      // Check for case-insensitive matches to help debug
      const invalidWithSuggestions = validation.invalid.map((invalidName) => {
        const caseInsensitiveMatch = availableModels.find(
          (available: string) => available.toLowerCase() === invalidName.toLowerCase()
        );
        return caseInsensitiveMatch ? `${invalidName} (did you mean "${caseInsensitiveMatch}"?)` : invalidName;
      });

      console.log(ansiColors.red(`❌ Invalid model names: ${invalidWithSuggestions.join(", ")}`));
      console.log(ansiColors.gray(`Available models (${availableModels.length}): ${availableModels.join(", ")}`));

      // Throw error to stop sync instead of returning unfiltered data
      throw new Error(
        `Model validation failed. Invalid model(s): ${validation.invalid.join(", ")}. ` +
          `Please check the model name(s) and try again.`
      );
    }

    // --models (simple): pull ONLY the requested models plus the models they reference through
    // linked-content fields (e.g. FooterLinks → FooterLinksLists), transitively. No content, pages,
    // containers, or assets. Referenced models must be included or the model push fails on the target
    // with a 404 "Definition for setting X not found".
    if (!useFullDependencyTree) {
      const expandedModels = resolveReferencedModels(validation.valid, (completeEntities ?? guidEntities).models);
      return this.filterGuidEntitiesByModels(guidEntities, expandedModels);
    }

    // Build dependency tree and filter all related entities using complete data
    const dependencyTree = treeBuilder.buildDependencyTree(validation.valid, locale);

    return await this.filterGuidEntitiesByDependencyTree(completeEntities, dependencyTree, locale);
  }

  /**
   * Filter entities by dependency tree (full dependency filtering) with incremental change detection
   */
  private async filterGuidEntitiesByDependencyTree(
    guidEntities: GuidEntities,
    dependencyTree: any,
    locale: string
  ): Promise<GuidEntities> {
    // Import change detection utilities
    const {
      extractContentItemModifiedDate,
      extractModelModifiedDate,
      extractContainerModifiedDate,
      extractAssetModifiedDate,
      extractPageModifiedDate,
      extractGalleryModifiedDate,
      extractTemplateModifiedDate,
      isEntityModifiedSinceLastPull,
      getLastPullTimestamp,
    } = await import("../incremental");

    const rootPath = "agility-files";

    // Filter models with change detection
    const filteredModels = guidEntities.models.filter((m: any) => {
      if (!dependencyTree.models.has(m.referenceName)) return false;

      const modifiedDate = extractModelModifiedDate(m);
      const lastPull = getLastPullTimestamp(this.guid, rootPath, "models");
      return isEntityModifiedSinceLastPull(modifiedDate, lastPull);
    });

    // Filter containers with change detection
    const filteredContainers = guidEntities.containers.filter((c: any) => {
      if (!dependencyTree.containers.has(c.contentViewID)) return false;

      const modifiedDate = extractContainerModifiedDate(c);
      const lastPull = getLastPullTimestamp(this.guid, rootPath, "containers");
      return isEntityModifiedSinceLastPull(modifiedDate, lastPull);
    });

    // Filter content with change detection
    const filteredContent = guidEntities.content.filter((c: any) => {
      if (!dependencyTree.content.has(c.contentID)) return false;

      const modifiedDate = extractContentItemModifiedDate(c);
      const lastPull = getLastPullTimestamp(this.guid, rootPath, "content");
      return isEntityModifiedSinceLastPull(modifiedDate, lastPull);
    });

    // Filter assets with change detection
    const filteredAssets = guidEntities.assets.filter((a: any) => {
      if (!dependencyTree.assets.has(a.url || a.originUrl || a.edgeUrl)) return false;

      const modifiedDate = extractAssetModifiedDate(a);
      const lastPull = getLastPullTimestamp(this.guid, rootPath, "assets");
      return isEntityModifiedSinceLastPull(modifiedDate, lastPull);
    });

    // Filter pages with change detection
    const filteredPages = guidEntities.pages.filter((p: any) => {
      if (!dependencyTree.pages.has(p.pageID)) return false;

      const modifiedDate = extractPageModifiedDate(p);
      const lastPull = getLastPullTimestamp(this.guid, rootPath, "pages");
      return isEntityModifiedSinceLastPull(modifiedDate, lastPull);
    });

    // Filter galleries with change detection
    const filteredGalleries = guidEntities.galleries.filter((g: any) => {
      if (!dependencyTree.galleries.has(g.galleryID)) return false;

      const modifiedDate = extractGalleryModifiedDate(g);
      const lastPull = getLastPullTimestamp(this.guid, rootPath, "galleries");
      return isEntityModifiedSinceLastPull(modifiedDate, lastPull);
    });

    const filteredLists = guidEntities.lists.filter((l: any) => dependencyTree.lists.has(l.contentViewID));

    // Templates always require full refresh (no change detection)
    const filteredTemplates = guidEntities.templates.filter((t: any) => dependencyTree.templates.has(t.id));

    return {
      models: filteredModels,
      containers: filteredContainers,
      lists: filteredLists,
      content: filteredContent,
      templates: filteredTemplates,
      pages: filteredPages,
      assets: filteredAssets,
      galleries: filteredGalleries,
      // Redirections are never part of a model dependency tree
      urlRedirections: [],
    };
  }

  /**
   * Filter entities by models only (simple filtering)
   */
  private filterGuidEntitiesByModels(guidEntities: GuidEntities, modelNames: string[]): GuidEntities {
    const modelSet = new Set(modelNames);

    return {
      models: guidEntities.models.filter((m: any) => modelSet.has(m.referenceName)),
      containers: [],
      lists: [],
      content: [],
      templates: [],
      pages: [],
      assets: [],
      galleries: [],
      urlRedirections: [],
    };
  }

  /**
   * Check if we have any content to process
   */
  hasNoContent(guidEntities: GuidEntities): boolean {
    return Object.values(guidEntities).every((arr: any[]) => arr.length === 0);
  }

  /**
   * Get entity counts for summary reporting
   */
  getEntityCounts(guidEntities: GuidEntities): Record<string, number> {
    return {
      pages: guidEntities.pages.length,
      templates: guidEntities.templates.length,
      containers: guidEntities.containers.length,
      lists: guidEntities.lists.length,
      models: guidEntities.models.length,
      content: guidEntities.content.length,
      assets: guidEntities.assets.length,
      galleries: guidEntities.galleries.length,
      urlRedirections: guidEntities.urlRedirections.length,
    };
  }

  /**
   * Validate that the data directory exists and contains expected structure
   */
  validateDataStructure(locale: string): boolean {
    const state = getState();
    // Use enhanced fileOperations instancePath property
    const instancePath = new fileOperations(this.guid).instancePath;

    if (!fs.existsSync(instancePath)) {
      console.error(ansiColors.red(`❌ Data directory not found for GUID ${this.guid}: ${instancePath}`));
      console.log(ansiColors.yellow(`💡 Make sure you have pulled data first:`));
      console.log(`   node dist/index.js pull --guid ${this.guid} --locale ${locale} --channel website --verbose`);
      return false;
    }

    return true;
  }

  /**
   * Load complete GUID entities without any filtering - needed for dependency tree building
   */
  private async loadCompleteGuidEntities(locale: string): Promise<GuidEntities> {
    const guidFileOps = new fileOperations(this.guid);
    const localeFileOps = new fileOperations(this.guid, locale);

    // Initialize with empty arrays - no nulls/undefined ever
    const guidEntities: GuidEntities = {
      assets: [],
      galleries: [],
      models: [],
      containers: [],
      lists: [],
      content: [],
      pages: [],
      templates: [],
      urlRedirections: [],
    };

    // Load ALL entity types regardless of state.elements for complete dependency analysis
    const { getGalleriesFromFileSystem } = await import("../getters/filesystem/get-galleries");
    const galleries = getGalleriesFromFileSystem(guidFileOps);
    guidEntities.galleries = Array.isArray(galleries) ? galleries : [];

    const { getAssetsFromFileSystem } = await import("../getters/filesystem/get-assets");
    const assets = getAssetsFromFileSystem(guidFileOps);
    guidEntities.assets = Array.isArray(assets) ? assets : [];

    const { getModelsFromFileSystem } = await import("../getters/filesystem/get-models");
    const models = getModelsFromFileSystem(guidFileOps);
    guidEntities.models = Array.isArray(models) ? models : [];

    const { getListsFromFileSystem, getContainersFromFileSystem } =
      await import("../getters/filesystem/get-containers");
    const containers = getContainersFromFileSystem(guidFileOps);
    guidEntities.containers = Array.isArray(containers) ? containers : [];

    const lists = getListsFromFileSystem(guidFileOps);
    guidEntities.lists = Array.isArray(lists) ? lists : [];

    const { getContentItemsFromFileSystem } = await import("../getters/filesystem/get-content-items");
    const content = getContentItemsFromFileSystem(localeFileOps);
    guidEntities.content = Array.isArray(content) ? content : [];

    const { getTemplatesFromFileSystem } = await import("../getters/filesystem/get-templates");
    const templates = getTemplatesFromFileSystem(guidFileOps);
    guidEntities.templates = Array.isArray(templates) ? templates : [];

    const { getPagesFromFileSystem } = await import("../getters/filesystem/get-pages");
    const pages = getPagesFromFileSystem(localeFileOps);
    guidEntities.pages = Array.isArray(pages) ? pages : [];

    const { getUrlRedirectionsFromFileSystem } = await import("../getters/filesystem/get-url-redirections");
    const urlRedirections = getUrlRedirectionsFromFileSystem(localeFileOps);
    guidEntities.urlRedirections = Array.isArray(urlRedirections) ? urlRedirections : [];

    return guidEntities;
  }

  /**
   * Get the GUID this loader is configured for
   */
  getGuid(): string {
    return this.guid;
  }
}

// Keep backward compatibility with existing code
// SourceDataLoader deprecated - use GuidDataLoader directly
export type SourceEntities = GuidEntities;
