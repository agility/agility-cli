import { foreignCdnReport } from "lib/content/foreign-cdn-report";
import { ForeignCdnDetector } from "lib/content/foreign-cdn-detector";
import { ContentFieldMapper } from "lib/content/content-field-mapper";
import { reportForeignCdnReferences } from "lib/pushers/content-pusher/util/report-foreign-cdn-references";

const SOURCE = "site-qa";
const TARGET = "site-cat";
const FOREIGN = "https://cdn-usa2.aglty.io/upstream-qa/hero-background-image.png";
const FOREIGN_TEXT = "https://cdn-usa2.aglty.io/upstream-qa/navigation-icons/contact-us-success-image.png";

const detector = new ForeignCdnDetector({ sourceContainers: [SOURCE], targetContainers: [TARGET], customHosts: [] });

function item(contentID: number, referenceName: string, fields: any): any {
  return { contentID, properties: { referenceName }, fields };
}

function makeLogger() {
  return { warning: jest.fn(), fileOnly: jest.fn() };
}

beforeEach(() => {
  foreignCdnReport.reset();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("foreignCdnReport", () => {
  it("dedupes to one entry per URL, aggregating items, fields and locales", () => {
    const logger = makeLogger();
    const opts = { sourceGuid: "src-u", targetGuid: "tgt-u", logger, detector };
    const banner = (id: number) =>
      item(id, "home_homebanner_homebanner", { mobileBackgroundImage: { label: "x", url: FOREIGN } });

    reportForeignCdnReferences([banner(474), banner(475)], "en-us", opts);
    reportForeignCdnReferences([banner(474)], "pt-br", opts);
    // the same item/locale/field scanned again (e.g. a second pass) is not a new occurrence
    reportForeignCdnReferences([banner(474)], "pt-br", opts);

    const entries = foreignCdnReport.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].container).toBe("upstream-qa");
    expect(entries[0].occurrences).toEqual([
      {
        contentID: 474,
        referenceName: "home_homebanner_homebanner",
        locale: "en-us",
        field: "mobileBackgroundImage",
        kind: "attachment",
      },
      {
        contentID: 475,
        referenceName: "home_homebanner_homebanner",
        locale: "en-us",
        field: "mobileBackgroundImage",
        kind: "attachment",
      },
      {
        contentID: 474,
        referenceName: "home_homebanner_homebanner",
        locale: "pt-br",
        field: "mobileBackgroundImage",
        kind: "attachment",
      },
    ]);
    expect(foreignCdnReport.getItemCount()).toBe(2);
    expect(foreignCdnReport.headline()).toBe("Foreign CDN references: 1 URL in 2 items");

    // console/log warning once per URL; further occurrences go to the log file only
    expect(logger.warning).toHaveBeenCalledTimes(1);
    expect(logger.warning.mock.calls[0][0]).toContain("references CDN container 'upstream-qa'");
    expect(logger.fileOnly).toHaveBeenCalledTimes(2);
  });

  it("distinguishes image/file fields from text fields in the message", () => {
    const opts = { sourceGuid: "src-u", targetGuid: "tgt-u", logger: makeLogger(), detector };
    reportForeignCdnReferences(
      [
        item(474, "banner", { img: { url: FOREIGN } }),
        item(1271, "contactus", { body: `<p><img src="${FOREIGN_TEXT}"></p>` }),
      ],
      "en-us",
      opts
    );

    const [attachment, text] = foreignCdnReport.toWarningDetails("src-u");
    expect(attachment.error).toContain(
      `references CDN container 'upstream-qa', which belongs to neither the source (${SOURCE}) nor the target (${TARGET}). The URL is passed through unchanged`
    );
    expect(attachment.error).toContain("image/file field, which the target may drop");
    expect(attachment.error).toContain("Repoint it at the source instance's own asset.");
    expect(attachment.error).not.toContain("text/rich-text field");
    expect(text.error).toContain("embedded in a text/rich-text field");
    expect(text.error).not.toContain("image/file field");
  });

  it("builds additive --jsonSummary warning entries, attachment-field URLs first", () => {
    const opts = { sourceGuid: "src-u", targetGuid: "tgt-u", logger: makeLogger(), detector };
    reportForeignCdnReferences(
      [
        item(1271, "contactus", { body: `<img src="${FOREIGN_TEXT}">` }),
        item(474, "banner", { img: { url: FOREIGN } }),
      ],
      "en-us",
      opts
    );

    const details = foreignCdnReport.toWarningDetails("src-u");
    expect(details.map((d) => d.url)).toEqual([FOREIGN, FOREIGN_TEXT]);
    expect(details[0]).toMatchObject({
      name: FOREIGN,
      type: "content",
      contentID: 474,
      guid: "src-u",
      locale: "en-us",
      code: "foreignCdnReference",
      container: "upstream-qa",
      references: [{ contentID: 474, referenceName: "banner", locale: "en-us", field: "img", kind: "attachment" }],
    });
    expect(details[0].error).toContain("Used by: banner #474 [en-us] img (image/file)");
  });

  it("renders the end-of-run summary block", () => {
    const opts = { sourceGuid: "src-u", targetGuid: "tgt-u", logger: makeLogger(), detector };
    reportForeignCdnReferences([item(474, "banner", { img: { url: FOREIGN } })], "en-us", opts);
    const lines = foreignCdnReport.renderSummaryLines();
    expect(lines[0]).toBe("Foreign CDN references: 1 URL in 1 item (non-blocking):");
    expect(lines.join("\n")).toContain(`• ${FOREIGN} — container 'upstream-qa', image/file field`);
    expect(lines.join("\n")).toContain("used by: banner #474 [en-us] img (image/file)");
  });

  it("records nothing for the instances' own containers or when a side is unknown", () => {
    const own = `https://cdn-usa2.aglty.io/${SOURCE}/a.png https://cdn.aglty.io/${TARGET}/b.png`;
    reportForeignCdnReferences(
      [item(1, "x", { body: own, img: { url: `https://cdn.aglty.io/${SOURCE}/c.png` } })],
      "en-us",
      {
        sourceGuid: "s",
        targetGuid: "t",
        detector,
      }
    );
    const unknownTarget = new ForeignCdnDetector({ sourceContainers: [SOURCE], targetContainers: [], customHosts: [] });
    reportForeignCdnReferences([item(2, "x", { img: { url: FOREIGN } })], "en-us", {
      sourceGuid: "s",
      targetGuid: "t",
      detector: unknownTarget,
    });
    expect(foreignCdnReport.hasEntries()).toBe(false);
    expect(foreignCdnReport.renderSummaryLines()).toEqual([]);
  });
});

describe("foreign CDN detection alongside ContentFieldMapper", () => {
  // Detection is reporting only: the payload the field mapper builds must be exactly what it
  // was before, for every field shape that can carry a foreign URL.
  const fields = {
    mobileBackgroundImage: {
      label: "Hero Image",
      url: FOREIGN,
      target: null,
      pixelHeight: null,
      pixelWidth: null,
    },
    attachments: [
      { label: "a", url: FOREIGN },
      { label: "b", url: "https://cdn.aglty.io/upstream-qa/b.pdf" },
    ],
    imagesrc: "https://cdn.aglty.io/othersite/footer/find-a-store.png",
    richText: `<p><img src="${FOREIGN_TEXT}?w=10&amp;h=5"></p>`,
  };

  const context = (): any => ({
    referenceMapper: { getContentItemMappingByContentID: jest.fn().mockReturnValue(null) },
    assetMapper: {
      getAssetMappingByMediaUrl: jest.fn().mockReturnValue(null),
      remapUrlByContainer: jest.fn().mockReturnValue(null),
      isKnownAssetUrl: jest.fn().mockReturnValue(false),
    },
  });

  it("finds every foreign reference while the mapped payload stays identical", () => {
    const original = JSON.parse(JSON.stringify(fields));
    const before = new ContentFieldMapper().mapContentFields(original, context());

    reportForeignCdnReferences([item(474, "banner", original)], "en-us", {
      sourceGuid: "s",
      targetGuid: "t",
      logger: makeLogger(),
      detector,
    });

    const after = new ContentFieldMapper().mapContentFields(original, context());
    expect(after).toEqual(before);
    expect(after.mappedFields).toEqual(fields);
    expect(original).toEqual(fields);

    const refs = foreignCdnReport.getEntries().flatMap((e) => e.occurrences.map((o) => `${o.field}:${o.kind}`));
    expect(refs.sort()).toEqual(
      [
        "attachments[0]:attachment",
        "attachments[1]:attachment",
        "imagesrc:text",
        "mobileBackgroundImage:attachment",
        "richText:text",
      ].sort()
    );
  });
});
