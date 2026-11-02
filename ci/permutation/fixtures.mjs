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
