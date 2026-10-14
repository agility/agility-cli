import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resetState, setState } from "core/state";
import { foreignCdnReport } from "lib/content/foreign-cdn-report";
import {
  getForeignCdnDetector,
  reportForeignCdnReferences,
  resetForeignCdnDetectorCache,
} from "../report-foreign-cdn-references";

let tmpDir: string;

function writeJson(rel: string, data: any) {
  const file = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-foreign-cdn-"));
  resetState();
  setState({ rootPath: tmpDir });
  resetForeignCdnDetectorCache();
  foreignCdnReport.reset();
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  jest.restoreAllMocks();
});

describe("getForeignCdnDetector", () => {
  it("learns the source container from asset mappings and the target's from its pulled assets", () => {
    writeJson("mappings/src-u-tgt-u/assets/mappings.json", [
      {
        sourceMediaID: 1,
        targetMediaID: 2,
        sourceContainerEdgeUrl: "https://cdn.example-media.com/src-container",
        sourceContainerOriginUrl: "https://agility-cdn-usa2.azurewebsites.net/src-container",
      },
    ]);
    writeJson("tgt-u/assets/json/1.json", {
      assetMedias: [{ mediaID: 2, containerEdgeUrl: "https://cdn-usa2.aglty.io/tgt-container" }],
    });

    const detector = getForeignCdnDetector("src-u", "tgt-u");
    expect(detector.isEnabled()).toBe(true);
    expect(detector.sourceContainers).toEqual(["src-container"]);
    expect(detector.targetContainers).toEqual(["tgt-container"]);
    // the custom edge host is learned, so a third instance's container on it is recognised
    expect(detector.findForeignUrls("https://cdn.example-media.com/other/a.png").map((m) => m.container)).toEqual([
      "other",
    ]);
  });

  it("is disabled when the target has no assets and no mappings yet", () => {
    writeJson("src-u/assets/json/1.json", {
      assetMedias: [{ mediaID: 1, containerEdgeUrl: "https://cdn-usa2.aglty.io/src-container" }],
    });
    const detector = getForeignCdnDetector("src-u", "tgt-u");
    expect(detector.isEnabled()).toBe(false);

    reportForeignCdnReferences(
      [
        {
          contentID: 1,
          properties: { referenceName: "x" },
          fields: { img: { url: "https://cdn.aglty.io/other/a.png" } },
        } as any,
      ],
      "en-us",
      { sourceGuid: "src-u", targetGuid: "tgt-u" }
    );
    expect(foreignCdnReport.hasEntries()).toBe(false);
  });
});
