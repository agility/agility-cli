/**
 * Types for selective container sync (PROD-2547).
 *
 * These live in `types/` rather than next to the resolver so `core/state` can hold a resolved
 * scope without importing `lib/containers` — which would pull the dependency-tree builder, and
 * through it SitemapHierarchy, back into `core/state`.
 */

/** A container a `--containers` selector resolved to. */
export interface ContainerScopeMatch {
  /** The selector the user typed, verbatim. */
  selector: string;
  contentViewID: number;
  referenceName: string;
  title: string;
  /** The reference name of the model the container is built on, if it could be resolved. */
  modelReferenceName: string;
}

/** A container pulled into the scope by something the user selected, rather than named directly. */
export interface ContainerScopeDependency {
  contentViewID: number;
  referenceName: string;
  title: string;
  modelReferenceName: string;
}

/**
 * A container built on an in-scope model that is deliberately being left alone.
 *
 * This is the case the ticket is about: "AON Home Links" and "Mega Millions Home Links" share a
 * model, and syncing one must not drag the other across. Listing the ones staying behind is what
 * makes the result of the run obvious before it happens.
 */
export interface ContainerScopeSibling {
  contentViewID: number;
  referenceName: string;
  title: string;
  modelReferenceName: string;
}

/**
 * The parts of a dependency tree a container scope cares about.
 *
 * Declared structurally rather than imported from the tree builder to keep `core/state` free of
 * `lib/` imports. `ModelDependencyTree` is assignable to it.
 */
export interface ContainerScopeTree {
  containers: Set<number>;
  models: Set<string>;
  content: Set<number>;
  assets: Set<string>;
  galleries: Set<number>;
}

/** What one locale contributed to the scope. Only content is locale-scoped; containers are not. */
export interface LocaleContainerScope {
  locale: string;
  /** The dependency tree built from this locale's content. */
  tree: ContainerScopeTree;
  /** How many content items are in scope for this locale. */
  contentCount: number;
}

/** The resolved `--containers` scope for a whole sync run. */
export interface ContainerSyncScope {
  /** The selectors the user typed, in order. */
  selectors: string[];
  /** One entry per container a selector resolved to. */
  matches: ContainerScopeMatch[];
  /** Containers pulled in because in-scope content or linked content lives in them. */
  dependencies: ContainerScopeDependency[];
  /** Containers on an in-scope model that this run will not touch. */
  siblings: ContainerScopeSibling[];
  /** Resolved scope per locale. */
  byLocale: Map<string, LocaleContainerScope>;
  /** Every in-scope container ID, across every locale. */
  allContainerIDs: Set<number>;
  /** Every in-scope model reference name, across every locale. */
  allModelReferenceNames: Set<string>;
}
