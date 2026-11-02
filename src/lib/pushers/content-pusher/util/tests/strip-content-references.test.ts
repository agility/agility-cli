import { stripContentReferences } from "../strip-content-references";

// PROD-3076: pass 1 of a reference cycle blanks only the references to the given source IDs.

describe("stripContentReferences", () => {
  it("sets a single-item reference to -1 and leaves others alone", () => {
    const fields = { next: { contentid: 5, fulllist: false }, other: { contentid: 9, fulllist: false } };
    const { fields: out, stripped } = stripContentReferences(fields, new Set([5]));
    expect(out).toEqual({ next: { contentid: -1, fulllist: false }, other: { contentid: 9, fulllist: false } });
    expect(stripped).toBe(1);
  });

  it("handles contentID spelled with a capital D", () => {
    const { fields } = stripContentReferences({ link: { contentID: 5 } }, new Set([5]));
    expect(fields.link.contentID).toBe(-1);
  });

  it("removes only the given IDs from sortids", () => {
    const { fields, stripped } = stripContentReferences({ picks: { sortids: "3, 5,7" } }, new Set([5, 7]));
    expect(fields.picks.sortids).toBe("3");
    expect(stripped).toBe(2);
  });

  it("finds references nested in arrays and objects", () => {
    const fields = { rows: [{ cell: { contentid: 5 } }, { cell: { contentid: 6 } }] };
    const { fields: out, stripped } = stripContentReferences(fields, new Set([5, 6]));
    expect(out.rows.map((r: any) => r.cell.contentid)).toEqual([-1, -1]);
    expect(stripped).toBe(2);
  });

  it("removes the IDs from a companion field named by the model (PROD-2446)", () => {
    const model = { fields: [{ name: "Next", settings: { LinkeContentDropdownValueField: "NextID" } }] };
    const fields = { next: { contentid: 5, fulllist: false }, nextID: "5" };
    const { fields: out, stripped } = stripContentReferences(fields, new Set([5]), model);
    expect(out).toEqual({ next: { contentid: -1, fulllist: false }, nextID: "" });
    expect(stripped).toBe(2);
  });

  it("does not touch whole-list references or other values", () => {
    const fields = { list: { referencename: "posts", fulllist: true }, title: "5", count: 5 };
    const { fields: out, stripped } = stripContentReferences(fields, new Set([5]));
    expect(out).toEqual(fields);
    expect(stripped).toBe(0);
  });

  it("never modifies the input", () => {
    const fields = { next: { contentid: 5 }, picks: { sortids: "5,6" } };
    const before = JSON.stringify(fields);
    stripContentReferences(fields, new Set([5]));
    expect(JSON.stringify(fields)).toBe(before);
  });
});
