import * as fs from 'fs';
import * as path from 'path';
import { MockApiClient } from './mock-api-client';
import { ScenarioExpectations, ExpectedMapping, ExpectedModelMapping, ExpectedContainerMapping } from './scenario-loader';

/**
 * Read the resulting content item mappings file from a scenario's temp dir.
 * Returns [] if no mappings were ever written.
 */
export function readItemMappings(rootPath: string, sourceGuid: string, targetGuid: string, locale: string): any[] {
  const mappingFile = path.join(
    rootPath,
    'mappings',
    `${sourceGuid}-${targetGuid}`,
    locale,
    'item',
    'mappings.json'
  );
  if (!fs.existsSync(mappingFile)) return [];
  return JSON.parse(fs.readFileSync(mappingFile, 'utf8'));
}

export function readModelMappings(rootPath: string, sourceGuid: string, targetGuid: string): any[] {
  const mappingFile = path.join(
    rootPath,
    'mappings',
    `${sourceGuid}-${targetGuid}`,
    'models',
    'mappings.json'
  );
  if (!fs.existsSync(mappingFile)) return [];
  return JSON.parse(fs.readFileSync(mappingFile, 'utf8'));
}

export function readContainerMappings(rootPath: string, sourceGuid: string, targetGuid: string): any[] {
  const mappingFile = path.join(
    rootPath,
    'mappings',
    `${sourceGuid}-${targetGuid}`,
    'containers',
    'mappings.json'
  );
  if (!fs.existsSync(mappingFile)) return [];
  return JSON.parse(fs.readFileSync(mappingFile, 'utf8'));
}

/**
 * Apply a scenario's `expect` block against the actual outcome.
 * Each block is independently asserted so a single failure flags the right thing.
 */
export function assertScenarioOutcome(opts: {
  expectations: ScenarioExpectations;
  mockApi: MockApiClient;
  itemMappings: any[];
  modelMappings?: any[];
  containerMappings?: any[];
}): void {
  const { expectations, mockApi, itemMappings, modelMappings, containerMappings } = opts;

  if (expectations.apiCalls?.saveContentItems !== undefined) {
    expect(mockApi.contentMethods.saveContentItems).toHaveBeenCalledTimes(
      expectations.apiCalls.saveContentItems
    );
  }

  if (expectations.apiCalls?.saveModel !== undefined) {
    expect(mockApi.modelMethods.saveModel).toHaveBeenCalledTimes(
      expectations.apiCalls.saveModel
    );
  }

  if (expectations.apiCalls?.saveContainer !== undefined) {
    expect(mockApi.containerMethods.saveContainer).toHaveBeenCalledTimes(
      expectations.apiCalls.saveContainer
    );
  }

  if (expectations.noDuplicateMappingsBySourceID) {
    const seen = new Set<number>();
    const duplicates: number[] = [];
    for (const m of itemMappings) {
      if (seen.has(m.sourceContentID)) duplicates.push(m.sourceContentID);
      seen.add(m.sourceContentID);
    }
    expect(duplicates).toEqual([]);
  }

  if (expectations.mappings?.item) {
    assertMappingsMatch(itemMappings, expectations.mappings.item);
  }

  if (expectations.mappings?.model) {
    assertModelMappingsMatch(modelMappings ?? [], expectations.mappings.model);
  }

  if (expectations.mappings?.container) {
    assertContainerMappingsMatch(containerMappings ?? [], expectations.mappings.container);
  }
}

function assertMappingsMatch(actual: any[], expected: ExpectedMapping[]): void {
  expect(actual).toHaveLength(expected.length);
  for (const want of expected) {
    const match = actual.find((m) => m.sourceContentID === want.sourceContentID);
    expect(match).toBeDefined();
    if (want.targetContentID !== '__any__') {
      expect(match.targetContentID).toBe(want.targetContentID);
    }
  }
}

function assertModelMappingsMatch(actual: any[], expected: ExpectedModelMapping[]): void {
  expect(actual).toHaveLength(expected.length);
  for (const want of expected) {
    const match = actual.find((m) => m.sourceID === want.sourceID);
    expect(match).toBeDefined();
    if (want.targetID !== '__any__') {
      expect(match.targetID).toBe(want.targetID);
    }
    if (want.sourceReferenceName !== undefined) {
      expect(match.sourceReferenceName).toBe(want.sourceReferenceName);
    }
  }
}

function assertContainerMappingsMatch(actual: any[], expected: ExpectedContainerMapping[]): void {
  expect(actual).toHaveLength(expected.length);
  for (const want of expected) {
    const match = actual.find((m) => m.sourceContentViewID === want.sourceContentViewID);
    expect(match).toBeDefined();
    if (want.targetContentViewID !== '__any__') {
      expect(match.targetContentViewID).toBe(want.targetContentViewID);
    }
    if (want.sourceReferenceName !== undefined) {
      expect(match.sourceReferenceName).toBe(want.sourceReferenceName);
    }
  }
}
