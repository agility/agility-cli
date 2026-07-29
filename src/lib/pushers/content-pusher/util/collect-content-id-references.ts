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
 */
export function collectContentIDReferences(fields: any): number[] {
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
  return found;
}
