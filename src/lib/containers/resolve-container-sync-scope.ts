/**
 * Resolve the `--containers` scope for a whole sync run (PROD-2547).
 *
 * Runs once, after the source/target pull and before any pusher writes anything, so the scope
 * can be printed and validated up front. A selector that matches no container in the source
 * instance is a hard stop rather than a warning: it is almost always a typo, and letting it
 * through would sync a narrower set than the user asked for without saying so.
 *
 * Unlike the `--pages` scope, the dependency trees are built HERE rather than inside the data
 * loader. The preview has to name the containers that come along as dependencies — not just the
 * ones the user typed — and working those out means walking the content anyway, so the trees are
 * built once and carried on the scope for the loader to filter with.
 */

import ansiColors from "ansi-colors";
import { ContainerSyncScope, LocaleContainerScope } from "../../types/containerScope";
import {
  collectDependencyContainers,
  collectSiblingContainers,
  listAvailableContainerNames,
  renderContainerScope,
  selectContainers,
} from "./container-scope";

export { ContainerSyncScope };

/** How many example container names to show when a selector matches nothing. */
const MAX_SUGGESTED_CONTAINERS = 25;

/** The slice of a loaded instance this resolver needs. */
export interface ContainerScopeEntities {
  containers: any[];
  models: any[];
  content: any[];
  [key: string]: any;
}

export interface ResolveContainerSyncScopeOptions {
  sourceGuid: string;
  targetGuid: string;
  locales: string[];
  selectors: string[];
  /** Injected in tests; defaults to reading the pulled instance off disk. */
  loadEntities?: (guid: string, locale: string) => Promise<ContainerScopeEntities>;
  /** Injected in tests; defaults to the real dependency-tree builder. */
  buildTree?: (entities: ContainerScopeEntities, containerIDs: number[]) => LocaleContainerScope["tree"];
}

export async function resolveContainerSyncScope({
  sourceGuid,
  targetGuid,
  locales,
  selectors,
  loadEntities,
  buildTree,
}: ResolveContainerSyncScopeOptions): Promise<ContainerSyncScope> {
  if (selectors.length === 0) {
    throw new Error("Container validation failed. --containers was provided but contained no container selectors.");
  }

  // The selectors are validated against the instance loaded for the first locale, so with no
  // locales there is nothing to validate them against — and a typo would pass silently.
  if (locales.length === 0) {
    throw new Error("Container validation failed. --containers needs at least one locale to resolve its scope.");
  }

  const readEntities =
    loadEntities ??
    (async (guid: string, locale: string) => {
      const { GuidDataLoader } = await import("../pushers/guid-data-loader");
      return (await new GuidDataLoader(guid).loadCompleteGuidEntities(locale)) as ContainerScopeEntities;
    });

  let makeTree = buildTree;
  if (!makeTree) {
    // Imported lazily, in step with how the rest of the push path pulls the tree builder in.
    const { ModelDependencyTreeBuilder } = await import("../models/model-dependency-tree-builder");
    makeTree = (entities: ContainerScopeEntities, containerIDs: number[]) =>
      new ModelDependencyTreeBuilder(entities as any, targetGuid, sourceGuid).buildDependencyTreeFromContainers(
        containerIDs
      );
  }

  const byLocale = new Map<string, LocaleContainerScope>();
  const allContainerIDs = new Set<number>();
  const allModelReferenceNames = new Set<string>();

  // Containers and models are instance-wide, so the selection itself is resolved once, against
  // the first locale's load. Only the CONTENT differs per locale, and with it the containers and
  // models that content drags in.
  let containers: any[] = [];
  let models: any[] = [];
  let matches: ReturnType<typeof selectContainers>["matches"] = [];

  for (let index = 0; index < locales.length; index++) {
    const locale = locales[index];
    const entities = await readEntities(sourceGuid, locale);

    if (index === 0) {
      containers = entities.containers || [];
      models = entities.models || [];

      const selection = selectContainers(containers, models, selectors);
      assertEverySelectorMatched(selection.unmatched, containers);
      matches = selection.matches;
    }

    const tree = makeTree(
      entities,
      matches.map((match) => match.contentViewID)
    );

    byLocale.set(locale, { locale, tree, contentCount: tree.content.size });
    tree.containers.forEach((id) => allContainerIDs.add(id));
    tree.models.forEach((name) => allModelReferenceNames.add(name));
  }

  const selectedContainerIDs = new Set<number>(matches.map((match) => match.contentViewID));

  return {
    selectors,
    matches,
    dependencies: collectDependencyContainers(containers, models, allContainerIDs, selectedContainerIDs),
    siblings: collectSiblingContainers(containers, models, allContainerIDs, allModelReferenceNames),
    byLocale,
    allContainerIDs,
    allModelReferenceNames,
  };
}

/** Containers are instance-wide, so a selector that matched nothing matched nothing anywhere. */
function assertEverySelectorMatched(unmatched: string[], containers: any[]): void {
  if (unmatched.length === 0) return;

  const available = listAvailableContainerNames(containers);
  const shown = available.slice(0, MAX_SUGGESTED_CONTAINERS);

  console.log(ansiColors.red(`❌ No container matched: ${unmatched.join(", ")}`));
  if (shown.length > 0) {
    console.log(ansiColors.gray(`Available containers (${available.length}): ${shown.join(", ")}`));
    if (available.length > shown.length) {
      console.log(ansiColors.gray(`  …and ${available.length - shown.length} more`));
    }
  } else {
    console.log(ansiColors.gray("No containers were found — pull the source instance before scoping a sync."));
  }

  throw new Error(
    `Container validation failed. No container matched: ${unmatched.join(", ")}. ` +
      `Pass a container reference name (e.g. "AONHomeLinks"), its title, or its container ID.`
  );
}

/** Print the resolved scope. Called before any pusher writes to the target. */
export function printContainerSyncScope(scope: ContainerSyncScope): void {
  console.log(renderContainerScope(scope));
}
