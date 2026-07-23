import { resetState } from "core/state";
import {
  extractContentBatchResults,
  extractPageBatchResults,
  logBatchError,
  prettyException,
  formatBatchItemError,
  CompletedBatch,
} from "../batch-polling";
import * as mgmtApi from "@agility/management-sdk";

const asBatch = (obj: Record<string, any>): CompletedBatch => obj as CompletedBatch;
const asContent = (obj: Record<string, any>): mgmtApi.ContentItem => obj as mgmtApi.ContentItem;

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── extractContentBatchResults — no batch items returned ────────────────────────────

describe("extractContentBatchResults — no items in batch", () => {
  it("marks all originalItems as failed when batch has no items array", () => {
    const originals = [{ contentID: 1 }, { contentID: 2 }] as mgmtApi.ContentItem[];
    const result = extractContentBatchResults(asBatch({}), originals);

    expect(result.failedItems).toHaveLength(2);
    expect(result.successfulItems).toHaveLength(0);
    result.failedItems.forEach((f) => {
      expect(f.error).toBe("No batch items returned");
    });
  });

  it("marks all originalItems as failed when batch.items is null", () => {
    const originals = [asContent({ contentID: 1 })] as mgmtApi.ContentItem[];
    const result = extractContentBatchResults(asBatch({ items: null }), originals);

    expect(result.failedItems).toHaveLength(1);
    expect(result.successfulItems).toHaveLength(0);
  });

  it("returns empty summary when batch has no totalItems field", () => {
    const result = extractContentBatchResults(asBatch({}), []);
    expect(result.summary).toBeUndefined();
  });
});

// ─── extractContentBatchResults — legacy items array (happy path) ────────────────────

describe("extractContentBatchResults — legacy items array", () => {
  it("classifies items with itemID > 0 as successful", () => {
    const batch = {
      items: [
        { itemID: 101, processedItemVersionID: 1 },
        { itemID: 102, processedItemVersionID: 1 },
      ],
    };
    const originals = [{ contentID: 1 }, { contentID: 2 }] as mgmtApi.ContentItem[];
    const result = extractContentBatchResults(asBatch(batch), originals);

    expect(result.successfulItems).toHaveLength(2);
    expect(result.failedItems).toHaveLength(0);
    expect(result.successfulItems[0].newId).toBe(101);
    expect(result.successfulItems[1].newId).toBe(102);
  });

  it("preserves originalItem reference in successful items", () => {
    const original = { contentID: 99 } as mgmtApi.ContentItem;
    const batch = { items: [{ itemID: 200, processedItemVersionID: 1 }] };
    const result = extractContentBatchResults(asBatch(batch), [original]);

    expect(result.successfulItems[0].originalItem).toBe(original);
  });

  it("classifies items with itemID <= 0 as failed", () => {
    const batch = { items: [{ itemID: 0 }] };
    const originals = [asContent({ contentID: 1 })] as mgmtApi.ContentItem[];
    const result = extractContentBatchResults(asBatch(batch), originals);

    expect(result.failedItems).toHaveLength(1);
    expect(result.successfulItems).toHaveLength(0);
  });

  it("uses errorMessage from item when available", () => {
    const batch = {
      items: [{ itemID: 0, errorMessage: '{"message":"field too long"}' }],
    };
    const result = extractContentBatchResults(asBatch(batch), [asContent({ contentID: 1 })]);

    expect(result.failedItems[0].error).toBe("field too long");
  });

  it("uses fallback error message when errorMessage is absent", () => {
    const batch = { items: [{ itemID: -1 }] };
    const result = extractContentBatchResults(asBatch(batch), [asContent({ contentID: 1 })]);

    expect(result.failedItems[0].error).toContain("Invalid ID");
  });

  it("marks item as failed when itemNull is set even if itemID > 0", () => {
    const batch = { items: [{ itemID: 5, itemNull: true }] };
    const result = extractContentBatchResults(asBatch(batch), [asContent({ contentID: 1 })]);

    expect(result.failedItems).toHaveLength(1);
    expect(result.successfulItems).toHaveLength(0);
  });
});

// ─── extractContentBatchResults — batch with extra failedItems field ─────────────────

describe("extractContentBatchResults — batch with failedItems field", () => {
  it("classifies items by itemID even when batch has a failedItems field", () => {
    const batch = {
      failedItems: [
        { batchItemId: 1, errorMessage: "Validation error", errorType: "ValidationException", itemType: "Content" },
      ],
      items: [{ itemID: 0, batchItemID: 1 }],
    };
    const result = extractContentBatchResults(asBatch(batch), [asContent({ contentID: 10 })]);

    expect(result.failedItems).toHaveLength(1);
    expect(result.failedItems[0].error).toContain("Validation error");
  });

  it("marks items with itemID > 0 as successful even when a failedItems field is present", () => {
    const batch = {
      failedItems: [{ batchItemId: 1, errorMessage: "error", errorType: "Error", itemType: "Content" }],
      items: [
        { itemID: 0, batchItemID: 1 },
        { itemID: 200, batchItemID: 2 },
      ],
    };
    const originals = [{ contentID: 1 }, { contentID: 2 }] as mgmtApi.ContentItem[];
    const result = extractContentBatchResults(asBatch(batch), originals);

    expect(result.successfulItems).toHaveLength(1);
    expect(result.successfulItems[0].newId).toBe(200);
    expect(result.failedItems).toHaveLength(1);
  });
});

// ─── extractContentBatchResults — summary field ──────────────────────────────────────

describe("extractContentBatchResults — summary", () => {
  it("includes summary when batch has totalItems", () => {
    const batch = {
      totalItems: 3,
      successCount: 2,
      failureCount: 1,
      durationMs: 500,
      items: [{ itemID: 1, processedItemVersionID: 1 }, { itemID: 2, processedItemVersionID: 1 }, { itemID: 0 }],
    };
    const originals = [{ contentID: 1 }, { contentID: 2 }, { contentID: 3 }] as mgmtApi.ContentItem[];
    const result = extractContentBatchResults(asBatch(batch), originals);

    expect(result.summary).toBeDefined();
    expect(result.summary!.totalItems).toBe(3);
    expect(result.summary!.successCount).toBe(2);
    expect(result.summary!.failureCount).toBe(1);
    expect(result.summary!.durationMs).toBe(500);
  });

  it("defaults successCount and failureCount to 0 when missing from batch", () => {
    const batch = { totalItems: 1, items: [{ itemID: 50, processedItemVersionID: 1 }] };
    const result = extractContentBatchResults(asBatch(batch), [asContent({ contentID: 1 })]);

    expect(result.summary!.successCount).toBe(0);
    expect(result.summary!.failureCount).toBe(0);
  });
});

// ─── extractContentBatchResults — empty originalItems edge cases ─────────────────────

describe("extractContentBatchResults — edge cases", () => {
  it("handles empty originals array without throwing", () => {
    const batch = { items: [] };
    expect(() => extractContentBatchResults(asBatch(batch), [])).not.toThrow();
  });

  it("returns empty results for empty batch and empty originals", () => {
    const result = extractContentBatchResults(asBatch({ items: [] }), []);
    expect(result.successfulItems).toHaveLength(0);
    expect(result.failedItems).toHaveLength(0);
  });
});

// ─── extractPageBatchResults ──────────────────────────────────────────────────

describe("extractPageBatchResults", () => {
  it("classifies page items with itemID > 0 as successful", () => {
    const batch = { items: [{ itemID: 10 }] };
    const originals = [{ pageID: 1 }] as mgmtApi.PageItem[];
    const result = extractPageBatchResults(asBatch(batch), originals);

    expect(result.successfulItems).toHaveLength(1);
    expect(result.successfulItems[0].newId).toBe(10);
  });

  it("preserves the PageItem reference in originalItem", () => {
    const original = { pageID: 99, title: "Home" } as mgmtApi.PageItem;
    const batch = { items: [{ itemID: 10 }] };
    const result = extractPageBatchResults(asBatch(batch), [original]);

    expect(result.successfulItems[0].originalItem).toBe(original);
  });

  it("classifies page items with itemID <= 0 as failed", () => {
    const batch = { items: [{ itemID: 0 }] };
    const result = extractPageBatchResults(asBatch(batch), [{ pageID: 1 }] as mgmtApi.PageItem[]);

    expect(result.failedItems).toHaveLength(1);
    expect(result.successfulItems).toHaveLength(0);
  });

  it("marks all pages as failed when batch has no items array", () => {
    const originals = [{ pageID: 1 }, { pageID: 2 }] as mgmtApi.PageItem[];
    const result = extractPageBatchResults(asBatch({}), originals);

    expect(result.failedItems).toHaveLength(2);
    expect(result.failedItems[0].error).toBe("No batch items returned");
    expect(result.successfulItems).toHaveLength(0);
  });

  it("uses errorMessage from item when available", () => {
    const batch = { items: [{ itemID: 0, errorMessage: '{"message":"page save failed"}' }] };
    const result = extractPageBatchResults(asBatch(batch), [{ pageID: 1 }] as mgmtApi.PageItem[]);

    expect(result.failedItems[0].error).toBe("page save failed");
  });

  it("classifies pages by itemID even when batch has a failedItems field", () => {
    const batch = {
      failedItems: [
        { batchItemId: 1, errorMessage: "Page validation error", errorType: "ValidationException", itemType: "Page" },
      ],
      items: [{ itemID: 0, batchItemID: 1 }],
    };
    const result = extractPageBatchResults(asBatch(batch), [{ pageID: 1 }] as mgmtApi.PageItem[]);

    expect(result.failedItems[0].error).toContain("Page validation error");
  });

  it("marks pages with itemID > 0 as successful even when a failedItems field is present", () => {
    const batch = {
      failedItems: [{ batchItemId: 1, errorMessage: "error", errorType: "Error", itemType: "Page" }],
      items: [
        { itemID: 0, batchItemID: 1 },
        { itemID: 50, batchItemID: 2 },
      ],
    };
    const originals = [{ pageID: 1 }, { pageID: 2 }] as mgmtApi.PageItem[];
    const result = extractPageBatchResults(asBatch(batch), originals);

    expect(result.successfulItems).toHaveLength(1);
    expect(result.successfulItems[0].newId).toBe(50);
    expect(result.failedItems).toHaveLength(1);
  });

  it("includes summary when batch has totalItems", () => {
    const batch = {
      totalItems: 2,
      successCount: 1,
      failureCount: 1,
      durationMs: 300,
      items: [{ itemID: 5 }, { itemID: 0 }],
    };
    const originals = [{ pageID: 1 }, { pageID: 2 }] as mgmtApi.PageItem[];
    const result = extractPageBatchResults(asBatch(batch), originals);

    expect(result.summary).toBeDefined();
    expect(result.summary!.totalItems).toBe(2);
    expect(result.summary!.successCount).toBe(1);
    expect(result.summary!.failureCount).toBe(1);
  });
});

// ─── logBatchError ─────────────────────────────────────────────────────────────

describe("logBatchError", () => {
  it("logs error message for a failed batch item", () => {
    const consoleSpy = jest.spyOn(console, "error");
    logBatchError({ itemID: 0, errorMessage: "Something went wrong" }, 0);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Item 0"));
  });

  it("logs batch item details", () => {
    const consoleSpy = jest.spyOn(console, "log");
    logBatchError({ itemID: 5, errorMessage: "error" }, 0);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Batch Item Details"));
  });

  it("does not throw when called without originalPayload", () => {
    expect(() => logBatchError({ itemID: 1, errorMessage: "error" }, 0)).not.toThrow();
  });

  it("logs originalPayload when provided", () => {
    const consoleSpy = jest.spyOn(console, "log");
    const payload = { contentID: 42, properties: { referenceName: "test-ref" } };
    logBatchError({ itemID: 0, errorMessage: "error" }, 0, payload);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Original Payload"));
  });
});

// ─── prettyException ───────────────────────────────────────────────────────────

describe("prettyException", () => {
  it("returns '' for empty/non-exception text", () => {
    expect(prettyException("")).toBe("");
    expect(prettyException("just a plain message")).toBe("");
  });

  it("keeps the (short) exception type and message", () => {
    expect(prettyException("System.NullReferenceException: Object reference not set to an instance of an object.")).toBe(
      "NullReferenceException: Object reference not set to an instance of an object."
    );
  });

  it("appends the server method from the first stack frame", () => {
    const dump = [
      "System.NullReferenceException: Object reference not set to an instance of an object.",
      "   at Agility.Shared.Engines.BatchProcessing.BatchInsertContentitem(String languageCode, BatchImportContentItem b) in D:\\x.cs:line 398",
      "   at Agility.Shared.Engines.BatchProcessing.BatchInsertContent(Batch batch) in D:\\y.cs:line 1212",
    ].join("\n");
    expect(prettyException(dump)).toBe(
      "NullReferenceException: Object reference not set to an instance of an object. [server: BatchInsertContentitem]"
    );
  });

  it("strips the namespace from the exception type", () => {
    expect(prettyException("Agility.Shared.Exceptions.ManagementValidationException: too long")).toBe(
      "ManagementValidationException: too long"
    );
  });
});

// ─── formatBatchItemError ──────────────────────────────────────────────────────

describe("formatBatchItemError", () => {
  it("prefixes the exception type when the message lacks it", () => {
    expect(formatBatchItemError("NullReferenceException", "Object reference not set to an instance of an object.")).toBe(
      "NullReferenceException: Object reference not set to an instance of an object."
    );
  });

  it("does not duplicate a type already present in the message", () => {
    expect(formatBatchItemError("ValidationException", "ValidationException: bad field")).toBe(
      "ValidationException: bad field"
    );
  });

  it("ignores a generic 'Error' type", () => {
    expect(formatBatchItemError("Error", "something broke")).toBe("something broke");
  });

  it("prefers a full exception dump in the message via prettyException", () => {
    const dump =
      "System.NullReferenceException: Object reference not set to an instance of an object.\n   at Foo.Bar.Baz(String x)";
    expect(formatBatchItemError("NullReferenceException", dump)).toBe(
      "NullReferenceException: Object reference not set to an instance of an object. [server: Baz]"
    );
  });

  it("falls back to 'Unknown error' when nothing is provided", () => {
    expect(formatBatchItemError(undefined, undefined)).toBe("Unknown error");
  });
});
