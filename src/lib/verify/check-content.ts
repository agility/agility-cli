/**
 * Content checks for one locale (PROD-2552).
 *
 * Per mapped pair:
 *  - contentModelMismatch      the target item is of a different model (through the model mapping)
 *  - contentContainerMismatch  the target item sits in a different container — skipped for items
 *                              placed on a page, whose container name is auto-generated
 *  - fieldMismatch             one per differing field, compared in canonical form; also path
 *                              "geo" when the item's own GEO data differs (dynamic page list items,
 *                              PROD-2729)
 *  - sourceAssetUrlInTarget    a target field still points at an asset in the SOURCE instance
 *  - publishStateDifference    (warning) the two items are in different workflow states
 * Per container / model (unscoped runs only):
 *  - countMismatch             failure when the target has fewer items, warning when it has more
 * Per list container:
 *  - listOrderMismatch         the items' order (itemOrder) differs, with both sequences
 *
 * Ignored: contentID, versionID, modified, and the item's own state (beyond the warning above).
 */
import { Finding, FindingCollector } from "./verify-report";
import { ComparablePair, contentSourceDefect } from "./check-mapping-integrity";
import { sourceCanonicalContext, targetCanonicalContext, VerifyContext } from "./verify-context";
import { canonicalEquals, canonicalFields, canonicalValue, describeDifference, diffCanonical } from "./canonicalize";

function lower(value: any): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

/** Every string inside a value, with the dotted path to it. */
function walkStrings(value: any, path: string, visit: (text: string, path: string) => void): void {
  if (typeof value === "string") visit(value, path);
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, visit));
  else if (value && typeof value === "object")
    Object.keys(value).forEach((k) => walkStrings(value[k], `${path}.${k}`, visit));
}

export function checkContent(ctx: VerifyContext, pairs: ComparablePair[], collector: FindingCollector): void {
  const { locale } = ctx;
  const sourceCtx = sourceCanonicalContext(ctx);
  const targetCtx = targetCanonicalContext(ctx);

  pairs.forEach(({ sourceID, targetID, source, target }) => {
    const findings: Finding[] = [];
    const name = source?.properties?.referenceName;
    const base = { entity: "content" as const, locale, sourceID, targetID, name };

    const sourceModelName = lower(source?.properties?.definitionName);
    const targetModelName = lower(target?.properties?.definitionName);
    const expectedModel = ctx.mappings.modelNames.target(sourceModelName) ?? sourceModelName;
    if (expectedModel !== targetModelName) {
      findings.push({
        ...base,
        category: "contentModelMismatch",
        severity: "failure",
        path: "definitionName",
        expected: expectedModel,
        actual: targetModelName,
      });
    }

    if (!ctx.source.pageBoundContentIDs.has(sourceID)) {
      const sourceContainer = lower(source?.properties?.referenceName);
      const expectedContainer = ctx.mappings.containerNames.target(sourceContainer) ?? sourceContainer;
      const actualContainer = lower(target?.properties?.referenceName);
      if (expectedContainer !== actualContainer) {
        findings.push({
          ...base,
          category: "contentContainerMismatch",
          severity: "failure",
          path: "referenceName",
          expected: expectedContainer,
          actual: actualContainer,
        });
      }
    }

    const sourceModel = ctx.source.modelsByRef.get(sourceModelName);
    const targetModel = ctx.target.modelsByRef.get(targetModelName);
    const expectedFields = canonicalFields(source?.fields, sourceModel, sourceCtx);
    const actualFields = canonicalFields(target?.fields, targetModel, targetCtx);
    diffCanonical(expectedFields, actualFields).forEach((diff) => {
      findings.push({
        ...base,
        category: "fieldMismatch",
        severity: "failure",
        path: diff.field,
        expected: diff.expected,
        actual: diff.actual,
      });
    });

    // PROD-2729: an item in a dynamic page list carries its own `geo`; a sync that didn't copy it
    // (or a target that rejected it) shows here. Absent on both sides compares equal.
    const expectedGeo = canonicalValue(source?.geo, sourceCtx);
    const actualGeo = canonicalValue(target?.geo, targetCtx);
    if (!canonicalEquals(expectedGeo, actualGeo)) {
      findings.push({
        ...base,
        category: "fieldMismatch",
        severity: "failure",
        path: "geo",
        ...describeDifference(expectedGeo, actualGeo),
      });
    }

    const leaked = new Map<string, string[]>();
    walkStrings(target?.fields, "fields", (text, path) => {
      const urls = ctx.assets.findSourceUrls(text);
      if (urls.length > 0) leaked.set(path.replace(/^fields\./, ""), urls);
    });
    leaked.forEach((urls, path) => {
      findings.push({
        ...base,
        category: "sourceAssetUrlInTarget",
        severity: "failure",
        path,
        actual: urls,
        message: "Target content references an asset URL in the source instance",
      });
    });

    // A difference explained by the source item itself (a required field it lacks) is listed,
    // but does not fail the run.
    const defect = findings.length > 0 ? contentSourceDefect(source, ctx.source.modelsByRef) : undefined;
    findings.forEach((f) => {
      if (defect) {
        f.severity = "sourceDefect";
        f.message = f.message ? `${f.message} — ${defect}` : defect;
      }
      collector.add(f);
    });
    collector.count(locale, "content", findings.length === 0 ? "matched" : defect ? "known" : "mismatched");

    const sourceState = source?.properties?.state;
    const targetState = target?.properties?.state;
    if (sourceState !== undefined && targetState !== undefined && sourceState !== targetState) {
      collector.add({
        ...base,
        category: "publishStateDifference",
        severity: "warning",
        path: "state",
        expected: sourceState,
        actual: targetState,
      });
    }
  });

  if (!ctx.scoped) checkCounts(ctx, collector);
  checkListOrder(ctx, pairs, collector);
}

/** Target items whose every mapped source is absent from the source pull. */
function orphanedTargetIDs(ctx: VerifyContext): Set<number> {
  const out = new Set<number>();
  ctx.target.contentById.forEach((_item, targetID) => {
    const sources = ctx.localeMappings.content.sources(targetID);
    if (sources.length > 0 && !sources.some((s) => ctx.source.contentById.has(s))) out.add(targetID);
  });
  return out;
}

function countBy(items: Iterable<[number, any]>, key: (item: any) => string, skip: Set<number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, item] of Array.from(items)) {
    if (skip.has(id)) continue;
    const k = key(item);
    if (!k) continue;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

function checkCounts(ctx: VerifyContext, collector: FindingCollector): void {
  const { locale } = ctx;
  const orphaned = orphanedTargetIDs(ctx);
  const none = new Set<number>();

  const groups: Array<{
    entity: "container" | "model";
    key: (item: any) => string;
    translate: (name: string) => string;
  }> = [
    {
      entity: "container",
      key: (item) => lower(item?.properties?.referenceName),
      translate: (name) => ctx.mappings.containerNames.target(name) ?? name,
    },
    {
      entity: "model",
      key: (item) => lower(item?.properties?.definitionName),
      translate: (name) => ctx.mappings.modelNames.target(name) ?? name,
    },
  ];

  groups.forEach(({ entity, key, translate }) => {
    const sourceCounts = countBy(ctx.source.contentById.entries(), key, none);
    const targetCounts = countBy(ctx.target.contentById.entries(), key, orphaned);
    Array.from(sourceCounts.keys())
      .sort()
      .forEach((name) => {
        const expected = sourceCounts.get(name) as number;
        const targetName = translate(name);
        const actual = targetCounts.get(targetName) ?? 0;
        if (expected === actual) return;
        collector.add({
          category: "countMismatch",
          severity: actual < expected ? "failure" : "warning",
          entity,
          locale,
          name,
          path: "itemCount",
          expected,
          actual,
          message: `${entity === "container" ? "Container" : "Model"} "${name}" has ${expected} item(s) in the source and ${actual} on the target`,
        });
      });
  });
}

function itemOrder(item: any): number {
  const order = item?.properties?.itemOrder;
  return typeof order === "number" ? order : Number.MAX_SAFE_INTEGER;
}

function checkListOrder(ctx: VerifyContext, pairs: ComparablePair[], collector: FindingCollector): void {
  const { locale } = ctx;
  const bySourceContainer = new Map<string, ComparablePair[]>();
  pairs.forEach((pair) => {
    const name = lower(pair.source?.properties?.referenceName);
    if (!name) return;
    if (!bySourceContainer.has(name)) bySourceContainer.set(name, []);
    (bySourceContainer.get(name) as ComparablePair[]).push(pair);
  });

  Array.from(bySourceContainer.keys())
    .sort()
    .forEach((name) => {
      const group = bySourceContainer.get(name) as ComparablePair[];
      if (group.length < 2) return;
      const expectedContainer = ctx.mappings.containerNames.target(name) ?? name;
      // Only items that landed in the matching target container take part; a misplaced item is
      // already reported as contentContainerMismatch.
      const comparable = group.filter((p) => lower(p.target?.properties?.referenceName) === expectedContainer);
      if (comparable.length < 2) return;

      const expected = comparable
        .slice()
        .sort((a, b) => itemOrder(a.source) - itemOrder(b.source) || a.sourceID - b.sourceID);
      // Rank by the source's itemOrder value, so items that tie in the source may come in either
      // order on the target. Ties in the target's itemOrder are broken by that rank, so only a
      // real disagreement is reported.
      const sourceRank = new Map<number, number>();
      let rank = -1;
      let previous: number | undefined;
      expected.forEach((p) => {
        const order = itemOrder(p.source);
        if (order !== previous) rank++;
        previous = order;
        sourceRank.set(p.targetID, rank);
      });
      const rankOf = (p: ComparablePair) => sourceRank.get(p.targetID) as number;
      const actual = comparable
        .slice()
        .sort((a, b) => itemOrder(a.target) - itemOrder(b.target) || rankOf(a) - rankOf(b));

      if (actual.every((p, i) => i === 0 || rankOf(actual[i - 1]) <= rankOf(p))) return;
      const expectedIDs = expected.map((p) => p.targetID);
      const actualIDs = actual.map((p) => p.targetID);

      collector.add({
        category: "listOrderMismatch",
        severity: "failure",
        entity: "container",
        locale,
        name,
        path: "itemOrder",
        expected: expectedIDs,
        actual: actualIDs,
        message: "List items are in a different order on the target (target content IDs shown)",
      });
    });
}
