/**
 * Waiting for the batches a write creates. The Management API answers a save, publish or delete
 * with a batch ID before the work is done, and a failed item doesn't change the HTTP status, so a
 * write is only finished, and only known to have worked, once its batch is processed.
 *
 * Nothing here prints: progress would break stdout for `| jq`, and stderr is for warnings and
 * errors.
 */
import * as mgmtApi from "@agility/management-sdk";
import { CliError } from "../api-runtime/outcome";
import { ErrorEntry, ItemOutcome } from "../api-runtime/output";

export interface BatchWaitResult {
  /** True when every batch processed with no failed item. */
  ok: boolean;
  result: {
    batchIDs: number[];
    /** IDs of the items the batches saved or changed; for a new item, its new ID. */
    itemIDs: number[];
  };
  items: ItemOutcome[];
  errors: ErrorEntry[];
}

export interface WaitOptions {
  timeoutMs: number;
  intervalMs: number;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export const DEFAULT_WAIT: WaitOptions = {
  timeoutMs: 300000,
  intervalMs: 2000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

/** Batch IDs from a batched call: the SDK returns `[batchID]` for item calls and a number for batch calls. */
export function batchIDsOf(value: unknown): number[] {
  const list = Array.isArray(value) ? value : [value];
  const ids = list.map((v) => Number(v)).filter((n) => isFinite(n) && n > 0);
  if (ids.length === 0) throw new CliError("error", `The API didn't return a batch ID (got ${JSON.stringify(value)})`);
  return ids;
}

/** A batch item's errorMessage is often the server's JSON error (with a stack trace): keep its message. */
export function itemError(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed?.message === "string" ? parsed.message : raw;
  } catch {
    return raw;
  }
}

async function waitForOne(
  client: mgmtApi.ApiClient,
  guid: string,
  batchID: number,
  deadline: number,
  o: WaitOptions
): Promise<mgmtApi.Batch> {
  for (;;) {
    const batch = await client.batchMethods.getBatch(batchID, guid, true);
    if (batch.batchState === mgmtApi.BatchState.Processed) return batch;
    if (batch.batchState === mgmtApi.BatchState.Deleted) {
      throw new CliError("error", `Batch ${batchID} was deleted before it finished.`);
    }
    if (o.now() >= deadline) {
      throw new CliError(
        "error",
        `Batch ${batchID} is still processing after ${Math.round(o.timeoutMs / 1000)}s. ` +
          `It may still finish: check it with \`agility manage batch get ${batchID}\`.`
      );
    }
    await o.sleep(o.intervalMs);
  }
}

/** Wait for each batch in turn and report every item: saved, or failed with the batch's error. */
export async function waitForBatches(
  client: mgmtApi.ApiClient,
  guid: string,
  batchIDs: number[],
  opts: Partial<WaitOptions> = {}
): Promise<BatchWaitResult> {
  const o: WaitOptions = { ...DEFAULT_WAIT, ...opts };
  const deadline = o.now() + o.timeoutMs;
  const out: BatchWaitResult = { ok: true, result: { batchIDs, itemIDs: [] }, items: [], errors: [] };

  for (const batchID of batchIDs) {
    const batch = await waitForOne(client, guid, batchID, deadline, o);
    let failed: mgmtApi.BatchFailedItem[] = [];
    let batchError: string | null = null;
    try {
      mgmtApi.BatchFailedException.throwIfFailed(batch);
    } catch (err: any) {
      failed = Array.isArray(err?.failedItems) ? err.failedItems : [];
      batchError = err?.message || `Batch ${batchID} failed`;
    }

    const failedIDs = new Set(failed.map((f) => f.itemID));
    for (const item of batch.items || []) {
      const itemFailed = failedIDs.has(item.itemID) || !!item.errorMessage;
      out.items.push({
        batchID,
        itemID: item.itemID,
        itemType: item.itemTypeName,
        ...(item.languageCode ? { locale: item.languageCode } : {}),
        status: itemFailed ? "error" : "ok",
        ...(itemFailed
          ? {
              message:
                failed.find((f) => f.itemID === item.itemID)?.errorMessage ||
                itemError(item.errorMessage) ||
                batchError ||
                "",
            }
          : {}),
      });
      if (!itemFailed && item.itemID > 0) out.result.itemIDs.push(item.itemID);
    }

    if (batchError) {
      out.ok = false;
      if (failed.length === 0) {
        // The batch failed without naming an item.
        out.errors.push({ status: "error", message: batchError, batchID });
      } else {
        for (const f of failed) {
          out.errors.push({
            status: "error",
            message: `${f.itemType || "Item"} ${f.itemID}: ${f.errorMessage}`,
            batchID,
            itemID: f.itemID,
          });
        }
      }
    }
  }
  return out;
}
