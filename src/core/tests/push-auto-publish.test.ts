/**
 * PROD-2782: executeAutoPublish republishes pages that a save in one locale put in staging in
 * another locale, alongside the pages the run saved.
 */
import { Push } from "../push";
import { resetState, setState, registerOtherLocaleStaging, clearOtherLocaleStagingRegistry } from "../state";

jest.mock("../../lib/workflows/process-batches", () => ({
  processBatches: jest.fn(async (ids: number[]) => ({ processedIds: ids, failed: 0 })),
}));
jest.mock("../../lib/mappers/mapping-version-updater", () => ({
  updateMappingsAfterPublish: jest.fn(async () => ({ result: { errors: [] } })),
}));
jest.mock("../../lib/shared/get-fetch-api-status", () => ({
  waitForFetchApiSync: jest.fn(async () => undefined),
}));
jest.mock("../pull", () => ({
  Pull: jest.fn().mockImplementation(() => ({ pullInstances: jest.fn(async () => ({ success: true })) })),
}));

import { processBatches } from "../../lib/workflows/process-batches";
import { updateMappingsAfterPublish } from "../../lib/mappers/mapping-version-updater";

const mockProcessBatches = processBatches as jest.Mock;
const mockUpdateMappings = updateMappingsAfterPublish as jest.Mock;

beforeEach(() => {
  resetState();
  clearOtherLocaleStagingRegistry();
  setState({ sourceGuid: "src", targetGuid: "tgt" });
  mockProcessBatches.mockClear();
  mockUpdateMappings.mockClear();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** The run saved page 98 in pt-br only; the pt-br save put page 98 in staging in en-us. */
function results(): any[] {
  return [
    {
      publishableContentIdsByLocale: new Map(),
      publishablePageIdsByLocale: new Map([["pt-br", [98, 40]]]),
    },
  ];
}

function pageCalls(): Array<[number[], string]> {
  return mockProcessBatches.mock.calls
    .filter((c: any[]) => c[1] === "pages")
    .map((c: any[]) => [c[0], c[2]] as [number[], string]);
}

describe("executeAutoPublish — pages another locale's save put in staging (PROD-2782)", () => {
  it("republishes the page in the locale it went to staging in, and updates its mapping", async () => {
    registerOtherLocaleStaging("en-us", { targetPageID: 98, pageName: "how-it-works", savedLocale: "pt-br" });

    const errors = await (new Push() as any).executeAutoPublish(results(), "both");

    expect(errors).toEqual([]);
    expect(pageCalls()).toEqual(
      expect.arrayContaining([
        [[98, 40], "pt-br"],
        [[98], "en-us"],
      ])
    );
    expect(mockUpdateMappings).toHaveBeenCalledWith([], [98], "src", "tgt", "en-us");
  });

  it("publishes a page once when the run also saved it in that locale", async () => {
    registerOtherLocaleStaging("pt-br", { targetPageID: 40, pageName: "promotions", savedLocale: "en-us" });

    await (new Push() as any).executeAutoPublish(results(), "pages");

    expect(pageCalls()).toEqual([[[98, 40], "pt-br"]]);
  });

  it("does not republish pages when auto-publish is content-only", async () => {
    registerOtherLocaleStaging("en-us", { targetPageID: 98, pageName: "how-it-works", savedLocale: "pt-br" });

    await (new Push() as any).executeAutoPublish(results(), "content");

    expect(pageCalls()).toEqual([]);
  });
});
