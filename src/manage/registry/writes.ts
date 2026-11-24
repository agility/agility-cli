/**
 * Every registry entry that changes data. Kept in one file so a reviewer can see all of them at
 * once. The runner adds the guards: --dry-run, confirmation (--yes), the audit log, and waiting
 * for batches.
 *
 * Batched SDK methods are always called with returnBatchId = true; the runner does the waiting.
 * Values that the SDK puts in a query string go through q(), because the SDK doesn't encode them
 * and sends an omitted one as the text "undefined" or "null".
 */
import * as fs from "fs";
import * as path from "path";
import FormData from "form-data";
import * as mgmtApi from "@agility/management-sdk";
import { CliError, statusOf } from "../../api-runtime/outcome";
import { Endpoint, flag, pos, q, ResolvedArgs } from "../types";

const DATA = (what: string) => flag("data", "json", `${what} as JSON, @file.json, or - for stdin`, { required: true });
const COMMENTS = flag("comments", "string", "Comment recorded with the workflow action");

const WORKFLOW_OPERATIONS: Record<string, mgmtApi.WorkflowOperationType> = {
  publish: mgmtApi.WorkflowOperationType.Publish,
  unpublish: mgmtApi.WorkflowOperationType.Unpublish,
  approve: mgmtApi.WorkflowOperationType.Approve,
  decline: mgmtApi.WorkflowOperationType.Decline,
  "request-approval": mgmtApi.WorkflowOperationType.RequestApproval,
};

function asList<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * Warn when an item about to be saved has changed on the server since it was read. Content and
 * page saves are last-write-wins (the API makes no concurrency check), so this is only a warning.
 * Items without an ID (new) or without a versionID are skipped, as is an item the read can't find.
 */
export async function versionWarnings(
  items: any[],
  idOf: (item: any) => number,
  current: (id: number) => Promise<any>,
  label: string
): Promise<string[]> {
  const warnings: string[] = [];
  const toCheck = items.filter((i) => idOf(i) > 0 && Number(i?.properties?.versionID) > 0);
  const CONCURRENCY = 5;
  for (let start = 0; start < toCheck.length; start += CONCURRENCY) {
    await Promise.all(
      toCheck.slice(start, start + CONCURRENCY).map(async (item) => {
        const id = idOf(item);
        let now: any;
        try {
          now = await current(id);
        } catch {
          return;
        }
        const given = Number(item.properties.versionID);
        const latest = Number(now?.properties?.versionID);
        if (latest > 0 && latest !== given) {
          warnings.push(
            `${label} ${id} changed since it was read (versionID ${given}, now ${latest}). Saving anyway: the last write wins.`
          );
        }
      })
    );
  }
  return warnings;
}

type WorkflowMethod = "publish" | "unPublish" | "requestApproval" | "approve" | "decline" | "delete";

const ITEM_WORKFLOW: { action: string; describe: string; method: WorkflowMethod }[] = [
  { action: "publish", describe: "Publish", method: "publish" },
  { action: "unpublish", describe: "Unpublish", method: "unPublish" },
  { action: "request-approval", describe: "Request approval for", method: "requestApproval" },
  { action: "approve", describe: "Approve", method: "approve" },
  { action: "decline", describe: "Decline", method: "decline" },
  { action: "delete", describe: "Delete", method: "delete" },
];

function contentWorkflowCall(method: WorkflowMethod) {
  return (c: mgmtApi.ApiClient, a: ResolvedArgs) => {
    const m = c.contentMethods;
    const args: [number, string, string, string, boolean] = [a.id, a.guid, a.locale!, q(a.comments), true];
    switch (method) {
      case "publish":
        return m.publishContent(...args);
      case "unPublish":
        return m.unPublishContent(...args);
      case "requestApproval":
        return m.contentRequestApproval(...args);
      case "approve":
        return m.approveContent(...args);
      case "decline":
        return m.declineContent(...args);
      case "delete":
        return m.deleteContent(...args);
    }
  };
}

function pageWorkflowCall(method: WorkflowMethod) {
  return (c: mgmtApi.ApiClient, a: ResolvedArgs) => {
    const m = c.pageMethods;
    const args: [number, string, string, string, boolean] = [a.id, a.guid, a.locale!, q(a.comments), true];
    switch (method) {
      case "publish":
        return m.publishPage(...args);
      case "unPublish":
        return m.unPublishPage(...args);
      case "requestApproval":
        return m.pageRequestApproval(...args);
      case "approve":
        return m.approvePage(...args);
      case "decline":
        return m.declinePage(...args);
      case "delete":
        return m.deletePage(...args);
    }
  };
}

const CONTENT_SDK: Record<WorkflowMethod, string> = {
  publish: "contentMethods.publishContent",
  unPublish: "contentMethods.unPublishContent",
  requestApproval: "contentMethods.contentRequestApproval",
  approve: "contentMethods.approveContent",
  decline: "contentMethods.declineContent",
  delete: "contentMethods.deleteContent",
};

const PAGE_SDK: Record<WorkflowMethod, string> = {
  publish: "pageMethods.publishPage",
  unPublish: "pageMethods.unPublishPage",
  requestApproval: "pageMethods.pageRequestApproval",
  approve: "pageMethods.approvePage",
  decline: "pageMethods.declinePage",
  delete: "pageMethods.deletePage",
};

const workflowOperation = pos("operation", "string", "Workflow operation", {
  choices: Object.keys(WORKFLOW_OPERATIONS),
});

export const contentWrites: Endpoint[] = [
  {
    resource: "content",
    action: "save",
    describe: "Create or update content items (an object, or an array for several)",
    effect: "write",
    sdk: ["contentMethods.saveContentItem", "contentMethods.saveContentItems"],
    args: [DATA("A ContentItem, or an array of them")],
    needsLocale: true,
    batched: true,
    checks: (c, a) =>
      versionWarnings(
        asList(a.data),
        (i) => Number(i?.contentID),
        (id) => c.contentMethods.getContentItem(id, a.guid, a.locale!),
        "Content item"
      ),
    call: (c, a) =>
      Array.isArray(a.data)
        ? c.contentMethods.saveContentItems(a.data, a.guid, a.locale!, true)
        : c.contentMethods.saveContentItem(a.data, a.guid, a.locale!, true),
  },
  ...ITEM_WORKFLOW.map(
    (w): Endpoint => ({
      resource: "content",
      action: w.action,
      describe: `${w.describe} a content item`,
      effect: w.method === "delete" ? "delete" : "write",
      sdk: [CONTENT_SDK[w.method]],
      args: [pos("id", "number", "Content item ID"), COMMENTS],
      needsLocale: true,
      batched: true,
      call: contentWorkflowCall(w.method),
    })
  ),
  {
    resource: "content",
    action: "workflow",
    describe: "Run a workflow operation on several content items in one batch",
    effect: "write",
    sdk: ["contentMethods.batchWorkflowContent"],
    args: [workflowOperation, pos("ids", "number[]", "Comma-separated content item IDs")],
    needsLocale: true,
    batched: true,
    call: (c, a) =>
      c.contentMethods.batchWorkflowContent(a.ids, a.guid, a.locale!, WORKFLOW_OPERATIONS[a.operation], true),
  },
  {
    resource: "content",
    action: "reorder",
    describe: "Set the order of the items in a list",
    effect: "write",
    sdk: ["contentMethods.setContentListItemOrder"],
    args: [
      pos("referenceName", "string", "List reference name"),
      pos("ids", "number[]", "Comma-separated content item IDs, in the new order"),
      flag("skip-unknown", "boolean", "Ignore IDs that aren't in the list instead of failing", { default: false }),
    ],
    needsLocale: true,
    call: (c, a) =>
      c.contentMethods.setContentListItemOrder(a.referenceName, a.guid, a.locale!, a.ids, !!a.skipUnknown),
  },
];

export const pageWrites: Endpoint[] = [
  {
    resource: "page",
    action: "save",
    describe: "Create or update a page",
    effect: "write",
    sdk: ["pageMethods.savePage"],
    args: [
      DATA("A PageItem"),
      flag("parent-id", "number", "Parent page ID for a new page"),
      flag("place-before", "number", "Place the page before this sibling page ID"),
      flag("other-locale-page-id", "number", "The same page's ID in another locale, to link them"),
      flag("other-locale", "string", "The locale of --other-locale-page-id"),
      flag("link-existing-components", "boolean", "Reuse the other locale's components", { default: false }),
    ],
    needsLocale: true,
    batched: true,
    checks: (c, a) =>
      versionWarnings(
        [a.data],
        (i) => Number(i?.pageID),
        (id) => c.pageMethods.getPage(id, a.guid, a.locale!),
        "Page"
      ),
    call: (c, a) =>
      c.pageMethods.savePage(
        a.data,
        a.guid,
        a.locale!,
        a.parentId,
        a.placeBefore,
        true,
        a.otherLocalePageId,
        a.otherLocale,
        !!a.linkExistingComponents
      ),
  },
  {
    resource: "page",
    action: "move",
    describe: "Move a page in the sitemap",
    effect: "write",
    sdk: ["pageMethods.movePage"],
    args: [
      pos("id", "number", "Page ID"),
      flag("parent-id", "number", "New parent page ID (omit to keep the parent)"),
      flag("place-before", "number", "Place the page before this sibling page ID (omit for last)"),
    ],
    needsLocale: true,
    call: (c, a) => c.pageMethods.movePage(a.id, a.guid, a.locale!, a.parentId, a.placeBefore),
  },
  ...ITEM_WORKFLOW.map(
    (w): Endpoint => ({
      resource: "page",
      action: w.action,
      describe: `${w.describe} a page`,
      effect: w.method === "delete" ? "delete" : "write",
      sdk: [PAGE_SDK[w.method]],
      args: [pos("id", "number", "Page ID"), COMMENTS],
      needsLocale: true,
      batched: true,
      call: pageWorkflowCall(w.method),
    })
  ),
  {
    resource: "page",
    action: "workflow",
    describe: "Run a workflow operation on several pages in one batch",
    effect: "write",
    sdk: ["pageMethods.batchWorkflowPages"],
    args: [workflowOperation, pos("ids", "number[]", "Comma-separated page IDs")],
    needsLocale: true,
    batched: true,
    call: (c, a) => c.pageMethods.batchWorkflowPages(a.ids, a.guid, a.locale!, WORKFLOW_OPERATIONS[a.operation], true),
  },
];

export const templateWrites: Endpoint[] = [
  {
    resource: "template",
    action: "save",
    describe: "Create or update a page template",
    effect: "write",
    sdk: ["pageMethods.savePageTemplate"],
    args: [DATA("A PageModel")],
    needsLocale: true,
    call: (c, a) => c.pageMethods.savePageTemplate(a.guid, a.locale!, a.data),
  },
  {
    resource: "template",
    action: "delete",
    describe: "Delete a page template",
    effect: "delete",
    sdk: ["pageMethods.deletePageTemplate"],
    args: [pos("id", "number", "Page template ID")],
    needsLocale: true,
    call: (c, a) => c.pageMethods.deletePageTemplate(a.guid, a.locale!, a.id),
  },
];

export const modelWrites: Endpoint[] = [
  {
    resource: "model",
    action: "save",
    describe: "Create or update a content or component model",
    effect: "write",
    sdk: ["modelMethods.saveModel"],
    args: [DATA("A Model")],
    call: (c, a) => c.modelMethods.saveModel(a.data, a.guid),
  },
  {
    resource: "model",
    action: "delete",
    describe: "Delete a model",
    effect: "delete",
    sdk: ["modelMethods.deleteModel"],
    args: [pos("id", "number", "Model ID")],
    call: (c, a) => c.modelMethods.deleteModel(a.id, a.guid),
  },
];

export const containerWrites: Endpoint[] = [
  {
    resource: "container",
    action: "save",
    describe: "Create or update a container",
    effect: "write",
    sdk: ["containerMethods.saveContainer"],
    args: [
      DATA("A Container"),
      flag("force-reference-name", "boolean", "Keep the given reference name exactly", { default: false }),
    ],
    call: (c, a) => c.containerMethods.saveContainer(a.data, a.guid, !!a.forceReferenceName),
  },
  {
    resource: "container",
    action: "delete",
    describe: "Delete a container",
    effect: "delete",
    sdk: ["containerMethods.deleteContainer"],
    args: [pos("id", "number", "Container ID")],
    call: (c, a) => c.containerMethods.deleteContainer(a.id, a.guid),
  },
];

/** Read a local file into multipart form data for an upload. A missing file is a usage error. */
export function uploadForm(file: string): FormData {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(file);
  } catch (err: any) {
    throw new CliError("usage", `Can't read ${file}: ${err?.code || err?.message}`);
  }
  const form = new FormData();
  form.append("files", bytes, path.basename(file));
  return form;
}

/**
 * The media ID of an asset folder. Folder rename and delete need it: without one the API answers
 * 200 and changes nothing. A folder that doesn't exist is a 404 from the lookup (not_found).
 */
export async function folderMediaID(
  c: mgmtApi.ApiClient,
  guid: string,
  folder: string,
  given: number | undefined
): Promise<number> {
  if (given !== undefined) return given;
  const key = String(folder || "").replace(/^\/+|\/+$/g, "");
  if (!key) throw new CliError("usage", "Give the folder's path, e.g. images/banners.");
  const container = await c.assetMethods.getDefaultContainer(guid);
  const base = String(container?.originUrl || "").replace(/\/+$/, "");
  if (!base) throw new CliError("error", "Couldn't find the instance's media container to look up the folder.");
  let media: mgmtApi.Media | null = null;
  try {
    media = await c.assetMethods.getAssetByUrl(q(`${base}/${key}`), guid);
  } catch (err) {
    if (statusOf(err) !== "not_found") throw err;
  }
  if (!media?.isFolder || !media.mediaID) {
    throw new CliError("not_found", `${key} isn't an asset folder. Pass --media-id to name the folder directly.`);
  }
  return media.mediaID;
}

export const assetWrites: Endpoint[] = [
  {
    resource: "asset",
    action: "upload",
    describe: "Upload a file",
    effect: "write",
    sdk: ["assetMethods.upload"],
    args: [
      pos("file", "string", "Local file to upload"),
      flag("folder", "string", "Asset folder path", { default: "/" }),
      flag("gallery-id", "number", "Gallery to add the asset to"),
    ],
    call: (c, a) => c.assetMethods.upload(uploadForm(a.file), q(a.folder), a.guid, a.galleryId ?? -1),
  },
  {
    resource: "asset",
    action: "move",
    describe: "Move an asset to another folder",
    effect: "write",
    sdk: ["assetMethods.moveFile"],
    args: [pos("id", "number", "Asset (media) ID"), pos("folder", "string", "Destination folder path")],
    call: (c, a) => c.assetMethods.moveFile(a.id, q(a.folder), a.guid),
  },
  {
    resource: "asset",
    action: "delete",
    describe: "Delete an asset",
    effect: "delete",
    sdk: ["assetMethods.deleteFile"],
    args: [pos("id", "number", "Asset (media) ID")],
    call: (c, a) => c.assetMethods.deleteFile(a.id, a.guid),
  },
  {
    resource: "asset",
    action: "folder-create",
    describe: "Create an asset folder",
    effect: "write",
    sdk: ["assetMethods.createFolder"],
    args: [pos("path", "string", "Folder path (origin key)")],
    call: (c, a) => c.assetMethods.createFolder(q(a.path), a.guid),
  },
  {
    resource: "asset",
    action: "folder-rename",
    describe: "Rename an asset folder",
    effect: "write",
    sdk: ["assetMethods.renameFolder"],
    args: [
      pos("path", "string", "Current folder path"),
      pos("newName", "string", "New folder path"),
      flag("media-id", "number", "The folder's media ID; looked up from the path when omitted"),
    ],
    call: async (c, a) =>
      c.assetMethods.renameFolder(q(a.path), q(a.newName), a.guid, await folderMediaID(c, a.guid, a.path, a.mediaId)),
  },
  {
    resource: "asset",
    action: "folder-delete",
    describe: "Delete an asset folder",
    effect: "delete",
    sdk: ["assetMethods.deleteFolder"],
    args: [
      pos("path", "string", "Folder path (origin key)"),
      flag("media-id", "number", "The folder's media ID; looked up from the path when omitted"),
    ],
    call: async (c, a) =>
      c.assetMethods.deleteFolder(q(a.path), a.guid, await folderMediaID(c, a.guid, a.path, a.mediaId)),
  },
];

export const galleryWrites: Endpoint[] = [
  {
    resource: "gallery",
    action: "save",
    describe: "Create or update a gallery",
    effect: "write",
    sdk: ["assetMethods.saveGallery"],
    args: [DATA("An assetMediaGrouping")],
    call: (c, a) => c.assetMethods.saveGallery(a.guid, a.data),
  },
  {
    resource: "gallery",
    action: "delete",
    describe: "Delete a gallery",
    effect: "delete",
    sdk: ["assetMethods.deleteGallery"],
    args: [pos("id", "number", "Gallery ID")],
    call: (c, a) => c.assetMethods.deleteGallery(a.guid, a.id),
  },
];

const BATCH_ACTIONS: {
  action: string;
  describe: string;
  sdk: string;
  run: (c: mgmtApi.ApiClient, a: ResolvedArgs) => Promise<number>;
}[] = [
  {
    action: "publish",
    describe: "Publish",
    sdk: "batchMethods.publishBatch",
    run: (c, a) => c.batchMethods.publishBatch(a.id, a.guid, true),
  },
  {
    action: "unpublish",
    describe: "Unpublish",
    sdk: "batchMethods.unpublishBatch",
    run: (c, a) => c.batchMethods.unpublishBatch(a.id, a.guid, true),
  },
  {
    action: "approve",
    describe: "Approve",
    sdk: "batchMethods.approveBatch",
    run: (c, a) => c.batchMethods.approveBatch(a.id, a.guid, true),
  },
  {
    action: "decline",
    describe: "Decline",
    sdk: "batchMethods.declineBatch",
    run: (c, a) => c.batchMethods.declineBatch(a.id, a.guid, true),
  },
  {
    action: "request-approval",
    describe: "Request approval for",
    sdk: "batchMethods.requestApprovalBatch",
    run: (c, a) => c.batchMethods.requestApprovalBatch(a.id, a.guid, true),
  },
];

export const batchWrites: Endpoint[] = BATCH_ACTIONS.map(
  (b): Endpoint => ({
    resource: "batch",
    action: b.action,
    describe: `${b.describe} the items of a batch`,
    effect: "write",
    sdk: [b.sdk],
    args: [pos("id", "number", "Batch ID")],
    batched: true,
    call: async (c, a) => [await b.run(c, a)],
  })
);

export const userWrites: Endpoint[] = [
  {
    resource: "user",
    action: "save",
    describe: "Add a user to the instance, or change their roles",
    effect: "write",
    sdk: ["instanceUserMethods.saveUser"],
    args: [
      pos("email", "string", "The user's email address"),
      flag("roles", "json", "InstanceRole array as JSON, @file.json, or - for stdin", { required: true }),
      flag("first-name", "string", "First name"),
      flag("last-name", "string", "Last name"),
    ],
    call: (c, a) => c.instanceUserMethods.saveUser(q(a.email), asList(a.roles), a.guid, q(a.firstName), q(a.lastName)),
  },
  {
    resource: "user",
    action: "delete",
    describe: "Remove a user from the instance",
    effect: "delete",
    sdk: ["instanceUserMethods.deleteUser"],
    args: [pos("id", "number", "User ID")],
    call: (c, a) => c.instanceUserMethods.deleteUser(a.id, a.guid),
  },
];

export const webhookWrites: Endpoint[] = [
  {
    resource: "webhook",
    action: "save",
    describe: "Create or update a webhook",
    effect: "write",
    sdk: ["webhookMethods.saveWebhook"],
    args: [DATA("A Webhook")],
    call: (c, a) => c.webhookMethods.saveWebhook(a.guid, a.data),
  },
  {
    resource: "webhook",
    action: "delete",
    describe: "Delete a webhook",
    effect: "delete",
    sdk: ["webhookMethods.deleteWebhook"],
    args: [pos("id", "string", "Webhook ID")],
    call: (c, a) => c.webhookMethods.deleteWebhook(a.guid, a.id),
  },
  {
    resource: "webhook",
    action: "rotate-secret",
    describe: "Issue a new signing secret for a webhook",
    effect: "write",
    sdk: ["webhookMethods.rotateWebhookSecret"],
    args: [pos("id", "string", "Webhook ID")],
    call: (c, a) => c.webhookMethods.rotateWebhookSecret(a.guid, a.id),
  },
];

export const redirectWrites: Endpoint[] = [
  {
    resource: "redirect",
    action: "delete",
    describe: "Delete URL redirections",
    effect: "delete",
    sdk: ["urlRedirectionMethods.deleteUrlRedirections"],
    args: [pos("ids", "number[]", "Comma-separated URL redirection IDs")],
    call: (c, a) => c.urlRedirectionMethods.deleteUrlRedirections(a.guid, a.ids),
  },
];
