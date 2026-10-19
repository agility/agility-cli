import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { recordSavedTarget, resetState, setState } from "core/state";
import { ModelMapper } from "lib/mappers/model-mapper";
import { ContainerMapper } from "lib/mappers/container-mapper";
import { TemplateMapper } from "lib/mappers/template-mapper";
import { GalleryMapper } from "lib/mappers/gallery-mapper";
import { AssetMapper } from "lib/mappers/asset-mapper";

// getMappedEntity(…, "target") must return what was saved earlier in the run, not the target
// as pulled, and fall back to the pulled copy for anything not saved.

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agility-saved-target-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  resetState();
  setState({ rootPath: tmpDir });
  jest.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function writeTarget(relativePath: string, data: any) {
  const full = path.join(tmpDir, "tgt-st", relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(data));
}

const pair = { sourceGuid: "src-st", targetGuid: "tgt-st" };

describe("getMappedEntity reads entities saved this run before the pulled target", () => {
  it("models", () => {
    const mapping = { ...pair, sourceID: 1, targetID: 10, sourceLastModifiedDate: "", targetLastModifiedDate: "" };
    writeTarget("models/10.json", { id: 10, fields: [] });
    const mapper = new ModelMapper("src-st", "tgt-st");
    expect(mapper.getMappedEntity(mapping, "target")).toEqual({ id: 10, fields: [] });

    const saved = { id: 10, fields: [{ name: "Title" }] };
    recordSavedTarget("model", 1, saved, "Post");
    expect(mapper.getMappedEntity(mapping, "target")).toBe(saved);
  });

  it("containers", () => {
    const mapping = {
      ...pair,
      sourceContentViewID: 2,
      targetContentViewID: 20,
      sourceLastModifiedDate: "",
      targetLastModifiedDate: "",
    };
    writeTarget("containers/20.json", { contentViewID: 20, lastModifiedDate: "pulled" });
    const mapper = new ContainerMapper("src-st", "tgt-st");
    expect(mapper.getMappedEntity(mapping, "target")).toMatchObject({ lastModifiedDate: "pulled" });

    const saved = { contentViewID: 20, lastModifiedDate: "saved" };
    recordSavedTarget("container", 2, saved, "Posts");
    expect(mapper.getMappedEntity(mapping, "target")).toBe(saved);
  });

  it("templates", () => {
    const mapping = {
      ...pair,
      sourcePageTemplateID: 3,
      targetPageTemplateID: 30,
      sourcePageTemplateName: "Home",
      targetPageTemplateName: "Home",
    };
    writeTarget("templates/30.json", {
      pageTemplateID: 30,
      contentSectionDefinitions: [{ pageItemTemplateReferenceName: "Main" }],
    });
    const mapper = new TemplateMapper("src-st", "tgt-st");
    expect(mapper.getMappedEntity(mapping, "target")!.contentSectionDefinitions).toHaveLength(1);

    const saved = {
      pageTemplateID: 30,
      contentSectionDefinitions: [
        { pageItemTemplateReferenceName: "Banner" },
        { pageItemTemplateReferenceName: "Main" },
      ],
    };
    recordSavedTarget("template", 3, saved, "Home");
    expect(mapper.getMappedEntity(mapping, "target")).toBe(saved);
  });

  it("galleries", () => {
    const mapping = {
      ...pair,
      sourceMediaGroupingID: 4,
      targetMediaGroupingID: 40,
      sourceModifiedOn: "",
      targetModifiedOn: "",
    };
    const saved = { mediaGroupingID: 40, name: "Hero" };
    recordSavedTarget("gallery", 4, saved, "Hero");
    expect(new GalleryMapper("src-st", "tgt-st").getMappedEntity(mapping, "target")).toBe(saved);
  });

  it("assets", () => {
    const mapping = { ...pair, sourceMediaID: 5, targetMediaID: 50, sourceDateModified: "", targetDateModified: "" };
    const saved = { mediaID: 50, fileName: "hero.jpg" };
    recordSavedTarget("asset", 5, saved, "images/hero.jpg");
    expect(new AssetMapper("src-st", "tgt-st").getMappedEntity(mapping, "target")).toBe(saved);
  });

  it("never substitutes a saved target for the source side", () => {
    const mapping = { ...pair, sourceID: 6, targetID: 60, sourceLastModifiedDate: "", targetLastModifiedDate: "" };
    recordSavedTarget("model", 6, { id: 60, fields: [] }, "Post");
    expect(new ModelMapper("src-st", "tgt-st").getMappedEntity(mapping, "source")).toBeNull();
  });
});
