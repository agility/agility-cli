/**
 * PROD-2306: Detect when a content item references a linked list / linked container
 * that has been DELETED in the source instance.
 *
 * Background: when a source linked list is deleted, the pull removes its container
 * file (see download-containers.ts, which unlinks containers no longer returned by
 * the source). The linked-list reference, however, still lives on any content item
 * that pointed at it. The CLI (correctly) will not recreate a deleted container on
 * the target, so the create fails and the Management API surfaces a misleading
 * "Cannot create this item <name> does not exist" verbatim.
 *
 * These helpers let us proactively identify the deleted reference so we can emit a
 * clear, actionable message instead of relying on / string-matching the server text.
 */

/**
 * Recursively collect every linked-list / linked-container reference name found in a
 * content item's fields. A linked-list field value carries a `referencename`
 * (or `referenceName`) pointing at the container it links to.
 */
export function collectAllReferenceNames(fields: any): string[] {
  const found = new Set<string>();

  function walk(node: any): void {
    if (!node) return;

    if (Array.isArray(node)) {
      for (const v of node) walk(v);
      return;
    }

    if (typeof node === "object") {
      const rn = (node as any).referencename ?? (node as any).referenceName;
      if (typeof rn === "string" && rn.length > 0) {
        found.add(rn);
      }
      for (const key of Object.keys(node)) {
        walk((node as any)[key]);
      }
    }
  }

  walk(fields);
  return Array.from(found);
}

/**
 * Given a content item's fields and the set of linked-list/container reference names
 * that still exist in the source (lower-cased), return the referenced names that are
 * NOT present in the source — i.e. linked lists that were deleted in the source.
 */
export function findDeletedLinkedListReferences(fields: any, liveSourceContainerRefNames: Set<string>): string[] {
  return collectAllReferenceNames(fields).filter((rn) => !liveSourceContainerRefNames.has(rn.toLowerCase()));
}

/**
 * Build the clear, actionable error message for an item that failed because it
 * references a deleted linked list. Keeps the original server error appended for
 * triage context.
 */
export function buildDeletedLinkedListMessage(
  itemReferenceName: string,
  deletedRefNames: string[],
  originalError: string
): string {
  const names = deletedRefNames.map((n) => `'${n}'`).join(", ");
  const subject = deletedRefNames.length > 1 ? `deleted linked lists ${names}` : `a deleted linked list ${names}`;
  return (
    `Content item '${itemReferenceName}' references ${subject} — ` +
    `clear the stale reference in the source or restore the list. ` +
    `(original error: ${originalError})`
  );
}
