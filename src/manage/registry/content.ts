import { Endpoint, flag, pos, takeSkip } from "../types";

const listParams = (a: any) => ({
  filter: a.filter ?? "",
  fields: a.listFields ?? "",
  sortDirection: a.direction ?? "",
  sortField: a.sort ?? "",
  showDeleted: !!a.showDeleted,
  take: a.take,
  skip: a.skip,
});

const listFlags = [
  ...takeSkip(50),
  flag("sort", "string", "Field to sort by"),
  flag("direction", "string", "Sort direction", { choices: ["asc", "desc"] }),
  flag("filter", "string", "Server-side filter expression"),
  flag("list-fields", "string", "Comma-separated fields for the server to return"),
  flag("show-deleted", "boolean", "Include deleted items", { default: false }),
];

export const content: Endpoint[] = [
  {
    resource: "content",
    action: "get",
    describe: "Get a content item",
    effect: "read",
    sdk: ["contentMethods.getContentItem"],
    args: [pos("id", "number", "Content item ID")],
    needsLocale: true,
    call: (c, a) => c.contentMethods.getContentItem(a.id, a.guid, a.locale),
  },
  {
    resource: "content",
    action: "list",
    describe: "List the items in a container",
    effect: "read",
    sdk: ["contentMethods.getContentItems"],
    args: [pos("referenceName", "string", "Container reference name"), ...listFlags],
    needsLocale: true,
    paged: { take: "take", skip: "skip" },
    call: (c, a) => c.contentMethods.getContentItems(a.referenceName, a.guid, a.locale, listParams(a)),
  },
  {
    resource: "content",
    action: "list-filtered",
    describe: "List the items in a container with a structured filter",
    effect: "read",
    sdk: ["contentMethods.getContentList"],
    args: [
      pos("referenceName", "string", "Container reference name"),
      ...listFlags,
      flag("where", "json", "ContentListFilterModel as JSON, @file.json or - for stdin"),
    ],
    needsLocale: true,
    paged: { take: "take", skip: "skip" },
    call: (c, a) => c.contentMethods.getContentList(a.referenceName, a.guid, a.locale, listParams(a), a.where),
  },
  {
    resource: "content",
    action: "history",
    describe: "Version history of a content item",
    effect: "read",
    sdk: ["contentMethods.getContentHistory"],
    args: [pos("id", "number", "Content item ID"), ...takeSkip(50)],
    needsLocale: true,
    call: (c, a) => c.contentMethods.getContentHistory(a.locale, a.guid, a.id, a.take, a.skip),
  },
  {
    resource: "content",
    action: "comments",
    describe: "Workflow comments on a content item",
    effect: "read",
    sdk: ["contentMethods.getContentComments"],
    args: [pos("id", "number", "Content item ID"), ...takeSkip(50)],
    needsLocale: true,
    call: (c, a) => c.contentMethods.getContentComments(a.locale, a.guid, a.id, a.take, a.skip),
  },
];
