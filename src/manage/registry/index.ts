import { Endpoint } from "../types";
import { content } from "./content";
import { page, template } from "./page";
import { model, container } from "./model";
import { asset, gallery } from "./asset";
import { batch, user, webhook, instance, search } from "./instance";
import {
  assetWrites,
  batchWrites,
  containerWrites,
  contentWrites,
  galleryWrites,
  modelWrites,
  pageWrites,
  redirectWrites,
  templateWrites,
  userWrites,
  webhookWrites,
} from "./writes";

export const registry: Endpoint[] = [
  ...content,
  ...contentWrites,
  ...page,
  ...pageWrites,
  ...template,
  ...templateWrites,
  ...model,
  ...modelWrites,
  ...container,
  ...containerWrites,
  ...asset,
  ...assetWrites,
  ...gallery,
  ...galleryWrites,
  ...batch,
  ...batchWrites,
  ...user,
  ...userWrites,
  ...webhook,
  ...webhookWrites,
  ...redirectWrites,
  ...instance,
  ...search,
];

/** SDK members that are plumbing, not API calls. Never exposed. */
export const SKIPPED_SDK_METHODS: string[] = ["batchMethods.Retry", "batchMethods.delay"];

/**
 * SDK methods not exposed yet. Empty since phase 3; kept so the coverage test has somewhere to
 * park a new SDK method deliberately rather than by accident.
 */
export const PLANNED_SDK_METHODS: string[] = [];

export function findEndpoint(resource: string, action: string): Endpoint | undefined {
  return registry.find((e) => e.resource === resource && e.action === action);
}

export function resources(): string[] {
  const out: string[] = [];
  for (const e of registry) if (out.indexOf(e.resource) === -1) out.push(e.resource);
  return out;
}
