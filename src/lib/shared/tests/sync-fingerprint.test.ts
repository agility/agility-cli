import { transposeMappingRecord } from "../../../core/fileOperations";
import {
  FINGERPRINT_VERSION,
  decideSync,
  fingerprintFields,
  hashShape,
  hasFingerprint,
  stableStringify,
} from "../sync-fingerprint";

describe("stableStringify / hashShape", () => {
  it("serialises equal objects the same whatever their key order", () => {
    expect(stableStringify({ b: 1, a: { d: [1, 2], c: null } })).toBe(stableStringify({ a: { c: null, d: [1, 2] }, b: 1 }));
    expect(hashShape({ b: 1, a: 2 })).toBe(hashShape({ a: 2, b: 1 }));
  });

  it("keeps array order, and treats a missing key like an undefined one", () => {
    expect(hashShape([1, 2])).not.toBe(hashShape([2, 1]));
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
});

describe("decideSync", () => {
  const recorded = fingerprintFields("S", "T");

  it("is a skip whenever the two sides are the same now", () => {
    expect(decideSync(true, "S2", "T2", recorded)).toBe("skip");
    expect(decideSync(true, "S", "T", null)).toBe("skip");
  });

  it("lets the source win when there are no hashes, or hashes from another version", () => {
    expect(decideSync(false, "S2", "T", null)).toBe("update-unrecorded");
    expect(decideSync(false, "S2", "T", { sourceHash: "S", targetHash: "T" })).toBe("update-unrecorded");
    expect(decideSync(false, "S2", "T", { ...recorded, fingerprintVersion: FINGERPRINT_VERSION + 1 })).toBe(
      "update-unrecorded"
    );
  });

  it("follows the rule: source only updates, target only keeps, both conflict", () => {
    expect(decideSync(false, "S2", "T", recorded)).toBe("update");
    expect(decideSync(false, "S", "T2", recorded)).toBe("keep");
    expect(decideSync(false, "S2", "T2", recorded)).toBe("conflict");
  });

  it("waits on a side that still shows what the last sync replaced", () => {
    // The target pull predates the last sync's save
    expect(decideSync(false, "S", "OLD", { ...recorded, targetReplacedHash: "OLD" })).toBe("pending");
    // A reverse sync: its source pull predates the save
    expect(decideSync(false, "OLD", "T", { ...recorded, sourceReplacedHash: "OLD" })).toBe("pending");
    // A real change on the other side still counts
    expect(decideSync(false, "S2", "OLD", { ...recorded, targetReplacedHash: "OLD" })).toBe("update");
    expect(decideSync(false, "OLD", "T2", { ...recorded, sourceReplacedHash: "OLD" })).toBe("keep");
  });

  it("lets the source win when the sides differ but neither hash moved", () => {
    expect(decideSync(false, "S", "T", recorded)).toBe("update");
  });
});

describe("fingerprint fields on a mapping record", () => {
  it("hasFingerprint needs both hashes and the current version", () => {
    expect(hasFingerprint(fingerprintFields("S", "T"))).toBe(true);
    expect(hasFingerprint({ sourceHash: "S", fingerprintVersion: FINGERPRINT_VERSION })).toBe(false);
    expect(hasFingerprint(undefined)).toBe(false);
  });

  it("swap with the IDs when a reverse sync reads the record", () => {
    const record = { sourcePageTemplateID: 1, targetPageTemplateID: 2, ...fingerprintFields("S", "T") };
    expect(transposeMappingRecord(record)).toEqual({
      sourcePageTemplateID: 2,
      targetPageTemplateID: 1,
      sourceHash: "T",
      targetHash: "S",
      fingerprintVersion: FINGERPRINT_VERSION,
    });
  });
});
