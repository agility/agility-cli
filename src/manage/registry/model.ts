import { Endpoint, flag, pos, takeSkip } from "../types";

export const model: Endpoint[] = [
  {
    resource: "model",
    action: "get",
    describe: "Get a content or component model",
    effect: "read",
    sdk: ["modelMethods.getContentModel"],
    args: [pos("id", "number", "Model ID")],
    call: (c, a) => c.modelMethods.getContentModel(a.id, a.guid),
  },
  {
    resource: "model",
    action: "get-by-name",
    describe: "Get a model by reference name",
    effect: "read",
    sdk: ["modelMethods.getModelByReferenceName"],
    args: [pos("referenceName", "string", "Model reference name")],
    call: (c, a) => c.modelMethods.getModelByReferenceName(a.referenceName, a.guid),
  },
  {
    resource: "model",
    action: "list",
    describe: "List content models, or component models with --type component",
    effect: "read",
    sdk: ["modelMethods.getContentModules", "modelMethods.getPageModules"],
    args: [
      flag("type", "string", "Which models to list", { choices: ["content", "component"], default: "content" }),
      flag("include-defaults", "boolean", "Include Agility's built-in models", { default: false }),
    ],
    call: (c, a) =>
      a.type === "component"
        ? c.modelMethods.getPageModules(!!a.includeDefaults, a.guid)
        : c.modelMethods.getContentModules(!!a.includeDefaults, a.guid, false),
  },
];

export const container: Endpoint[] = [
  {
    resource: "container",
    action: "get",
    describe: "Get a container",
    effect: "read",
    sdk: ["containerMethods.getContainerByID"],
    args: [pos("id", "number", "Container ID")],
    call: (c, a) => c.containerMethods.getContainerByID(a.id, a.guid),
  },
  {
    resource: "container",
    action: "get-by-name",
    describe: "Get a container by reference name",
    effect: "read",
    sdk: ["containerMethods.getContainerByReferenceName"],
    args: [pos("referenceName", "string", "Container reference name")],
    call: (c, a) => c.containerMethods.getContainerByReferenceName(a.referenceName, a.guid),
  },
  {
    resource: "container",
    action: "list",
    describe: "List every container",
    effect: "read",
    sdk: ["containerMethods.getContainerList"],
    args: [],
    call: (c, a) => c.containerMethods.getContainerList(a.guid),
  },
  {
    resource: "container",
    action: "list-paged",
    describe: "List containers a page at a time",
    effect: "read",
    sdk: ["containerMethods.getContainerListPaged"],
    args: [...takeSkip(100), flag("updated-since", "string", "Only containers changed since this ISO date")],
    paged: { take: "take", skip: "skip" },
    call: (c, a) =>
      c.containerMethods.getContainerListPaged(
        a.guid,
        a.take,
        a.skip,
        undefined,
        undefined,
        a.updatedSince ? new Date(a.updatedSince) : undefined
      ),
  },
  {
    resource: "container",
    action: "by-model",
    describe: "List the containers that use a model",
    effect: "read",
    sdk: ["containerMethods.getContainersByModel"],
    args: [pos("modelId", "number", "Model ID")],
    call: (c, a) => c.containerMethods.getContainersByModel(a.modelId, a.guid),
  },
  {
    resource: "container",
    action: "security",
    describe: "Get a container's permissions",
    effect: "read",
    sdk: ["containerMethods.getContainerSecurity"],
    args: [pos("id", "number", "Container ID")],
    call: (c, a) => c.containerMethods.getContainerSecurity(a.id, a.guid),
  },
  {
    resource: "container",
    action: "notifications",
    describe: "List a container's notification settings",
    effect: "read",
    sdk: ["containerMethods.getNotificationList"],
    args: [pos("id", "number", "Container ID")],
    call: (c, a) => c.containerMethods.getNotificationList(a.id, a.guid),
  },
];
