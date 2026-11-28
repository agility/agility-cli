import * as fs from "fs";
import * as path from "path";
import * as mgmtApi from "@agility/management-sdk";
import { fileOperations } from "../../core/fileOperations";
import { getDeferredModelDisables, registerDeferredModelDisable, state } from "../../core/state";

/**
 * PROD-2914: models a sync created whose source is disabled (`isVisible: false`).
 *
 * They're created enabled, so the run's own pages can place them, and disabled once the pages are
 * in (the component availability phase). If the run stops before that phase (an error, Ctrl-C), a
 * list kept only in memory would be lost, and later runs never send `isVisible` for a model that
 * already exists, so the model would stay enabled for good. So each one is also written to
 * `mappings/{pair}/models/pending-disables.json` and removed once it's disabled.
 *
 * Entries carry the run's source GUID: the mapping folder is shared by both directions of a pair,
 * and a source model ID only means something for the instance it came from.
 */

interface PendingDisable {
  sourceGuid: string;
  sourceModelID: number;
}

const FILE_NAME = "pending-disables.json";

function filePath(): string | null {
  const { sourceGuid, targetGuid } = state;
  if (!sourceGuid || !targetGuid) return null;
  const fileOps = new fileOperations(targetGuid);
  return path.join(fileOps.getMappingFilePath(sourceGuid, targetGuid), "models", FILE_NAME);
}

function readAll(): PendingDisable[] {
  const file = filePath();
  if (!file || !fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(data) ? data.filter((e) => e && typeof e.sourceModelID === "number") : [];
  } catch {
    return [];
  }
}

function writeAll(entries: PendingDisable[]): void {
  const file = filePath();
  if (!file || state.preflight) return;
  if (entries.length === 0) {
    if (fs.existsSync(file)) fs.rmSync(file);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(entries, null, 2));
}

/** Record a model created this run (or planned, in preflight) that's disabled on the source. */
export function registerPendingModelDisable(sourceModelID: number): void {
  if (sourceModelID == null) return;
  registerDeferredModelDisable(sourceModelID);
  const entries = readAll();
  if (!entries.some((e) => e.sourceGuid === state.sourceGuid && e.sourceModelID === sourceModelID)) {
    writeAll([...entries, { sourceGuid: state.sourceGuid, sourceModelID }]);
  }
}

/** Source IDs to disable: this run's, plus any an earlier run created but never got to disable. */
export function getPendingModelDisables(): number[] {
  const fromEarlierRuns = readAll()
    .filter((e) => e.sourceGuid === state.sourceGuid)
    .map((e) => e.sourceModelID);
  return Array.from(new Set([...getDeferredModelDisables(), ...fromEarlierRuns]));
}

/** Forget a model once it's disabled (or no longer needs it). */
export function resolvePendingModelDisable(sourceModelID: number): void {
  state.deferredModelDisables.delete(sourceModelID);
  const entries = readAll();
  const rest = entries.filter((e) => !(e.sourceGuid === state.sourceGuid && e.sourceModelID === sourceModelID));
  if (rest.length !== entries.length) writeAll(rest);
}

/**
 * Disable (or enable) a model through `POST model/{id}/visibility`, which changes only `isVisible`.
 * A model save can't do it: the API honours `isVisible` only when a save creates the model.
 */
export async function saveModelVisibility(
  apiClient: mgmtApi.ApiClient,
  modelID: number,
  isVisible: boolean,
  guid: string
): Promise<void> {
  const methods: any = apiClient.modelMethods;
  if (typeof methods.saveModelVisibility === "function") {
    await methods.saveModelVisibility(modelID, isVisible, guid);
    return;
  }
  const client = methods._clientInstance;
  const token = methods._options?.token;
  if (!client || typeof client.executePost !== "function") {
    throw Object.assign(new Error("This SDK build can't change a model's visibility."), { statusCode: 405 });
  }
  await client.executePost(`model/${modelID}/visibility`, guid, token, { isVisible });
}

const visibilitySupport = new Map<string, Promise<boolean>>();

/** Forget the per-instance answers (start of each push, and tests). */
export function resetVisibilitySupport(): void {
  visibilitySupport.clear();
}

/**
 * Whether the target serves `POST model/{id}/visibility`, asked once per instance per run with model
 * 0, which never exists, so nothing changes either way: an API with the route answers 404 with its
 * own "not found" message (or 400), an API without it answers an empty 404, the framework's
 * unmatched-route 404, or 405.
 *
 * Without the route, a model the sync creates takes the source's `isVisible` on create (as before
 * PROD-2914), because nothing could disable it afterwards.
 */
export function targetSupportsModelVisibility(apiClient: mgmtApi.ApiClient, guid: string): Promise<boolean> {
  if (!visibilitySupport.has(guid)) {
    visibilitySupport.set(
      guid,
      saveModelVisibility(apiClient, 0, true, guid).then(
        () => true,
        (error: any) => {
          const status = error?.statusCode ?? error?.response?.status ?? error?.innerError?.response?.status;
          if (status === 400) return true;
          if (status !== 404) return false;
          const data = error?.responseData ?? error?.response?.data ?? error?.innerError?.response?.data;
          const text = typeof data === "string" ? data : JSON.stringify(data ?? "");
          return text.trim().length > 2 && !/No HTTP resource was found|<html/i.test(text);
        }
      )
    );
  }
  return visibilitySupport.get(guid)!;
}
