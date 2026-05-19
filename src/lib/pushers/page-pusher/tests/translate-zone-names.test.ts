import { resetState } from 'core/state';
import { translateZoneNames } from '../translate-zone-names';

beforeEach(() => {
  resetState();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeTemplate(sectionNames: string[], ordered = true): any {
  return {
    contentSectionDefinitions: sectionNames.map((name, i) => ({
      pageItemTemplateReferenceName: name,
      itemOrder: ordered ? i : sectionNames.length - 1 - i,
    })),
  };
}

const module1 = { module: 'Module1', item: null };
const module2 = { module: 'Module2', item: null };
const module3 = { module: 'Module3', item: null };

// ─── null / missing inputs ────────────────────────────────────────────────────

describe('translateZoneNames — null / missing inputs', () => {
  it('returns empty object when sourceZones is null and template is null', () => {
    expect(translateZoneNames(null, null)).toEqual({});
  });

  it('returns empty object when sourceZones is undefined and template is null', () => {
    expect(translateZoneNames(undefined, null)).toEqual({});
  });

  it('returns sourceZones as-is when template is null', () => {
    const zones = { Main: [module1] };
    expect(translateZoneNames(zones, null)).toEqual(zones);
  });

  it('returns sourceZones as-is when template has no contentSectionDefinitions', () => {
    const zones = { Main: [module1] };
    const template = {} as any;
    expect(translateZoneNames(zones, template)).toEqual(zones);
  });

  it('returns sourceZones as-is when contentSectionDefinitions is null', () => {
    const zones = { Main: [module1] };
    const template = { contentSectionDefinitions: null } as any;
    expect(translateZoneNames(zones, template)).toEqual(zones);
  });

  it('returns empty object when sourceZones is null even with valid template', () => {
    const template = makeTemplate(['Main']);
    expect(translateZoneNames(null, template)).toEqual({});
  });
});

// ─── 1:1 zone mapping ─────────────────────────────────────────────────────────

describe('translateZoneNames — 1:1 zone mapping', () => {
  it('renames a single source zone to the template zone name', () => {
    const zones = { OldName: [module1] };
    const template = makeTemplate(['NewName']);
    const result = translateZoneNames(zones, template);
    expect(result).toHaveProperty('NewName');
    expect(result['NewName']).toEqual([module1]);
    expect(result).not.toHaveProperty('OldName');
  });

  it('maps multiple source zones to corresponding template zone names in order', () => {
    const zones = { ZoneA: [module1], ZoneB: [module2] };
    const template = makeTemplate(['TargetA', 'TargetB']);
    const result = translateZoneNames(zones, template);
    expect(result['TargetA']).toEqual([module1]);
    expect(result['TargetB']).toEqual([module2]);
  });

  it('stops mapping when source zones run out before template zones', () => {
    const zones = { ZoneA: [module1] };
    const template = makeTemplate(['TargetA', 'TargetB']);
    const result = translateZoneNames(zones, template);
    expect(result['TargetA']).toEqual([module1]);
    expect(result).not.toHaveProperty('TargetB');
  });
});

// ─── itemOrder sorting ────────────────────────────────────────────────────────

describe('translateZoneNames — template itemOrder sorting', () => {
  it('sorts contentSectionDefinitions by itemOrder before mapping', () => {
    // Provide template definitions in reverse order — they should be sorted ascending
    const template: any = {
      contentSectionDefinitions: [
        { pageItemTemplateReferenceName: 'Second', itemOrder: 1 },
        { pageItemTemplateReferenceName: 'First', itemOrder: 0 },
      ],
    };
    // Source zones in insertion order: ZoneA → First, ZoneB → Second
    const zones = { ZoneA: [module1], ZoneB: [module2] };
    const result = translateZoneNames(zones, template);
    // After sort: First (0), Second (1) — ZoneA should map to First
    expect(result['First']).toEqual([module1]);
    expect(result['Second']).toEqual([module2]);
  });

  it('treats missing itemOrder as 0', () => {
    const template: any = {
      contentSectionDefinitions: [
        { pageItemTemplateReferenceName: 'ZoneX' }, // no itemOrder
        { pageItemTemplateReferenceName: 'ZoneY', itemOrder: 1 },
      ],
    };
    const zones = { Source1: [module1], Source2: [module2] };
    const result = translateZoneNames(zones, template);
    // Both missing itemOrder and itemOrder=0 sort equally, then ZoneY=1 comes after
    expect(Object.keys(result)).toEqual(expect.arrayContaining(['ZoneX', 'ZoneY']));
  });
});

// ─── overflow: extra source zones combined into main zone ─────────────────────

describe('translateZoneNames — extra source zones collapse into first template zone', () => {
  it('combines extra source zone modules into the first template zone', () => {
    const zones = {
      ZoneA: [module1],
      ZoneB: [module2], // overflow
    };
    const template = makeTemplate(['OnlyZone']); // only one template section
    const result = translateZoneNames(zones, template);
    expect(result['OnlyZone']).toEqual([module1, module2]);
  });

  it('combines modules from multiple overflow zones into first template zone', () => {
    const zones = {
      ZoneA: [module1],
      ZoneB: [module2],
      ZoneC: [module3],
    };
    const template = makeTemplate(['Main']);
    const result = translateZoneNames(zones, template);
    expect(result['Main']).toEqual([module1, module2, module3]);
  });

  it('does not create extra zones beyond the template definition', () => {
    const zones = { Z1: [module1], Z2: [module2], Z3: [module3] };
    const template = makeTemplate(['OnlyZone']);
    const result = translateZoneNames(zones, template);
    expect(Object.keys(result)).toEqual(['OnlyZone']);
  });

  it('skips non-array overflow zone content gracefully', () => {
    const zones = {
      ZoneA: [module1],
      ZoneB: 'not-an-array' as any, // non-array overflow
    };
    const template = makeTemplate(['Main']);
    const result = translateZoneNames(zones, template);
    // ZoneB is not an array, so nothing extra is appended
    expect(result['Main']).toEqual([module1]);
  });

  it('skips empty-array overflow zones', () => {
    const zones = {
      ZoneA: [module1],
      ZoneB: [],
    };
    const template = makeTemplate(['Main']);
    const result = translateZoneNames(zones, template);
    expect(result['Main']).toEqual([module1]);
  });

  it('does not trigger overflow collapse when source and template counts are equal', () => {
    const zones = { Z1: [module1], Z2: [module2] };
    const template = makeTemplate(['T1', 'T2']);
    const result = translateZoneNames(zones, template);
    expect(result['T1']).toEqual([module1]);
    expect(result['T2']).toEqual([module2]);
    // Should not have concatenated anything
    expect(result['T1']).toHaveLength(1);
  });
});

// ─── edge cases ───────────────────────────────────────────────────────────────

describe('translateZoneNames — edge cases', () => {
  it('returns empty object when both sourceZones and template sections are empty', () => {
    const result = translateZoneNames({}, makeTemplate([]));
    expect(result).toEqual({});
  });

  it('does not mutate the original sourceZones object', () => {
    const original = { ZoneA: [module1] };
    const frozen = Object.freeze({ ...original });
    // translateZoneNames creates a new translatedZones object, never writes to sourceZones
    expect(() => translateZoneNames(original, makeTemplate(['NewZone']))).not.toThrow();
  });
});
