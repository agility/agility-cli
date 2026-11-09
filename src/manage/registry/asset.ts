import { Endpoint, flag, pos, takeSkip } from "../types";

export const asset: Endpoint[] = [
  {
    resource: "asset",
    action: "list",
    describe: "List media",
    effect: "read",
    sdk: ["assetMethods.getMediaList"],
    args: [...takeSkip(100)],
    paged: { take: "take", skip: "skip" },
    call: (c, a) => c.assetMethods.getMediaList(a.take, a.skip, a.guid),
  },
  {
    resource: "asset",
    action: "get",
    describe: "Get a media item",
    effect: "read",
    sdk: ["assetMethods.getAssetByID"],
    args: [pos("id", "number", "Media ID")],
    call: (c, a) => c.assetMethods.getAssetByID(a.id, a.guid),
  },
  {
    resource: "asset",
    action: "get-by-url",
    describe: "Get a media item by its URL",
    effect: "read",
    sdk: ["assetMethods.getAssetByUrl"],
    args: [pos("url", "string", "Media URL")],
    call: (c, a) => c.assetMethods.getAssetByUrl(a.url, a.guid),
  },
  {
    resource: "asset",
    action: "default-container",
    describe: "The instance's default media container",
    effect: "read",
    sdk: ["assetMethods.getDefaultContainer"],
    args: [],
    call: (c, a) => c.assetMethods.getDefaultContainer(a.guid),
  },
];

export const gallery: Endpoint[] = [
  {
    resource: "gallery",
    action: "list",
    describe: "List galleries",
    effect: "read",
    sdk: ["assetMethods.getGalleries"],
    args: [flag("search", "string", "Only galleries whose name contains this"), ...takeSkip(100)],
    paged: { take: "take", skip: "skip" },
    call: (c, a) => c.assetMethods.getGalleries(a.guid, a.search, a.take, a.skip),
  },
  {
    resource: "gallery",
    action: "get",
    describe: "Get a gallery",
    effect: "read",
    sdk: ["assetMethods.getGalleryById"],
    args: [pos("id", "number", "Gallery ID")],
    call: (c, a) => c.assetMethods.getGalleryById(a.guid, a.id),
  },
  {
    resource: "gallery",
    action: "get-by-name",
    describe: "Get a gallery by name",
    effect: "read",
    sdk: ["assetMethods.getGalleryByName"],
    args: [pos("name", "string", "Gallery name")],
    call: (c, a) => c.assetMethods.getGalleryByName(a.guid, a.name),
  },
];
