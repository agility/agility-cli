/**
 * Structural checks (PROD-2552): models, containers and templates.
 *
 * Compared on what defines their shape, never on IDs, dates or who modified them:
 *  - model:     reference name, and the ordered list of fields as (name, type)
 *  - container: reference name, and the model it holds (through the model mapping)
 *  - template:  the ordered list of zone (section) reference names
 * Assets and galleries are only checked for presence (mapping integrity); a matched pair counts
 * as matched.
 */
import { FindingCollector, INSTANCE_LOCALE } from "./verify-report";
import { InstanceIntegrityResult } from "./check-mapping-integrity";
import { VerifyContext } from "./verify-context";
import { canonicalEquals } from "./canonicalize";

function lower(value: any): string {
  return typeof value === "string" ? value.toLowerCase() : "";
}

export function modelFieldSignature(model: any): string[] {
  return (Array.isArray(model?.fields) ? model.fields : []).map((f: any) => `${lower(f?.name)}:${lower(f?.type)}`);
}

export function templateSectionSignature(template: any): string[] {
  return (Array.isArray(template?.contentSectionDefinitions) ? template.contentSectionDefinitions : [])
    .slice()
    .sort((a: any, b: any) => (a?.itemOrder ?? 0) - (b?.itemOrder ?? 0))
    .map((s: any) => lower(s?.pageItemTemplateReferenceName));
}

export function checkStructure(ctx: VerifyContext, pairs: InstanceIntegrityResult, collector: FindingCollector): void {
  const locale = INSTANCE_LOCALE;

  pairs.models.forEach(({ sourceID, targetID, source, target }) => {
    let differs = false;
    if (lower(source.referenceName) !== lower(target.referenceName)) {
      differs = true;
      collector.add({
        category: "modelMismatch",
        severity: "failure",
        entity: "model",
        locale,
        sourceID,
        targetID,
        name: source.referenceName,
        path: "referenceName",
        expected: source.referenceName,
        actual: target.referenceName,
      });
    }
    const expected = modelFieldSignature(source);
    const actual = modelFieldSignature(target);
    if (!canonicalEquals(expected, actual)) {
      differs = true;
      collector.add({
        category: "modelMismatch",
        severity: "failure",
        entity: "model",
        locale,
        sourceID,
        targetID,
        name: source.referenceName,
        path: "fields",
        expected,
        actual,
        message: "Model fields differ (name:type, in order)",
      });
    }
    collector.count(locale, "model", differs ? "mismatched" : "matched");
  });

  pairs.containers.forEach(({ sourceID, targetID, source, target }) => {
    let differs = false;
    if (lower(source.referenceName) !== lower(target.referenceName)) {
      differs = true;
      collector.add({
        category: "containerMismatch",
        severity: "failure",
        entity: "container",
        locale,
        sourceID,
        targetID,
        name: source.referenceName,
        path: "referenceName",
        expected: source.referenceName,
        actual: target.referenceName,
      });
    }
    const expectedModelID = ctx.mappings.models.target(source.contentDefinitionID);
    if (expectedModelID === undefined || expectedModelID !== target.contentDefinitionID) {
      differs = true;
      const sourceModel = ctx.source.modelsById.get(source.contentDefinitionID);
      const targetModel = ctx.target.modelsById.get(target.contentDefinitionID);
      collector.add({
        category: "containerMismatch",
        severity: "failure",
        entity: "container",
        locale,
        sourceID,
        targetID,
        name: source.referenceName,
        path: "model",
        expected:
          expectedModelID === undefined
            ? `unmapped model ${sourceModel?.referenceName ?? source.contentDefinitionID}`
            : `${sourceModel?.referenceName ?? "?"} (#${expectedModelID})`,
        actual: `${targetModel?.referenceName ?? "?"} (#${target.contentDefinitionID})`,
        message: "Container holds a different model on the target",
      });
    }
    collector.count(locale, "container", differs ? "mismatched" : "matched");
  });

  pairs.templates.forEach(({ sourceID, targetID, source, target }) => {
    const expected = templateSectionSignature(source);
    const actual = templateSectionSignature(target);
    const differs = !canonicalEquals(expected, actual);
    if (differs) {
      collector.add({
        category: "templateMismatch",
        severity: "failure",
        entity: "template",
        locale,
        sourceID,
        targetID,
        name: source.pageTemplateName,
        path: "sections",
        expected,
        actual,
        message: "Template zones differ (reference name, in order)",
      });
    }
    collector.count(locale, "template", differs ? "mismatched" : "matched");
  });

  pairs.assets.forEach(() => collector.count(locale, "asset", "matched"));
  pairs.galleries.forEach(() => collector.count(locale, "gallery", "matched"));
}
