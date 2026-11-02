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
