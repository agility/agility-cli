// Change catalogue for the live sync test: edits an editor might make between syncs.
//
// Every change discovers what to touch from the instance itself (lists, items, pages, models), so
// it works on whatever the source was built from. Each returns a description of what it did, or
// null when the instance has nothing it applies to. Changes write through the Management API,
// the same way the Manager App does.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const mgmt = require("@agility/management-sdk");

export function client(token) {
  return new mgmt.ApiClient({ token, baseUrl: null, refresh_token: null, duration: 3000, retryCount: 500 });
}

// Small seeded RNG (mulberry32), so a run's choices replay exactly from its seed.
export function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, pick: (arr) => arr[Math.floor(next() * arr.length)], int: (n) => Math.floor(next() * n) };
}

const LIST_PARAMS = {
  take: 250,
  skip: 0,
  filter: "",
  fields: "",
  sortDirection: "",
  sortField: "",
  showDeleted: false,
};
const SYSTEM_LISTS = /^Agility(CSSFiles|JavascriptFiles|GlobalCodeTemplates|ModuleCodeTemplates|PageCodeTemplates)$/i;

// ── Discovery ─────────────────────────────────────────────────────────────────────────────────

async function lists(c, guid) {
  const all = await c.containerMethods.getContainerList(guid);
  // Content lists only (contentDefinitionType 1); components are 2. Not the system lists.
  return all.filter((x) => x.referenceName && x.contentDefinitionType === 1 && !SYSTEM_LISTS.test(x.referenceName));
}

async function items(c, guid, locale, referenceName) {
  try {
    const r = await c.contentMethods.getContentItems(referenceName, guid, locale, LIST_PARAMS);
    // Rows come back nested, keyed by itemContainerID (the content ID; contentItemID is a version).
    const rows = (r?.items ?? []).flat(Infinity);
    const seen = new Set();
    return rows
      .map((x) => ({ ...x, contentID: x.contentID ?? x.itemContainerID }))
      .filter((x) => x.contentID > 0 && !seen.has(x.contentID) && seen.add(x.contentID));
  } catch {
    return [];
  }
}

async function listsWithItems(c, guid, locale, min = 1) {
  const out = [];
  for (const l of await lists(c, guid)) {
    const its = await items(c, guid, locale, l.referenceName);
    if (its.length >= min) out.push({ list: l, items: its });
  }
  return out;
}

async function pages(c, guid, locale) {
  const flat = [];
  const walk = (nodes) => {
    for (const n of nodes ?? []) {
      if (n.pageID > 0) flat.push(n);
      walk(n.pages);
    }
  };
  for (const ch of await c.pageMethods.getSitemap(guid, locale)) {
    const before = flat.length;
    walk(ch.pages);
    for (const p of flat.slice(before)) p.channelID = ch.digitalChannelID;
  }
  return flat;
}

async function customModels(c, guid) {
  const ms = await c.modelMethods.getContentModules(false, guid);
  return ms.filter((m) => m.referenceName && !/^Agility|^RichTextArea$|^FormBuilder$|^Form$/i.test(m.referenceName));
}

// The first plain text field of an item, the one an editor would most likely change.
function textField(item) {
  for (const [k, v] of Object.entries(item.fields ?? {})) {
    if (typeof v === "string" && v.length > 0 && v.length < 200 && !/^\d+$/.test(v) && !/^https?:/.test(v)) return k;
  }
  return null;
}

// Single-item links ({contentid: N}) in an item's fields, and string companions holding the same ID.
function links(item) {
  const out = [];
  for (const [k, v] of Object.entries(item.fields ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v) && Number(v.contentid) > 0)
      out.push({ field: k, id: Number(v.contentid) });
  }
  return out;
}

async function save(c, guid, locale, item) {
  const ids = await c.contentMethods.saveContentItem(item, guid, locale);
  const id = Array.isArray(ids) ? ids[0] : ids;
  if (!(id > 0)) throw new Error(`save returned ${JSON.stringify(ids)}`);
  return id;
}

const tag = (ctx) => `r${ctx.round}${ctx.side === "target" ? "t" : "s"}`;

// ── The catalogue ─────────────────────────────────────────────────────────────────────────────
// ctx: { c, guid, locale, round, side: "source"|"target", r: rng, state }
// state persists across rounds per instance: what earlier rounds created, for later deletes.

export const CHANGES = {
  async "content.edit"(ctx) {
    const pool = (await listsWithItems(ctx.c, ctx.guid, ctx.locale)).flatMap((x) => x.items);
    let full = null;
    for (const it of [...pool].sort(() => ctx.r.next() - 0.5)) {
      const candidate = await ctx.c.contentMethods.getContentItem(it.contentID, ctx.guid, ctx.locale);
      if (textField(candidate)) {
        full = candidate;
        break;
      }
    }
    if (!full) return null;
    const f = textField(full);
    full.fields[f] = `${full.fields[f]} (${tag(ctx)})`;
    await save(ctx.c, ctx.guid, ctx.locale, full);
    return {
      area: "content",
      change: "edit",
      detail: `${full.properties.referenceName} #${full.contentID} field ${f}`,
    };
  },

  async "content.add"(ctx) {
    const l = ctx.r.pick(await listsWithItems(ctx.c, ctx.guid, ctx.locale));
    if (!l) return null;
    const src = await ctx.c.contentMethods.getContentItem(ctx.r.pick(l.items).contentID, ctx.guid, ctx.locale);
    const f = textField(src);
    const copy = { ...src, contentID: -1, properties: { ...src.properties, versionID: null, state: null } };
    if (f) copy.fields = { ...src.fields, [f]: `New ${tag(ctx)} ${src.fields[f]}` };
    const id = await save(ctx.c, ctx.guid, ctx.locale, copy);
    (ctx.state.created ??= []).push({ kind: "content", id });
    return { area: "content", change: "add", detail: `${l.list.referenceName} new #${id}` };
  },

  // A new linked item and a new item that links to it, in one round (dependency order, PROD-3025).
  async "content.add-chain"(ctx) {
    const all = (await listsWithItems(ctx.c, ctx.guid, ctx.locale)).flatMap((x) => x.items);
    for (const it of all) {
      const parent = await ctx.c.contentMethods.getContentItem(it.contentID, ctx.guid, ctx.locale);
      const ln = links(parent)[0];
      if (!ln) continue;
      const child = await ctx.c.contentMethods.getContentItem(ln.id, ctx.guid, ctx.locale);
      const cf = textField(child);
      const newChild = { ...child, contentID: -1, properties: { ...child.properties, versionID: null, state: null } };
      if (cf) newChild.fields = { ...child.fields, [cf]: `Chain ${tag(ctx)} ${child.fields[cf]}` };
      const childId = await save(ctx.c, ctx.guid, ctx.locale, newChild);
      const fields = { ...parent.fields, [ln.field]: { ...parent.fields[ln.field], contentid: childId } };
      for (const [k, v] of Object.entries(fields)) if (v === String(ln.id)) fields[k] = String(childId); // companion field
      const pf = textField(parent);
      if (pf) fields[pf] = `Chain ${tag(ctx)} ${parent.fields[pf]}`;
      const parentId = await save(ctx.c, ctx.guid, ctx.locale, {
        ...parent,
        contentID: -1,
        fields,
        properties: { ...parent.properties, versionID: null, state: null },
      });
      (ctx.state.created ??= []).push({ kind: "content", id: parentId }, { kind: "content", id: childId });
      return {
        area: "content",
        change: "add-chain",
        detail: `${parent.properties.referenceName} #${parentId} → ${child.properties.referenceName} #${childId}`,
      };
    }
    return null;
  },

  async "content.delete"(ctx) {
    // Prefer something an earlier round created; otherwise an item nothing links to.
    const mine = (ctx.state.created ?? []).filter((x) => x.kind === "content");
    let id = mine.length ? mine.pop().id : null;
    if (!id) {
      const all = (await listsWithItems(ctx.c, ctx.guid, ctx.locale, 3)).flatMap((x) => x.items);
      const full = await Promise.all(
        all.map((i) => ctx.c.contentMethods.getContentItem(i.contentID, ctx.guid, ctx.locale))
      );
      const linked = new Set(full.flatMap((i) => links(i).map((l) => l.id)));
      id = ctx.r.pick(full.filter((i) => !linked.has(i.contentID)))?.contentID;
    }
    if (!id) return null;
    await ctx.c.contentMethods.deleteContent(id, ctx.guid, ctx.locale);
    return { area: "content", change: "delete", detail: `#${id}` };
  },

  async "content.reorder"(ctx) {
    const l = ctx.r.pick(await listsWithItems(ctx.c, ctx.guid, ctx.locale, 2));
    if (!l) return null;
    const [a, b] = [l.items[0], l.items[l.items.length - 1]];
    const fa = await ctx.c.contentMethods.getContentItem(a.contentID, ctx.guid, ctx.locale);
    const fb = await ctx.c.contentMethods.getContentItem(b.contentID, ctx.guid, ctx.locale);
    const oa = fa.properties.itemOrder;
    fa.properties.itemOrder = fb.properties.itemOrder;
    fb.properties.itemOrder = oa;
    await save(ctx.c, ctx.guid, ctx.locale, fa);
    await save(ctx.c, ctx.guid, ctx.locale, fb);
    return {
      area: "ordering",
      change: "list-swap",
      detail: `${l.list.referenceName} #${a.contentID} ↔ #${b.contentID}`,
    };
  },

  async "content.publish-toggle"(ctx) {
    const pool = (await listsWithItems(ctx.c, ctx.guid, ctx.locale)).flatMap((x) => x.items);
    const it = ctx.r.pick(pool);
    if (!it) return null;
    const published = it.properties?.state === 2;
    if (published) await ctx.c.contentMethods.unPublishContent(it.contentID, ctx.guid, ctx.locale);
    else await ctx.c.contentMethods.publishContent(it.contentID, ctx.guid, ctx.locale);
    return { area: "content", change: published ? "unpublish" : "publish", detail: `#${it.contentID}` };
  },

  async "page.edit"(ctx) {
    const p = ctx.r.pick(await pages(ctx.c, ctx.guid, ctx.locale));
    if (!p) return null;
    const page = await ctx.c.pageMethods.getPage(p.pageID, ctx.guid, ctx.locale);
    page.title = `${page.title} (${tag(ctx)})`;
    page.menuText = `${page.menuText ?? page.title} (${tag(ctx)})`;
    await ctx.c.pageMethods.savePage(page, ctx.guid, ctx.locale);
    return { area: "pages", change: "edit", detail: `page ${page.name} #${page.pageID}` };
  },

  async "page.component-reorder"(ctx) {
    for (const p of await pages(ctx.c, ctx.guid, ctx.locale)) {
      const page = await ctx.c.pageMethods.getPage(p.pageID, ctx.guid, ctx.locale);
      const zone = Object.keys(page.zones ?? {}).find((z) => page.zones[z]?.length >= 2);
      if (!zone) continue;
      page.zones[zone] = [...page.zones[zone]].reverse();
      await ctx.c.pageMethods.savePage(page, ctx.guid, ctx.locale);
      return { area: "ordering", change: "components-reversed", detail: `page ${page.name} zone ${zone}` };
    }
    return null;
  },

  async "page.component-remove"(ctx) {
    for (const p of await pages(ctx.c, ctx.guid, ctx.locale)) {
      const page = await ctx.c.pageMethods.getPage(p.pageID, ctx.guid, ctx.locale);
      const zone = Object.keys(page.zones ?? {}).find((z) => page.zones[z]?.length >= 2);
      if (!zone) continue;
      const removed = page.zones[zone].pop();
      await ctx.c.pageMethods.savePage(page, ctx.guid, ctx.locale);
      return { area: "components", change: "remove", detail: `page ${page.name} zone ${zone}: ${removed?.module}` };
    }
    return null;
  },

  async "page.add"(ctx) {
    const all = await pages(ctx.c, ctx.guid, ctx.locale);
    let src = null;
    for (const p of all) {
      const full = await ctx.c.pageMethods.getPage(p.pageID, ctx.guid, ctx.locale);
      if (full.pageType === "static" && full.templateName) {
        src = { ...full, channelID: p.channelID };
        break;
      }
    }
    if (!src) return null;
    const name = `perm-${tag(ctx)}-${ctx.r.int(1e6)}`;
    // getPage doesn't return the channel; without one the insert fails on FK_DigitalChannel_PageItemContainer.
    const page = {
      ...src,
      pageID: -1,
      name,
      path: null,
      title: `Perm page ${tag(ctx)}`,
      menuText: `Perm ${tag(ctx)}`,
      zones: {},
      properties: null,
    };
    const ids = await ctx.c.pageMethods.savePage(page, ctx.guid, ctx.locale, -1, -1);
    const id = Array.isArray(ids) ? ids[0] : ids;
    if (!(id > 0)) throw new Error(`savePage returned ${JSON.stringify(ids)}`);
    (ctx.state.created ??= []).push({ kind: "page", id });
    return { area: "pages", change: "add", detail: `page ${name} #${id}` };
  },

  async "page.delete"(ctx) {
    const mine = (ctx.state.created ?? []).filter((x) => x.kind === "page");
    const p = mine.pop();
    if (!p) return null;
    ctx.state.created = ctx.state.created.filter((x) => x !== p);
    await ctx.c.pageMethods.deletePage(p.id, ctx.guid, ctx.locale);
    return { area: "pages", change: "delete", detail: `page #${p.id}` };
  },

  async "model.field-add"(ctx) {
    const m = ctx.r.pick(await customModels(ctx.c, ctx.guid));
    if (!m) return null;
    const full = await ctx.c.modelMethods.getContentModel(m.id, ctx.guid);
    const name = `Perm${tag(ctx).toUpperCase()}${ctx.r.int(1000)}`;
    full.fields.push({
      name,
      label: `Perm ${tag(ctx)}`,
      type: "Text",
      settings: {},
      itemOrder: full.fields.length,
      fieldID: null,
    });
    await ctx.c.modelMethods.saveModel(full, ctx.guid);
    (ctx.state.fields ??= []).push({ model: m.id, name });
    return { area: "models", change: "field-add", detail: `${full.referenceName}.${name}` };
  },

  async "model.field-label"(ctx) {
    const m = ctx.r.pick(await customModels(ctx.c, ctx.guid));
    if (!m) return null;
    const full = await ctx.c.modelMethods.getContentModel(m.id, ctx.guid);
    const f = ctx.r.pick(full.fields);
    if (!f) return null;
    f.label = `${f.label} (${tag(ctx)})`;
    await ctx.c.modelMethods.saveModel(full, ctx.guid);
    return { area: "models", change: "field-label", detail: `${full.referenceName}.${f.name}` };
  },

  // Renaming a field's reference name is what editors fear most: content is keyed by it.
  async "model.field-rename"(ctx) {
    const added = (ctx.state.fields ?? []).pop();
    const models = await customModels(ctx.c, ctx.guid);
    const m = added ? models.find((x) => x.id === added.model) : ctx.r.pick(models);
    if (!m) return null;
    const full = await ctx.c.modelMethods.getContentModel(m.id, ctx.guid);
    const f = added
      ? full.fields.find((x) => x.name === added.name)
      : ctx.r.pick(full.fields.filter((x) => x.type === "Text"));
    if (!f) return null;
    const old = f.name;
    f.name = `${old}Renamed${tag(ctx).toUpperCase()}`;
    await ctx.c.modelMethods.saveModel(full, ctx.guid);
    return { area: "models", change: "field-rename", detail: `${full.referenceName}.${old} → ${f.name}` };
  },
};

// Changes made on the other instance than the one being synced from, in the same round.
export async function drift(ctx) {
  return CHANGES["content.edit"]({ ...ctx });
}

// The same item edited on both sides with different values: a conflict.
export async function conflict(srcCtx, dstCtx, mappingLookup) {
  const pool = (await listsWithItems(srcCtx.c, srcCtx.guid, srcCtx.locale)).flatMap((x) => x.items);
  for (const it of pool) {
    const dstId = mappingLookup(it.contentID);
    if (!dstId) continue;
    const s = await srcCtx.c.contentMethods.getContentItem(it.contentID, srcCtx.guid, srcCtx.locale);
    const f = textField(s);
    if (!f) continue;
    const d = await dstCtx.c.contentMethods.getContentItem(dstId, dstCtx.guid, dstCtx.locale);
    if (typeof d.fields?.[f] !== "string") continue;
    const sv = `Conflict ${tag(srcCtx)} source`;
    const dv = `Conflict ${tag(srcCtx)} target`;
    s.fields[f] = sv;
    d.fields[f] = dv;
    await save(srcCtx.c, srcCtx.guid, srcCtx.locale, s);
    await save(dstCtx.c, dstCtx.guid, dstCtx.locale, d);
    return {
      area: "conflict",
      change: "both-sides-edit",
      detail: `#${it.contentID} ↔ #${dstId} field ${f}`,
      srcId: it.contentID,
      dstId,
      field: f,
      sv,
      dv,
    };
  }
  return null;
}

// Read one item's field on an instance (for checking conflict and drift outcomes).
export async function readField(c, guid, locale, id, field) {
  try {
    return (await c.contentMethods.getContentItem(id, guid, locale))?.fields?.[field];
  } catch {
    return undefined;
  }
}

export const QUICK_ROUNDS = [
  // Round 1, source → target
  ["content.edit", "content.add-chain", "content.reorder", "page.edit", "page.component-reorder", "model.field-add"],
  // Round 2, target → source (reverse sync)
  ["content.edit", "content.delete", "page.component-remove", "page.add", "model.field-label", "model.field-rename"],
];
