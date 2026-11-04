// Fixtures added to the source before the first sync, for cases the blog template doesn't have.
//
// Reference cycles (PROD-3076): content items that reference each other by content ID, and one
// that references itself. Neither side of a cycle can be saved on the target until the other has a
// target ID, so the CLI creates them with those references blank, then fills them in. The link
// field is required and has a companion field, the hardest shape: the server stores a required
// linked field blank without complaint, and the companion carries the same ID as a string.

const MODEL = "PermCycleNode";
const LIST = "PermCycleNodes";

const field = (name, type, settings, itemOrder) => ({
  name,
  label: name,
  type,
  settings,
  itemOrder,
  designerOnly: false,
  isDataField: true,
  editable: true,
  hiddenField: false,
  description: "",
  labelHelpDescription: "",
});

async function save(c, guid, locale, contentID, title, nextId) {
  const ids = await c.contentMethods.saveContentItem(
    {
      contentID,
      properties: { referenceName: LIST, definitionName: MODEL, itemOrder: 0 },
      fields: { title, ...(nextId ? { next: String(nextId), nextID: String(nextId) } : {}) },
      seo: null,
      scripts: null,
    },
    guid,
    locale
  );
  const id = Array.isArray(ids) ? ids[0] : ids;
  if (!(id > 0)) throw new Error(`save returned ${JSON.stringify(ids)}`);
  return id;
}

// Adds the model, the list, A <-> B and C -> C (all published). Returns the source content IDs.
export async function seedReferenceCycles(c, guid, locale) {
  const model = await c.modelMethods.saveModel(
    {
      id: 0,
      displayName: MODEL,
      referenceName: MODEL,
      contentDefinitionTypeID: 1,
      description: "Sync permutation test: content that references itself and each other (PROD-3076)",
      fields: [
        field("Title", "Text", { Required: "True", Length: "128" }, 0),
        field(
          "Next",
          "Content",
          {
            ContentDefinition: MODEL,
            RenderAs: "dropdown",
            ContentView: LIST,
            SharedContent: LIST,
            LinkeContentDropdownValueField: "NextID",
            DisplayColumn: "Title",
            Required: "True",
          },
          1
        ),
        field("NextID", "Text", { Required: "False", Length: "0" }, 2),
      ],
    },
    guid
  );
  await c.containerMethods.saveContainer(
    {
      contentViewID: -1,
      contentDefinitionID: model.id,
      referenceName: LIST,
      contentViewName: "Perm Cycle Nodes",
      contentDefinitionType: 1,
      contentDefinitionTypeID: 1,
      isShared: true,
      isDynamicPageList: false,
      requiresApproval: false,
      columns: [{ sortOrder: 0, fieldName: "title", label: "Title", isDefaultSort: false }],
    },
    guid
  );

  // The source has the same chicken-and-egg problem: create, then link.
  const a = await save(c, guid, locale, -1, "Cycle A");
  const b = await save(c, guid, locale, -1, "Cycle B", a);
  await save(c, guid, locale, a, "Cycle A", b);
  const self = await save(c, guid, locale, -1, "Cycle Self");
  await save(c, guid, locale, self, "Cycle Self", self);
  for (const id of [a, b, self]) await c.contentMethods.publishContent(id, guid, locale);

  // Each item and the source item its Next field must point at
  return {
    links: [
      [a, b],
      [b, a],
      [self, self],
    ],
  };
}

// Same rule as the CLI's Auth.determineBaseUrl / determineFetchUrl: the GUID suffix picks the region.
const REGIONS = [
  ["us2", "mgmt-usa2", "api-usa2"],
  ["d", "mgmt-dev", "api-dev"],
  ["u", "mgmt", "api"],
  ["c", "mgmt-ca", "api-ca"],
  ["e", "mgmt-eu", "api-eu"],
  ["a", "mgmt-aus", "api-aus"],
];
function hosts(guid) {
  const [, mgmt, api] = REGIONS.find(([suffix]) => guid.endsWith(suffix)) ?? ["", "mgmt", "api"];
  return { mgmt: `https://${mgmt}.aglty.io`, api: `https://${api}.aglty.io` };
}

// Content published through the Management API reaches the Fetch API's sync feed a minute or two
// later, and the CLI pulls from that feed. Wait until it lists every given item, or the timeout.
// Returns the seconds waited; throws on timeout.
export async function waitForFetchSync(token, guid, locale, ids, { timeoutMs = 10 * 60 * 1000 } = {}) {
  const { mgmt, api } = hosts(guid);
  const keyRes = await fetch(`${mgmt}/oauth/GetPreviewKey?guid=${guid}`, {
    headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" },
  });
  if (!keyRes.ok) throw new Error(`GetPreviewKey: HTTP ${keyRes.status}`);
  const apiKey = (await keyRes.text()).replace(/^"|"$/g, "");

  const started = Date.now();
  const missing = new Set(ids);
  while (Date.now() - started < timeoutMs) {
    // Read the whole feed from the start, a page at a time, as a full pull does
    let syncToken = 0;
    for (let page = 0; page < 100 && missing.size > 0; page++) {
      const res = await fetch(`${api}/${guid}/preview/${locale}/sync/items?syncToken=${syncToken}&pageSize=500`, {
        headers: { APIKey: apiKey, "Cache-Control": "no-cache" },
      });
      if (!res.ok) throw new Error(`Fetch API sync/items: HTTP ${res.status}`);
      const body = await res.json();
      for (const item of body.items ?? []) missing.delete(item.contentID);
      if (!body.items?.length || !body.syncToken || body.syncToken === syncToken) break;
      syncToken = body.syncToken;
    }
    if (missing.size === 0) return Math.round((Date.now() - started) / 1000);
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`items ${[...missing].join(", ")} not in the Fetch API sync feed after ${timeoutMs / 1000}s`);
}

// Each content item's latest version (contentItemID) in the Management API, by content ID. Taken
// before and after a round's edits, the difference is what the round changed.
export async function contentVersions(c, guid, locale) {
  const lists = (await c.containerMethods.getContainerList(guid)).filter(
    (x) => x.referenceName && x.contentDefinitionType === 1
  );
  const versions = new Map();
  for (const l of lists) {
    let rows = [];
    try {
      const r = await c.contentMethods.getContentItems(l.referenceName, guid, locale, {
        take: 250,
        skip: 0,
        filter: "",
        fields: "",
        sortDirection: "",
        sortField: "",
        showDeleted: false,
      });
      rows = (r?.items ?? []).flat(Infinity);
    } catch {
      continue;
    }
    for (const row of rows) {
      const id = row.contentID ?? row.itemContainerID;
      if (id > 0 && row.contentItemID > 0) versions.set(id, Math.max(versions.get(id) ?? 0, row.contentItemID));
    }
  }
  return versions;
}

// Items whose version went up (or that are new) between two contentVersions snapshots.
export function changedSince(before, after) {
  return new Map([...after].filter(([id, v]) => v > (before.get(id) ?? 0)));
}

// The Fetch API sync feed (a log of changes) lags the Management API, and every sync and verify
// reads it. Wait until it lists each given item at least at the given version, so a sync never acts
// on an edit it can't see yet. Returns the seconds waited; throws on timeout.
export async function waitForFetchVersions(token, guid, locale, wanted, { timeoutMs = 5 * 60 * 1000 } = {}) {
  if (wanted.size === 0) return 0;
  const { mgmt, api } = hosts(guid);
  const keyRes = await fetch(`${mgmt}/oauth/GetPreviewKey?guid=${guid}`, {
    headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" },
  });
  if (!keyRes.ok) throw new Error(`GetPreviewKey: HTTP ${keyRes.status}`);
  const apiKey = (await keyRes.text()).replace(/^"|"$/g, "");

  const started = Date.now();
  let behind = [];
  while (Date.now() - started < timeoutMs) {
    const have = new Map();
    let syncToken = 0;
    for (let page = 0; page < 100; page++) {
      const res = await fetch(`${api}/${guid}/preview/${locale}/sync/items?syncToken=${syncToken}&pageSize=500`, {
        headers: { APIKey: apiKey, "Cache-Control": "no-cache" },
      });
      if (!res.ok) throw new Error(`Fetch API sync/items: HTTP ${res.status}`);
      const body = await res.json();
      for (const item of body.items ?? []) {
        have.set(item.contentID, Math.max(have.get(item.contentID) ?? 0, item.properties?.versionID ?? 0));
      }
      if (!body.items?.length || !body.syncToken || body.syncToken === syncToken) break;
      syncToken = body.syncToken;
    }
    behind = [...wanted].filter(([id, v]) => (have.get(id) ?? 0) < v).map(([id]) => id);
    if (behind.length === 0) return Math.round((Date.now() - started) / 1000);
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`Fetch API still behind after ${timeoutMs / 1000}s on items ${behind.slice(0, 10).join(", ")}`);
}

// An order change reaches the Fetch API's sync feed later than the item's new version. Wait until
// the feed shows each given item at the given itemOrder. Returns the seconds waited; throws on timeout.
export async function waitForFetchItemOrder(token, guid, locale, items, { timeoutMs = 10 * 60 * 1000 } = {}) {
  if (!items.length) return 0;
  const { mgmt, api } = hosts(guid);
  const keyRes = await fetch(`${mgmt}/oauth/GetPreviewKey?guid=${guid}`, {
    headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" },
  });
  if (!keyRes.ok) throw new Error(`GetPreviewKey: HTTP ${keyRes.status}`);
  const apiKey = (await keyRes.text()).replace(/^"|"$/g, "");

  const started = Date.now();
  let behind = [];
  while (Date.now() - started < timeoutMs) {
    // The feed is a log: the last entry for an item is its current state
    const order = new Map();
    let syncToken = 0;
    for (let page = 0; page < 100; page++) {
      const res = await fetch(`${api}/${guid}/preview/${locale}/sync/items?syncToken=${syncToken}&pageSize=500`, {
        headers: { APIKey: apiKey, "Cache-Control": "no-cache" },
      });
      if (!res.ok) throw new Error(`Fetch API sync/items: HTTP ${res.status}`);
      const body = await res.json();
      for (const item of body.items ?? []) order.set(item.contentID, item.properties?.itemOrder);
      if (!body.items?.length || !body.syncToken || body.syncToken === syncToken) break;
      syncToken = body.syncToken;
    }
    behind = items.filter(([id, o]) => order.get(id) !== o).map(([id]) => id);
    if (behind.length === 0) return Math.round((Date.now() - started) / 1000);
    await new Promise((r) => setTimeout(r, 15_000));
  }
  throw new Error(`Fetch API still shows the old order after ${timeoutMs / 1000}s for items ${behind.join(", ")}`);
}

// After a sync: each target copy's Next (and NextID) must hold the TARGET ID of its partner.
export async function checkReferenceCycles(c, guid, locale, fixture, toTarget) {
  const problems = [];
  for (const [from, to] of fixture.links) {
    const id = toTarget(from);
    const expected = toTarget(to);
    if (!id || !expected) {
      problems.push(`#${from} or #${to} was not synced`);
      continue;
    }
    const fields = (await c.contentMethods.getContentItem(id, guid, locale))?.fields ?? {};
    const next = Number(fields.next?.contentid ?? fields.next);
    if (next !== expected || String(fields.nextID) !== String(expected)) {
      problems.push(`#${id} points at ${JSON.stringify(fields.next)} / ${fields.nextID}, expected ${expected}`);
    }
  }
  return problems;
}

// ── URL redirections (PROD-3078) ──────────────────────────────────────────────────────────────
// The Management SDK can only delete redirections, so these call the endpoints the CLI uses: the
// Management API's batch save to write, and the Fetch API's redirection list (what a pull reads).

async function previewKey(token, guid) {
  const { mgmt } = hosts(guid);
  const res = await fetch(`${mgmt}/oauth/GetPreviewKey?guid=${guid}`, {
    headers: { Authorization: `Bearer ${token}`, "Cache-Control": "no-cache" },
  });
  if (!res.ok) throw new Error(`GetPreviewKey: HTTP ${res.status}`);
  return (await res.text()).replace(/^"|"$/g, "");
}

const sameOrigin = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

// The instance's redirections as the Fetch API lists them.
export async function listRedirections(token, guid) {
  const { api } = hosts(guid);
  const res = await fetch(`${api}/${guid}/preview/urlredirection`, {
    headers: { APIKey: await previewKey(token, guid), "Cache-Control": "no-cache" },
  });
  if (!res.ok) throw new Error(`Fetch API urlredirection: HTTP ${res.status}`);
  const body = await res.json();
  return body.urlRedirections ?? body.items ?? [];
}

// Create (urlRedirectionID 0) or replace one redirection; returns its ID. A refusal is thrown.
export async function saveRedirection(token, guid, r) {
  const { mgmt } = hosts(guid);
  const res = await fetch(`${mgmt}/api/v1/instance/${guid}/url-redirections`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Cache-Control": "no-cache" },
    body: JSON.stringify([
      {
        urlRedirectionID: r.urlRedirectionID ?? 0,
        originUrl: r.originUrl,
        destinationUrl: r.destinationUrl,
        httpCode: r.statusCode ?? 301,
        destinationLocale: r.destinationLocale ?? null,
        originLocales: r.originLocales ?? null,
        content: r.content ?? null,
      },
    ]),
  });
  if (!res.ok) throw new Error(`url-redirections save: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const out = await res.json();
  const done = out.created?.[0] ?? out.updated?.[0];
  if (!done) throw new Error(`url-redirections save skipped it: ${out.skipped?.[0]?.reason ?? JSON.stringify(out)}`);
  return done.urlRedirectionID ?? r.urlRedirectionID;
}

// Wait until the Fetch API lists the redirection with this origin in the wanted state.
export async function waitForRedirection(token, guid, originUrl, test, { timeoutMs = 10 * 60 * 1000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = (await listRedirections(token, guid)).find((x) => sameOrigin(x.originUrl, originUrl));
    if (found && test(found)) return Math.round((Date.now() - started) / 1000);
    await new Promise((r) => setTimeout(r, 10_000));
  }
  throw new Error(`redirection ${originUrl} not in the wanted state in the Fetch API after ${timeoutMs / 1000}s`);
}

// One redirection on the source before the first sync, for later rounds to edit.
export async function seedRedirection(token, guid, seed) {
  const originUrl = `~/perm-redirect-${seed}`;
  const destinationUrl = "~/";
  await saveRedirection(token, guid, { originUrl, destinationUrl });
  const waited = await waitForRedirection(token, guid, originUrl, (x) => x.destinationUrl === destinationUrl);
  return { originUrl, waited };
}

// Point the redirection somewhere new on one instance, as an editor would; waits for the Fetch API.
export async function editRedirection(token, guid, originUrl, tag) {
  const current = (await listRedirections(token, guid)).find((x) => sameOrigin(x.originUrl, originUrl));
  if (!current) return null;
  const destinationUrl = `~/perm-${tag}`;
  await saveRedirection(token, guid, { ...current, urlRedirectionID: current.id, destinationUrl });
  const waited = await waitForRedirection(token, guid, originUrl, (x) => x.destinationUrl === destinationUrl);
  return {
    area: "redirections",
    change: "edit",
    detail: `${current.originUrl} → ${destinationUrl} (in the Fetch API after ${waited}s)`,
    entity: current.originUrl,
  };
}
