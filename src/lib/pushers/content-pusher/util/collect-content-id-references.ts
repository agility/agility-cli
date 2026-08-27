import { getLinkedContentCompanionFields, findFieldKey } from "lib/content/linked-content-companion-fields";

/**
 * Recursively walks content item fields to find SINGLE-ITEM content references —
 * `contentid`/`contentID` values and comma-separated `sortids` — and returns the
 * referenced source contentIDs.
 *
 * This complements collectListReferenceNames, which only finds WHOLE-LIST references
 * (a `referencename` paired with `fulllist:true`). A single-item linked-content field
 * stores `{ contentid: N, fulllist: false }` with no `referencename`, so it is invisible
 * to the list-reference collector — which is why the item it points at was never treated
 * as a push-order dependency (PROD-2341).
 *
 * Only positive IDs are returned; 0 / -1 mean "no reference selected" and are ignored so
 * we don't promote items with intentionally-empty linked-content fields. This matches the
 * `> 0` guard used by collectUnresolvedContentReferences.
 *
 * PROD-2446: a Content-typed dropdown/checkbox/grid field's reference can live ONLY in a
 * companion field (named by the model's LinkeContentDropdownValueField/SortIDFieldName setting —
 * see PROD-2431/2435/2442), invisible to the structural walk above since it's a bare string under
 * an arbitrary key. Pass `model` so an item that depends on another item solely through such a
 * companion field is still recognized as a dependency and promoted to push first.
 */
export function collectContentIDReferences(fields: any, model?: any): number[] {
  const found: number[] = [];

  function walk(node: any): void {
    if (!node) return;

    if (Array.isArray(node)) {
      for (const v of node) walk(v);
      return;
    }

    if (typeof node === "object") {
      for (const key of Object.keys(node)) {
        const value = (node as any)[key];

        // Direct single-item reference (contentid / contentID)
        if ((key === "contentid" || key === "contentID") && typeof value === "number") {
          if (value > 0) found.push(value);
          continue;
        }

        // Comma-separated content IDs in a sortids field
        if (key === "sortids" && typeof value === "string") {
          for (const part of value.split(",")) {
            const id = parseInt(part.trim());
            if (!isNaN(id) && id > 0) found.push(id);
          }
          continue;
        }

        // Recurse into nested objects/arrays
        walk(value);
      }
    }
  }

  walk(fields);

  // Companion fields are top-level siblings of the main field, not nested inside it.
  for (const [, companionFieldName] of getLinkedContentCompanionFields(model)) {
    const companionKey = findFieldKey(fields, companionFieldName);
    if (!companionKey) continue;

    const companionValue = fields[companionKey];
    if (typeof companionValue !== "string" || !companionValue.trim()) continue;

    for (const part of companionValue.split(",")) {
      const id = parseInt(part.trim());
      if (!isNaN(id) && id > 0) found.push(id);
    }
  }

  return found;
}
