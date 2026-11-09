import { Endpoint, flag, pos } from "../types";

export const batch: Endpoint[] = [
  {
    resource: "batch",
    action: "get",
    describe: "Get a batch and its state",
    effect: "read",
    sdk: ["batchMethods.getBatch"],
    args: [pos("id", "number", "Batch ID"), flag("expand", "boolean", "Include the batch's items", { default: false })],
    call: (c, a) => c.batchMethods.getBatch(a.id, a.guid, !!a.expand),
  },
  {
    resource: "batch",
    action: "types",
    describe: "The batch operation and state types",
    effect: "read",
    sdk: ["batchMethods.getBatchTypes"],
    args: [],
    call: (c, a) => c.batchMethods.getBatchTypes(a.guid),
  },
];

export const user: Endpoint[] = [
  {
    resource: "user",
    action: "list",
    describe: "List the users with access to the instance",
    effect: "read",
    sdk: ["instanceUserMethods.getUsers"],
    args: [],
    call: (c, a) => c.instanceUserMethods.getUsers(a.guid),
  },
  {
    resource: "user",
    action: "me",
    describe: "The signed-in user",
    effect: "read",
    sdk: ["serverUserMethods.me"],
    args: [],
    call: (c, a) => c.serverUserMethods.me(a.guid),
  },
  {
    resource: "user",
    action: "get",
    describe: "Get a user by server user ID",
    effect: "read",
    sdk: ["serverUserMethods.you"],
    args: [pos("id", "number", "Server user ID")],
    call: (c, a) => c.serverUserMethods.you(a.guid, a.id),
  },
];

export const webhook: Endpoint[] = [
  {
    resource: "webhook",
    action: "list",
    describe: "List webhooks",
    effect: "read",
    sdk: ["webhookMethods.webhookList"],
    args: [
      flag("take", "number", "How many to return", { default: 50 }),
      flag("page-token", "string", "Continuation token from the previous page"),
    ],
    call: (c, a) => c.webhookMethods.webhookList(a.guid, a.take, a.pageToken),
  },
  {
    resource: "webhook",
    action: "get",
    describe: "Get a webhook",
    effect: "read",
    sdk: ["webhookMethods.getWebhook"],
    args: [pos("id", "string", "Webhook ID")],
    call: (c, a) => c.webhookMethods.getWebhook(a.guid, a.id),
  },
  {
    resource: "webhook",
    action: "history",
    describe: "Delivery history of a webhook",
    effect: "read",
    sdk: ["webhookMethods.getWebhookHistory"],
    args: [
      pos("id", "string", "Webhook ID"),
      flag("from", "string", "Only deliveries on or after this ISO date"),
      flag("to", "string", "Only deliveries on or before this ISO date"),
      flag("take", "number", "How many to return", { default: 50 }),
      flag("page-token", "string", "Continuation token from the previous page"),
    ],
    call: (c, a) =>
      c.webhookMethods.getWebhookHistory(a.guid, a.id, {
        fromDate: a.from,
        toDate: a.to,
        take: a.take,
        token: a.pageToken,
      }),
  },
];

export const instance: Endpoint[] = [
  {
    resource: "instance",
    action: "locales",
    describe: "The instance's locales",
    effect: "read",
    sdk: ["instanceMethods.getLocales"],
    args: [],
    call: (c, a) => c.instanceMethods.getLocales(a.guid),
  },
  {
    resource: "instance",
    action: "fetch-status",
    describe: "Fetch API sync status",
    effect: "read",
    sdk: ["instanceMethods.getFetchApiStatus"],
    args: [
      flag("mode", "string", "Which Fetch API to check", { choices: ["fetch", "preview"], default: "fetch" }),
      flag("wait", "boolean", "Wait until the sync completes", { default: false }),
    ],
    call: (c, a) => c.instanceMethods.getFetchApiStatus(a.guid, a.mode, !!a.wait),
  },
];

export const search: Endpoint[] = [
  {
    resource: "search",
    action: "query",
    describe: "Search content, components, pages, assets, models and containers",
    effect: "read",
    sdk: ["searchMethods.search"],
    args: [
      pos("text", "string", "Text to search for; quote a phrase for an exact match"),
      flag("kinds", "string[]", "Only these kinds: content, component, page, asset, model, container"),
      flag("containers", "string[]", "Only content in these containers (reference names)"),
      flag("models", "string[]", "Only content and components of these models (reference names)"),
      flag("state", "string", "Only content in this state", {
        choices: ["staging", "published", "unpublished", "any"],
      }),
      flag("modified-after", "string", "Only results modified on or after this ISO date"),
      flag("take", "number", "How many to return (1 to 100)", { default: 25 }),
      flag("skip", "number", "How many to skip, for paging", { default: 0 }),
    ],
    call: (c, a) =>
      c.searchMethods.search(a.guid, {
        query: a.text,
        kinds: a.kinds,
        // Search is the one call where locale is optional: no --locale searches every locale.
        locale: a.locale,
        containers: a.containers,
        models: a.models,
        state: a.state,
        modifiedAfter: a.modifiedAfter,
        take: a.take,
        skip: a.skip,
      }),
  },
];
