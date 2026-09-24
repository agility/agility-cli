/**
 * Selective container sync scope resolution (PROD-2547)
 *
 * Turns the `--containers` selectors a user typed into the exact set of containers a sync will
 * touch.
 *
 * The case this exists for: several containers commonly share one content model — "AON Home
 * Links" and "Mega Millions Home Links" both built on a Home Links model — and a customer
 * promoting one game to one site must not have the other games' containers dragged across with
 * it. `--models-with-deps` acts on the model, so it sweeps in every container built on it; this
 * acts on the containers themselves.
 *
 * Resolution is deliberately strict and loud. A selector that matches nothing is an error, and
 * the resolved scope is printed before anything is written — including the sibling containers
 * on the same model that are being left alone, since those are exactly what a user reaching for
 * this flag is worried about.
 */

import ansiColors from "ansi-colors";
import {
  ContainerScopeDependency,
  ContainerScopeMatch,
  ContainerScopeSibling,
  ContainerSyncScope,
} from "../../types/containerScope";

export { ContainerScopeDependency, ContainerScopeMatch, ContainerScopeSibling };

/** How many left-alone sibling containers to name before summarising the rest. */
const MAX_LISTED_SIBLINGS = 15;

/**
 * Split the raw `--containers` value into selectors. Duplicates are dropped case-insensitively
 * so `--containers="Posts,posts"` does not report the same container twice.
 */
export function parseContainerSelectors(raw: string | undefined | null): string[] {
  if (!raw) return [];

  const seen = new Set<string>();
  const selectors: string[] = [];

  raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .forEach((selector) => {
      const key = normalizeForMatch(selector);
      if (seen.has(key)) return;
      seen.add(key);
      selectors.push(selector);
    });

  return selectors;
}

/** Lowercase + trim, for case-insensitive comparison of names and selectors. */
function normalizeForMatch(value: string | null | undefined): string {
  return (value === null || value === undefined ? "" : value).trim().toLowerCase();
}

/**
 * Does `selector` name this container? A selector is matched as a container ID when it is all
 * digits, and otherwise against both the reference name and the title — the CMS shows the title
 * ("AON Home Links") while the API and the mapping files use the reference name
 * ("AONHomeLinks"), and a user may reasonably reach for either.
 */
function selectorMatchesContainer(selector: string, container: any): boolean {
  const trimmed = selector.trim();

  if (/^\d+$/.test(trimmed)) {
    return container.contentViewID === parseInt(trimmed, 10);
  }

  if (normalizeForMatch(trimmed) === normalizeForMatch(container.referenceName)) return true;
  return normalizeForMatch(trimmed) === normalizeForMatch(container.title);
}

/** The reference name of the model a container is built on, or "" when it cannot be resolved. */
export function modelReferenceNameForContainer(container: any, models: any[]): string {
  const model = (models || []).find((m: any) => m?.id === container?.contentDefinitionID);
  return model?.referenceName || container?.contentDefinitionName || "";
}

export interface ContainerSelectionResult {
  matches: ContainerScopeMatch[];
  unmatched: string[];
}

/**
 * Resolve selectors against the source instance's containers.
 *
 * A selector matching more than one container is kept as more than one match: reference names
 * are unique per instance but titles are not, and silently picking one of two same-titled
 * containers is precisely the surprise this feature exists to prevent.
 */
export function selectContainers(containers: any[], models: any[], selectors: string[]): ContainerSelectionResult {
  const matches: ContainerScopeMatch[] = [];
  const unmatched: string[] = [];
  const seen = new Set<number>();

  selectors.forEach((selector) => {
    const hits = (containers || []).filter((container) => selectorMatchesContainer(selector, container));

    if (hits.length === 0) {
      unmatched.push(selector);
      return;
    }

    hits.forEach((container) => {
      if (seen.has(container.contentViewID)) return;
      seen.add(container.contentViewID);

      matches.push({
        selector,
        contentViewID: container.contentViewID,
        referenceName: container.referenceName || "",
        title: container.title || container.referenceName || "",
        modelReferenceName: modelReferenceNameForContainer(container, models),
      });
    });
  });

  return { matches, unmatched };
}

/**
 * Containers that came into scope without being named — the containers in-scope content, or
 * content it links to, lives in. They have to be synced or the content has nowhere to land on
 * the target, but the user did not ask for them, so the preview says so.
 */
export function collectDependencyContainers(
  containers: any[],
  models: any[],
  inScopeContainerIDs: Set<number>,
  selectedContainerIDs: Set<number>
): ContainerScopeDependency[] {
  return (containers || [])
    .filter(
      (container) =>
        inScopeContainerIDs.has(container.contentViewID) && !selectedContainerIDs.has(container.contentViewID)
    )
    .map((container) => ({
      contentViewID: container.contentViewID,
      referenceName: container.referenceName || "",
      title: container.title || container.referenceName || "",
      modelReferenceName: modelReferenceNameForContainer(container, models),
    }));
}

/**
 * Containers built on a model that IS being synced but which are themselves out of scope.
 *
 * This is the list that makes the run's effect obvious: it is the set `--models-with-deps` would
 * have swept in and this run deliberately does not.
 */
export function collectSiblingContainers(
  containers: any[],
  models: any[],
  inScopeContainerIDs: Set<number>,
  inScopeModelReferenceNames: Set<string>
): ContainerScopeSibling[] {
  const inScopeModels = new Set<string>();
  inScopeModelReferenceNames.forEach((name) => inScopeModels.add(normalizeForMatch(name)));

  return (containers || [])
    .filter((container) => {
      if (inScopeContainerIDs.has(container.contentViewID)) return false;
      const modelReferenceName = modelReferenceNameForContainer(container, models);
      return !!modelReferenceName && inScopeModels.has(normalizeForMatch(modelReferenceName));
    })
    .map((container) => ({
      contentViewID: container.contentViewID,
      referenceName: container.referenceName || "",
      title: container.title || container.referenceName || "",
      modelReferenceName: modelReferenceNameForContainer(container, models),
    }));
}

/** Every container name in the source instance, for the "did you mean" list on a bad selector. */
export function listAvailableContainerNames(containers: any[]): string[] {
  const names = new Set<string>();
  (containers || []).forEach((container) => {
    const name = container?.referenceName || container?.title;
    if (name) names.add(name);
  });
  return Array.from(names).sort();
}

/** "Title (referenceName)", collapsed to one when the CMS title and reference name agree. */
function containerLabel(entry: { title: string; referenceName: string }): string {
  if (!entry.referenceName || entry.title === entry.referenceName) return entry.title || entry.referenceName;
  return `${entry.title} (${entry.referenceName})`;
}

/**
 * Render the scope so the user can see exactly what is in it before anything is written.
 *
 * `→` marks a container the user named, `+` one that came along because in-scope content lives
 * in it, and `·` a container on the same model that this run leaves alone.
 */
export function renderContainerScope(scope: ContainerSyncScope): string {
  const lines: string[] = [];
  const bar = "─".repeat(60);

  lines.push(ansiColors.cyan(bar));
  lines.push(ansiColors.cyan("📦 CONTAINER SCOPE — only these containers and their dependencies will be synced"));
  lines.push(ansiColors.cyan(bar));

  lines.push("");
  scope.matches.forEach((match) => {
    const model = match.modelReferenceName ? ansiColors.gray(` · model: ${match.modelReferenceName}`) : "";
    lines.push(`  ${ansiColors.green("→")} ${containerLabel(match)}${model}`);
  });

  if (scope.dependencies.length > 0) {
    lines.push("");
    lines.push(ansiColors.gray("  Also synced, because in-scope content links to items in them:"));
    scope.dependencies.forEach((dependency) => {
      const model = dependency.modelReferenceName ? ansiColors.gray(` · model: ${dependency.modelReferenceName}`) : "";
      lines.push(`  ${ansiColors.green("+")} ${containerLabel(dependency)}${model}`);
    });
  }

  lines.push("");
  const localeSummaries: string[] = [];
  scope.byLocale.forEach((localeScope) => {
    localeSummaries.push(`${localeScope.locale}: ${localeScope.contentCount}`);
  });
  lines.push(ansiColors.gray(`  Content items in scope — ${localeSummaries.join(", ")}`));
  lines.push(
    ansiColors.gray(
      `  Models in scope (${scope.allModelReferenceNames.size}): ${Array.from(scope.allModelReferenceNames)
        .sort()
        .join(", ")}`
    )
  );

  if (scope.siblings.length > 0) {
    lines.push("");
    lines.push(ansiColors.yellow("  Other containers on these models — left unchanged on the target:"));
    scope.siblings.slice(0, MAX_LISTED_SIBLINGS).forEach((sibling) => {
      const model = sibling.modelReferenceName ? ` · model: ${sibling.modelReferenceName}` : "";
      lines.push(ansiColors.gray(`  · ${containerLabel(sibling)}${model}`));
    });
    if (scope.siblings.length > MAX_LISTED_SIBLINGS) {
      lines.push(ansiColors.gray(`    …and ${scope.siblings.length - MAX_LISTED_SIBLINGS} more`));
    }
  }

  lines.push(ansiColors.gray("\n  No pages, templates or URL redirections are touched by a container sync."));
  lines.push(ansiColors.cyan(`\n${bar}`));

  return lines.join("\n");
}
