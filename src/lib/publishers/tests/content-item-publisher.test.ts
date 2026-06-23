import { resetState, setState } from "core/state";

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

import { publishContentItem } from "lib/publishers/content-item-publisher";

// ─── publishContentItem ───────────────────────────────────────────────────────

describe("publishContentItem", () => {
  describe("guard clause: no API client", () => {
    it("returns success:false when getApiClient throws (no token set)", async () => {
      const result = await publishContentItem(1, "en-us");
      expect(result.success).toBe(false);
      expect(result.contentId).toBe(1);
      expect(result.error).toBeDefined();
    });
  });

  describe("guard clause: targetGuid array is empty", () => {
    it("returns success:false with error message when targetGuid is []", async () => {
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        contentMethods: { publishContent: jest.fn() },
      });

      const result = await publishContentItem(50, "en-us");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Target GUID not available in state");
    });
  });

  describe("guard clause: empty locale", () => {
    it("returns success:false when locale is an empty string", async () => {
      setState({ targetGuid: "test-guid-u" });
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        contentMethods: { publishContent: jest.fn().mockResolvedValue({}) },
      });

      const result = await publishContentItem(10, "");
      expect(result.success).toBe(false);
      expect(result.contentId).toBe(10);
      expect(result.error).toContain("Locale");
    });
  });

  describe("happy path", () => {
    it("returns success:true with original contentId when API resolves", async () => {
      setState({ targetGuid: "test-guid-u" });
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        contentMethods: { publishContent: jest.fn().mockResolvedValue({ ok: true }) },
      });

      const result = await publishContentItem(200, "en-us");
      expect(result.success).toBe(true);
      expect(result.contentId).toBe(200);
      expect(result.error).toBeUndefined();
    });

    it("calls contentMethods.publishContent with (contentId, targetGuid[0], locale)", async () => {
      setState({ targetGuid: "my-target" });
      const mockPublish = jest.fn().mockResolvedValue({});
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        contentMethods: { publishContent: mockPublish },
      });

      await publishContentItem(42, "fr-ca");
      expect(mockPublish).toHaveBeenCalledWith(42, "my-target", "fr-ca");
    });
  });

  describe("API error handling", () => {
    it("returns success:false with the error message when API rejects", async () => {
      setState({ targetGuid: "test-guid-u" });
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        contentMethods: {
          publishContent: jest.fn().mockRejectedValue(new Error("Content publish failed")),
        },
      });

      const result = await publishContentItem(7, "en-us");
      expect(result.success).toBe(false);
      expect(result.contentId).toBe(7);
      expect(result.error).toBe("Content publish failed");
    });

    it('returns "Unknown publishing error" when error has no message', async () => {
      setState({ targetGuid: "test-guid-u" });
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        contentMethods: {
          publishContent: jest.fn().mockRejectedValue({}),
        },
      });

      const result = await publishContentItem(8, "en-us");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Unknown publishing error");
    });
  });

  describe("return shape", () => {
    it.each([1, 500, 99999])("preserves contentId %i as a number in the result", async (id) => {
      setState({ targetGuid: "test-guid-u" });
      jest.spyOn(require("core/state"), "getApiClient").mockReturnValue({
        contentMethods: { publishContent: jest.fn().mockResolvedValue({}) },
      });

      const result = await publishContentItem(id, "en-us");
      expect(result.contentId).toBe(id);
      expect(typeof result.contentId).toBe("number");
    });
  });
});
