import { resetState } from "core/state";
import { hasValidMappings } from "../has-valid-mappings";

jest.mock("lib/mappers/container-mapper", () => ({
  ContainerMapper: jest.fn(),
}));

jest.mock("lib/mappers/model-mapper", () => ({
  ModelMapper: jest.fn(),
}));

beforeEach(() => {
  resetState();
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeItem(referenceName = "my-container", definitionName = "MyModel"): any {
  return {
    contentID: 1,
    properties: { referenceName, definitionName },
    fields: {},
  };
}

function makeContainerMapper(mappingResult: any, entityResult: any): any {
  return {
    getContainerMappingByReferenceName: jest.fn().mockReturnValue(mappingResult),
    getMappedEntity: jest.fn().mockReturnValue(entityResult),
  };
}

function makeModelMapper(mappingResult: any, entityResult: any): any {
  return {
    getModelMappingByReferenceName: jest.fn().mockReturnValue(mappingResult),
    getMappedEntity: jest.fn().mockReturnValue(entityResult),
  };
}

// ─── both valid ───────────────────────────────────────────────────────────────

describe("hasValidMappings — both container and model valid", () => {
  it("returns true when both container and model are found", () => {
    const containerMapper = makeContainerMapper({ sourceContentViewID: 1 }, { contentViewID: 1 });
    const modelMapper = makeModelMapper({ sourceID: 10 }, { id: 10 });
    expect(hasValidMappings(makeItem(), containerMapper, modelMapper)).toBe(true);
  });

  it("passes lowercased referenceName to containerMapper", () => {
    const containerMapper = makeContainerMapper({ sourceContentViewID: 1 }, { contentViewID: 1 });
    const modelMapper = makeModelMapper({ sourceID: 10 }, { id: 10 });
    const item = makeItem("MyContainer", "MyModel");
    hasValidMappings(item, containerMapper, modelMapper);
    expect(containerMapper.getContainerMappingByReferenceName).toHaveBeenCalledWith("mycontainer", "source");
  });

  it("passes lowercased definitionName to modelMapper", () => {
    const containerMapper = makeContainerMapper({ sourceContentViewID: 1 }, { contentViewID: 1 });
    const modelMapper = makeModelMapper({ sourceID: 10 }, { id: 10 });
    const item = makeItem("MyContainer", "MyModel");
    hasValidMappings(item, containerMapper, modelMapper);
    expect(modelMapper.getModelMappingByReferenceName).toHaveBeenCalledWith("mymodel", "source");
  });
});

// ─── container missing ────────────────────────────────────────────────────────

describe("hasValidMappings — container missing", () => {
  it("returns false when container mapping is not found", () => {
    const containerMapper = makeContainerMapper(null, null);
    const modelMapper = makeModelMapper({ sourceID: 10 }, { id: 10 });
    expect(hasValidMappings(makeItem(), containerMapper, modelMapper)).toBe(false);
  });

  it("returns false when container entity is null even if mapping exists", () => {
    const containerMapper = makeContainerMapper({ sourceContentViewID: 1 }, null);
    const modelMapper = makeModelMapper({ sourceID: 10 }, { id: 10 });
    expect(hasValidMappings(makeItem(), containerMapper, modelMapper)).toBe(false);
  });
});

// ─── model missing ────────────────────────────────────────────────────────────

describe("hasValidMappings — model missing", () => {
  it("returns false when model mapping is not found", () => {
    const containerMapper = makeContainerMapper({ sourceContentViewID: 1 }, { contentViewID: 1 });
    const modelMapper = makeModelMapper(null, null);
    expect(hasValidMappings(makeItem(), containerMapper, modelMapper)).toBe(false);
  });

  it("returns false when model entity is null even if mapping exists", () => {
    const containerMapper = makeContainerMapper({ sourceContentViewID: 1 }, { contentViewID: 1 });
    const modelMapper = makeModelMapper({ sourceID: 10 }, null);
    expect(hasValidMappings(makeItem(), containerMapper, modelMapper)).toBe(false);
  });
});

// ─── both missing ────────────────────────────────────────────────────────────

describe("hasValidMappings — both missing", () => {
  it("returns false when both container and model are missing", () => {
    const containerMapper = makeContainerMapper(null, null);
    const modelMapper = makeModelMapper(null, null);
    expect(hasValidMappings(makeItem(), containerMapper, modelMapper)).toBe(false);
  });
});

// ─── case insensitivity ───────────────────────────────────────────────────────

describe("hasValidMappings — case insensitivity", () => {
  it.each([
    ["ALL_UPPER", "UPPERCASE-REF", "UPPERCASE-MODEL"],
    ["mixed case", "Mixed-Ref", "MixedModel"],
    ["all lower", "lower-ref", "lowermodel"],
  ])("lowercases %s reference names before lookup", (_label, refName, defName) => {
    const containerMapper = makeContainerMapper({ sourceContentViewID: 1 }, { contentViewID: 1 });
    const modelMapper = makeModelMapper({ sourceID: 10 }, { id: 10 });
    const item = makeItem(refName, defName);
    hasValidMappings(item, containerMapper, modelMapper);
    expect(containerMapper.getContainerMappingByReferenceName).toHaveBeenCalledWith(refName.toLowerCase(), "source");
    expect(modelMapper.getModelMappingByReferenceName).toHaveBeenCalledWith(defName.toLowerCase(), "source");
  });
});
