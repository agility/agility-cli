import { resetState, setState } from 'core/state';
import { PUSH_OPERATIONS, PushOperationsRegistry } from '../push-operations-config';

beforeEach(() => {
  resetState();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── PUSH_OPERATIONS registry shape ──────────────────────────────────────────

describe('PUSH_OPERATIONS registry', () => {
  it('exports all expected operation keys', () => {
    const keys = Object.keys(PUSH_OPERATIONS);
    expect(keys).toContain('galleries');
    expect(keys).toContain('assets');
    expect(keys).toContain('models');
    expect(keys).toContain('containers');
    expect(keys).toContain('content');
    expect(keys).toContain('templates');
    expect(keys).toContain('pages');
  });

  it.each([
    'galleries', 'assets', 'models', 'containers', 'content', 'templates', 'pages'
  ])('%s operation has required fields', (key) => {
    const op = PUSH_OPERATIONS[key];
    expect(op.name).toBeTruthy();
    expect(op.description).toBeTruthy();
    expect(typeof op.handler).toBe('function');
    expect(Array.isArray(op.elements)).toBe(true);
    expect(op.elements.length).toBeGreaterThan(0);
    expect(typeof op.dataKey).toBe('string');
  });

  it('galleries operation targets Galleries element', () => {
    expect(PUSH_OPERATIONS.galleries.elements).toContain('Galleries');
    expect(PUSH_OPERATIONS.galleries.dataKey).toBe('galleries');
  });

  it('assets operation targets Assets element', () => {
    expect(PUSH_OPERATIONS.assets.elements).toContain('Assets');
    expect(PUSH_OPERATIONS.assets.dataKey).toBe('assets');
  });

  it('models operation targets Models element', () => {
    expect(PUSH_OPERATIONS.models.elements).toContain('Models');
    expect(PUSH_OPERATIONS.models.dataKey).toBe('models');
  });

  it('containers operation targets Containers element', () => {
    expect(PUSH_OPERATIONS.containers.elements).toContain('Containers');
    expect(PUSH_OPERATIONS.containers.dataKey).toBe('containers');
  });

  it('content operation targets Content element', () => {
    expect(PUSH_OPERATIONS.content.elements).toContain('Content');
    expect(PUSH_OPERATIONS.content.dataKey).toBe('content');
  });

  it('templates operation targets Templates element', () => {
    expect(PUSH_OPERATIONS.templates.elements).toContain('Templates');
    expect(PUSH_OPERATIONS.templates.dataKey).toBe('templates');
  });

  it('pages operation targets Pages element', () => {
    expect(PUSH_OPERATIONS.pages.elements).toContain('Pages');
    expect(PUSH_OPERATIONS.pages.dataKey).toBe('pages');
  });
});

// ─── PushOperationsRegistry.getAllOperations ──────────────────────────────────

describe('PushOperationsRegistry.getAllOperations', () => {
  it('returns 7 operations total', () => {
    const ops = PushOperationsRegistry.getAllOperations();
    expect(ops).toHaveLength(7);
  });

  it('each operation has a handler function', () => {
    const ops = PushOperationsRegistry.getAllOperations();
    ops.forEach((op) => {
      expect(typeof op.handler).toBe('function');
    });
  });
});

// ─── PushOperationsRegistry.getOperationByName ───────────────────────────────

describe('PushOperationsRegistry.getOperationByName', () => {
  it('finds pushGalleries by name', () => {
    const op = PushOperationsRegistry.getOperationByName('pushGalleries');
    expect(op).toBeDefined();
    expect(op!.name).toBe('pushGalleries');
  });

  it('finds pushModels by name', () => {
    const op = PushOperationsRegistry.getOperationByName('pushModels');
    expect(op).toBeDefined();
    expect(op!.name).toBe('pushModels');
  });

  it('returns undefined for unknown name', () => {
    const op = PushOperationsRegistry.getOperationByName('nonexistent');
    expect(op).toBeUndefined();
  });
});

// ─── PushOperationsRegistry.getOperationsByElement ───────────────────────────

describe('PushOperationsRegistry.getOperationsByElement', () => {
  it('returns the galleries operation for Galleries element', () => {
    const ops = PushOperationsRegistry.getOperationsByElement('Galleries');
    expect(ops).toHaveLength(1);
    expect(ops[0].name).toBe('pushGalleries');
  });

  it('returns the assets operation for Assets element', () => {
    const ops = PushOperationsRegistry.getOperationsByElement('Assets');
    expect(ops).toHaveLength(1);
    expect(ops[0].name).toBe('pushAssets');
  });

  it('returns empty array for unknown element', () => {
    const ops = PushOperationsRegistry.getOperationsByElement('UnknownElement');
    expect(ops).toHaveLength(0);
  });
});

// ─── PushOperationsRegistry.getOperationsForElements — dependency resolution ──

describe('PushOperationsRegistry.getOperationsForElements', () => {
  it('returns all operations when elements contains all types', () => {
    setState({ elements: 'Galleries,Assets,Models,Containers,Content,Templates,Pages' });
    const ops = PushOperationsRegistry.getOperationsForElements();
    expect(ops.length).toBeGreaterThanOrEqual(7);
  });

  it('includes Galleries when only Assets is requested (dependency resolution)', () => {
    setState({ elements: 'Assets' });
    const ops = PushOperationsRegistry.getOperationsForElements();
    const names = ops.map((o) => o.name);
    expect(names).toContain('pushAssets');
    // Dependency: Assets depends on Galleries
    expect(names).toContain('pushGalleries');
  });

  it('includes Models when only Containers is requested', () => {
    setState({ elements: 'Containers' });
    const ops = PushOperationsRegistry.getOperationsForElements();
    const names = ops.map((o) => o.name);
    expect(names).toContain('pushContainers');
    expect(names).toContain('pushModels');
  });

  it('returns at least the models operation for Models-only elements', () => {
    setState({ elements: 'Models' });
    const ops = PushOperationsRegistry.getOperationsForElements();
    const names = ops.map((o) => o.name);
    expect(names).toContain('pushModels');
  });

  it('uses all default elements when state.elements is empty string', () => {
    setState({ elements: '' });
    const ops = PushOperationsRegistry.getOperationsForElements();
    // Should include all default elements
    const names = ops.map((o) => o.name);
    expect(names).toContain('pushGalleries');
    expect(names).toContain('pushModels');
    expect(names).toContain('pushPages');
  });
});
