/**
 * Page checks for one locale (PROD-2552) — page fields, and the components in each zone.
 *
 * The defect this exists for: a sync reported success while the components on a page were in the
 * wrong order. So zones are compared component by component, in order, and a zone is never paired
 * by position:
 *
 *   source zone → target zone via the template section-ID mapping (PROD-2350), else by an exact
 *   (case-insensitive) zone name, else `unmappedZone`. Two templates that define their zones in a
 *   different order still pair correctly; a zone that cannot be paired is reported, not guessed.
 *
 * Each zone is then compared as an ordered list of (module, target content ID):
 *  - missingComponent       expected in this zone, not on the target page at all
 *  - extraComponent         on the target zone, not expected anywhere on the page
 *  - componentInWrongZone   expected in one zone, found in another
 *  - componentOrderMismatch the shared components are in a different order (both sequences shown)
 * A module whose content item is absent from the source pull cannot be migrated: it is listed as
 * a sourceDefect and left out of the expectation.
 *
 * Page fields compared: title, menuText, name, pageType, template (through the template mapping),
 * redirectUrl, visible, seo, scripts, securePage. A different workflow state is a warning
 * (publishStateDifference), as for content.
 */
import { Finding, FindingCollector } from "./verify-report";
import { ComparablePair } from "./check-mapping-integrity";
import { moduleContentID, sourceCanonicalContext, targetCanonicalContext, VerifyContext } from "./verify-context";
import { canonicalEquals, canonicalValue, describeDifference } from "./canonicalize";

function lower(value: any): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export const COMPARED_PAGE_FIELDS = [
  "title",
  "menuText",
  "name",
  "pageType",
  "redirectUrl",
  "visible",
  "seo",
  "scripts",
  "securePage",
] as const;

interface ZoneEntry {
  key: string;
  label: string;
}

function sections(template: any): any[] {
  return Array.isArray(template?.contentSectionDefinitions) ? template.contentSectionDefinitions : [];
}

/** The target template a source page should be on, by name (lower-case). */
export function expectedTemplateName(ctx: VerifyContext, sourceTemplateName: any): string {
  const name = lower(sourceTemplateName);
  if (!name) return "";
  const byName = ctx.mappings.templateNames.target(name);
  if (byName) return byName;
  const sourceTemplate = ctx.source.templatesByName.get(name);
  const targetID = sourceTemplate ? ctx.mappings.templates.target(sourceTemplate.pageTemplateID) : undefined;
  const targetTemplate = targetID !== undefined ? ctx.target.templatesById.get(targetID) : undefined;
  return targetTemplate ? lower(targetTemplate.pageTemplateName) : name;
}

/**
 * Pair a source zone with a target zone. Section-ID mapping first, then an exact name; never by
 * position. Returns the lower-cased target zone name, or undefined when there is no pairing.
 */
export function resolveTargetZone(
  ctx: VerifyContext,
  sourceZone: string,
  sourceTemplate: any,
  targetTemplate: any,
  targetZoneNames: string[]
): string | undefined {
  const zone = lower(sourceZone);
  const sourceSection = sections(sourceTemplate).find((s) => lower(s?.pageItemTemplateReferenceName) === zone);
  if (sourceSection?.pageItemTemplateID != null) {
    const targetSectionID = ctx.mappings.sections.target(sourceSection.pageItemTemplateID);
    if (targetSectionID !== undefined) {
      const targetSection = sections(targetTemplate).find((s) => s?.pageItemTemplateID === targetSectionID);
      if (targetSection?.pageItemTemplateReferenceName) return lower(targetSection.pageItemTemplateReferenceName);
    }
  }
  const candidates = new Set<string>([
    ...sections(targetTemplate).map((s) => lower(s?.pageItemTemplateReferenceName)),
    ...targetZoneNames.map(lower),
  ]);
  return candidates.has(zone) ? zone : undefined;
}

export function checkPages(ctx: VerifyContext, pairs: ComparablePair[], collector: FindingCollector): void {
  pairs.forEach((pair) => {
    checkPageFields(ctx, pair, collector);
    checkPageZones(ctx, pair, collector);
  });
}

function checkPageFields(ctx: VerifyContext, pair: ComparablePair, collector: FindingCollector): void {
  const { locale } = ctx;
  const { sourceID, targetID, source, target } = pair;
  const sourceCtx = sourceCanonicalContext(ctx);
  const targetCtx = targetCanonicalContext(ctx);
  let differs = false;

  const report = (path: string, expected: any, actual: any) => {
    differs = true;
    collector.add({
      category: "pageFieldMismatch",
      severity: "failure",
      entity: "page",
      locale,
      sourceID,
      targetID,
      name: source?.name,
      path,
      ...describeDifference(expected, actual),
    });
  };

  COMPARED_PAGE_FIELDS.forEach((field) => {
    const expected = canonicalValue(source?.[field], sourceCtx);
    const actual = canonicalValue(target?.[field], targetCtx);
    if (!canonicalEquals(expected, actual)) report(field, expected, actual);
  });

  const expectedTemplate = expectedTemplateName(ctx, source?.templateName);
  const actualTemplate = lower(target?.templateName);
  if (expectedTemplate !== actualTemplate) report("template", expectedTemplate || null, actualTemplate || null);

  collector.count(locale, "page", differs ? "mismatched" : "matched");

  const sourceState = source?.properties?.state;
  const targetState = target?.properties?.state;
  if (sourceState !== undefined && targetState !== undefined && sourceState !== targetState) {
    collector.add({
      category: "publishStateDifference",
      severity: "warning",
      entity: "page",
      locale,
      sourceID,
      targetID,
      name: source?.name,
      path: "state",
      expected: sourceState,
      actual: targetState,
    });
  }
}

function moduleLabel(moduleName: string, id: string): string {
  return `${moduleName}#${id}`;
}

function checkPageZones(ctx: VerifyContext, pair: ComparablePair, collector: FindingCollector): void {
  const { locale } = ctx;
  const { sourceID, targetID, source, target } = pair;
  const base = { entity: "zone" as const, locale, sourceID, targetID, name: source?.name };

  const sourceTemplate = ctx.source.templatesByName.get(lower(source?.templateName));
  const targetTemplate = ctx.target.templatesByName.get(lower(target?.templateName));
  const targetZones: Record<string, any[]> = {};
  Object.keys(target?.zones || {}).forEach((zone) => {
    targetZones[lower(zone)] = Array.isArray(target.zones[zone]) ? target.zones[zone] : [];
  });

  const expectedByZone = new Map<string, ZoneEntry[]>();
  const unmappedKeys = new Set<string>();
  const findings: Finding[] = [];
  const zoneOf = new Map<Finding, string>();
  const add = (zone: string, finding: Finding) => {
    findings.push(finding);
    zoneOf.set(finding, zone);
  };

  Object.keys(source?.zones || {}).forEach((sourceZone) => {
    const modules = Array.isArray(source.zones[sourceZone]) ? source.zones[sourceZone] : [];
    const entries: ZoneEntry[] = [];
    modules.forEach((module: any) => {
      const moduleName = ctx.mappings.modelNames.target(lower(module?.module)) ?? lower(module?.module);
      const contentID = moduleContentID(module);
      if (contentID !== undefined && !ctx.source.contentById.has(contentID)) {
        add(lower(sourceZone), {
          ...base,
          category: "moduleContentMissingInSource",
          severity: "sourceDefect",
          path: sourceZone,
          expected: moduleLabel(lower(module?.module), `source:${contentID}`),
          message: `Module ${module?.module} references source content ${contentID}, which is not in the source pull`,
        });
        return;
      }
      const mapped = contentID === undefined ? undefined : ctx.localeMappings.content.target(contentID);
      const id = contentID === undefined ? "none" : mapped !== undefined ? String(mapped) : `unmapped:${contentID}`;
      entries.push({ key: `${moduleName}|${id}`, label: moduleLabel(moduleName, id) });
    });

    const targetZone = resolveTargetZone(ctx, sourceZone, sourceTemplate, targetTemplate, Object.keys(targetZones));
    if (!targetZone) {
      if (entries.length === 0) return;
      entries.forEach((e) => unmappedKeys.add(e.key));
      add(lower(sourceZone), {
        ...base,
        category: "unmappedZone",
        severity: "failure",
        path: sourceZone,
        expected: entries.map((e) => e.label),
        message: `Source zone "${sourceZone}" has no counterpart on the target template (no section mapping, no zone of that name)`,
      });
      return;
    }
    expectedByZone.set(targetZone, [...(expectedByZone.get(targetZone) ?? []), ...entries]);
  });

  const actualByZone = new Map<string, ZoneEntry[]>();
  Object.keys(targetZones).forEach((zone) => {
    actualByZone.set(
      zone,
      targetZones[zone].map((module: any) => {
        const moduleName = lower(module?.module);
        const contentID = moduleContentID(module);
        const id = contentID === undefined ? "none" : String(contentID);
        return { key: `${moduleName}|${id}`, label: moduleLabel(moduleName, id) };
      })
    );
  });

  // Pass 1: match within the paired zone.
  const zones = Array.from(new Set([...Array.from(expectedByZone.keys()), ...Array.from(actualByZone.keys())])).sort();
  const leftoverExpected = new Map<string, ZoneEntry[]>();
  const leftoverActual = new Map<string, Map<string, number>>();
  const matchedInZone = new Map<string, Map<string, number>>();
  zones.forEach((zone) => {
    const expected = expectedByZone.get(zone) ?? [];
    const available = new Map<string, number>();
    (actualByZone.get(zone) ?? []).forEach((e) => available.set(e.key, (available.get(e.key) ?? 0) + 1));
    const leftovers: ZoneEntry[] = [];
    const matched = new Map<string, number>();
    expected.forEach((e) => {
      const count = available.get(e.key) ?? 0;
      if (count > 0) {
        available.set(e.key, count - 1);
        matched.set(e.key, (matched.get(e.key) ?? 0) + 1);
      } else {
        leftovers.push(e);
      }
    });
    leftoverExpected.set(zone, leftovers);
    leftoverActual.set(zone, available);
    matchedInZone.set(zone, matched);
  });

  // Pass 2: an expected component found in a different target zone is in the wrong zone.
  zones.forEach((zone) => {
    (leftoverExpected.get(zone) ?? []).forEach((e) => {
      const otherZone = zones.find((z) => z !== zone && (leftoverActual.get(z)?.get(e.key) ?? 0) > 0);
      if (otherZone) {
        const available = leftoverActual.get(otherZone) as Map<string, number>;
        available.set(e.key, (available.get(e.key) as number) - 1);
        add(zone, {
          ...base,
          category: "componentInWrongZone",
          severity: "failure",
          path: zone,
          expected: `${e.label} in ${zone}`,
          actual: `${e.label} in ${otherZone}`,
        });
      } else {
        add(zone, {
          ...base,
          category: "missingComponent",
          severity: "failure",
          path: zone,
          expected: e.label,
          actual: (actualByZone.get(zone) ?? []).map((a) => a.label),
        });
      }
    });
  });

  // Pass 3: whatever is left on the target was not expected anywhere.
  zones.forEach((zone) => {
    const available = leftoverActual.get(zone) as Map<string, number>;
    (actualByZone.get(zone) ?? []).forEach((e) => {
      const count = available.get(e.key) ?? 0;
      if (count <= 0) return;
      available.set(e.key, count - 1);
      if (unmappedKeys.has(e.key)) return; // explained by the unmappedZone finding
      add(zone, {
        ...base,
        category: "extraComponent",
        severity: "failure",
        path: zone,
        actual: e.label,
        expected: (expectedByZone.get(zone) ?? []).map((x) => x.label),
      });
    });
  });

  // Order: compare the components the two sides share in this zone. Each side contributes only as
  // many occurrences of a component as were matched, so a duplicate (already an extraComponent)
  // does not also read as an order change.
  const shared = (entries: ZoneEntry[], matched: Map<string, number>): string[] => {
    const remaining = new Map(matched);
    const keys: string[] = [];
    entries.forEach((e) => {
      const left = remaining.get(e.key) ?? 0;
      if (left <= 0) return;
      remaining.set(e.key, left - 1);
      keys.push(e.key);
    });
    return keys;
  };
  zones.forEach((zone) => {
    const matched = matchedInZone.get(zone) as Map<string, number>;
    const expectedKeys = shared(expectedByZone.get(zone) ?? [], matched);
    if (expectedKeys.length < 2) return;
    const actualKeys = shared(actualByZone.get(zone) ?? [], matched);
    if (expectedKeys.every((k, i) => k === actualKeys[i])) return;
    add(zone, {
      ...base,
      category: "componentOrderMismatch",
      severity: "failure",
      path: zone,
      expected: (expectedByZone.get(zone) ?? []).map((e) => e.label),
      actual: (actualByZone.get(zone) ?? []).map((e) => e.label),
      message: "Components are in a different order on the target",
    });
  });

  findings.forEach((f) => collector.add(f));

  const outcomeZones = new Set<string>([...zones, ...Array.from(zoneOf.values())]);
  outcomeZones.forEach((zone) => {
    const zoneFindings = findings.filter((f) => zoneOf.get(f) === zone);
    const hasEntries = (expectedByZone.get(zone)?.length ?? 0) > 0 || (actualByZone.get(zone)?.length ?? 0) > 0;
    if (!hasEntries && zoneFindings.length === 0) return;
    collector.count(locale, "zone", "checked");
    if (zoneFindings.some((f) => f.severity === "failure")) collector.count(locale, "zone", "mismatched");
    else if (zoneFindings.length > 0) collector.count(locale, "zone", "known");
    else collector.count(locale, "zone", "matched");
  });
}
