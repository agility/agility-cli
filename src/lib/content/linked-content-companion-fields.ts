import * as mgmtApi from "@agility/management-sdk";

/**
 * A Content-typed dropdown/checkbox/searchlistbox field's actual selection, and a full-list
 * "grid" field's custom sort order, live in a companion field separate from the one the designer
 * sees — named by that field's own model setting (`LinkeContentDropdownValueField` or
 * `SortIDFieldName` respectively). Neither has a fixed naming convention (PROD-2431/2435/2442
 * sampled a real target schema: only 4 of 14 dropdown fields used the `<field>_ValueField`
 * suffix), so the model schema is the only reliable source for the real name.
 *
 * Shared by ContentFieldMapper (which remaps the companion's value) and the content-pusher
 * utilities that scan a content item's fields for references (which need to recognize the
 * companion as carrying a reference at all) — every consumer of this pattern should read it from
 * here rather than re-deriving its own naming heuristic.
 */
export function getLinkedContentCompanionFields(
  model?: mgmtApi.Model | { fields?: mgmtApi.ModelField[] | any[] } | null
): Array<[mainFieldName: string, companionFieldName: string]> {
  const modelFields = model?.fields;
  if (!Array.isArray(modelFields)) return [];

  const pairs: Array<[string, string]> = [];
  for (const field of modelFields) {
    const companionFieldName: string | undefined =
      field?.settings?.LinkeContentDropdownValueField || field?.settings?.SortIDFieldName;
    if (field?.name && companionFieldName) {
      pairs.push([field.name, companionFieldName]);
    }
  }
  return pairs;
}

/**
 * Look up a field by name in a fields object, case-insensitively — the model schema's field name
 * and the payload's actual field key can differ in casing (e.g. schema "LinkedContentValue" vs. a
 * payload key camelCased to "linkedContentValue").
 */
export function findFieldKey(fields: any, fieldName: string): string | undefined {
  if (!fields || typeof fields !== "object") return undefined;
  if (fieldName in fields) return fieldName;
  const lowerTarget = fieldName.toLowerCase();
  return Object.keys(fields).find((key) => key.toLowerCase() === lowerTarget);
}
