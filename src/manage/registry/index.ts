import { Endpoint } from "../types";
import { content } from "./content";
import { page, template } from "./page";
import { model, container } from "./model";
import { asset, gallery } from "./asset";
import { batch, user, webhook, instance, search } from "./instance";

export const registry: Endpoint[] = [
  ...content,
  ...page,
  ...template,
  ...model,
  ...container,
  ...asset,
  ...gallery,
  ...batch,
  ...user,
  ...webhook,
  ...instance,
  ...search,
];

/** SDK members that are plumbing, not API calls. Never exposed. */
export const SKIPPED_SDK_METHODS: string[] = ["batchMethods.Retry", "batchMethods.delay"];

/**
 * Write and delete methods not exposed yet. They arrive with the write guards (--data, --dry-run,
 * confirmation, --wait). Listed so the coverage test passes until then and still catches a new
 * or renamed SDK method.
 */
export const PLANNED_SDK_METHODS: string[] = [
  "contentMethods.publishContent",
  "contentMethods.unPublishContent",
  "contentMethods.batchWorkflowContent",
  "contentMethods.contentRequestApproval",
  "contentMethods.approveContent",
  "contentMethods.declineContent",
  "contentMethods.deleteContent",
  "contentMethods.saveContentItem",
  "contentMethods.saveContentItems",
  "contentMethods.setContentListItemOrder",
  "pageMethods.publishPage",
  "pageMethods.unPublishPage",
  "pageMethods.batchWorkflowPages",
  "pageMethods.pageRequestApproval",
  "pageMethods.approvePage",
  "pageMethods.declinePage",
  "pageMethods.deletePage",
  "pageMethods.savePage",
  "pageMethods.savePageTemplate",
  "pageMethods.deletePageTemplate",
  "modelMethods.saveModel",
  "modelMethods.deleteModel",
  "containerMethods.saveContainer",
  "containerMethods.deleteContainer",
  "assetMethods.upload",
  "assetMethods.moveFile",
  "assetMethods.deleteFile",
  "assetMethods.createFolder",
  "assetMethods.renameFolder",
  "assetMethods.deleteFolder",
  "assetMethods.saveGallery",
  "assetMethods.deleteGallery",
  "batchMethods.publishBatch",
  "batchMethods.unpublishBatch",
  "batchMethods.approveBatch",
  "batchMethods.declineBatch",
  "batchMethods.requestApprovalBatch",
  "instanceUserMethods.saveUser",
  "instanceUserMethods.deleteUser",
  "webhookMethods.saveWebhook",
  "webhookMethods.deleteWebhook",
  "webhookMethods.rotateWebhookSecret",
  "urlRedirectionMethods.deleteUrlRedirections",
];

export function findEndpoint(resource: string, action: string): Endpoint | undefined {
  return registry.find((e) => e.resource === resource && e.action === action);
}

export function resources(): string[] {
  const out: string[] = [];
  for (const e of registry) if (out.indexOf(e.resource) === -1) out.push(e.resource);
  return out;
}
