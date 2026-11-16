/**
 * PROD-3164: source pages the page phase left alone on the target this run, because the target page
 * changed since the last sync (a kept target change or a conflict). Page order must not move them
 * either: a move made on the target gives the page a new version, so this is also how a target-only
 * move is kept. A page's place is shared by all locales, so held in one locale is held in all.
 */
const heldSourcePageIDs = new Set<number>();

export function recordHeldPage(sourcePageID: number): void {
  if (sourcePageID > 0) heldSourcePageIDs.add(sourcePageID);
}

export function isHeldPage(sourcePageID: number): boolean {
  return heldSourcePageIDs.has(sourcePageID);
}

export function resetHeldPages(): void {
  heldSourcePageIDs.clear();
}
