import { resetState, setState } from 'core/state';
import {
  DOWNLOAD_OPERATIONS,
  DownloadOperationsRegistry,
  OperationConfig,
} from 'lib/downloaders/download-operations-config';

beforeEach(() => {
  resetState();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── DOWNLOAD_OPERATIONS constant ─────────────────────────────────────────────

describe('DOWNLOAD_OPERATIONS', () => {
  it('defines entries for all expected operation keys', () => {
    const expectedKeys = ['syncSDK', 'galleries', 'assets', 'models', 'templates', 'containers', 'sitemaps'];
    for (const key of expectedKeys) {
      expect(DOWNLOAD_OPERATIONS).toHaveProperty(key);
    }
  });

  it('each operation has a name, description, handler, and elements array', () => {
    for (const [key, op] of Object.entries(DOWNLOAD_OPERATIONS)) {
      expect(typeof op.name).toBe('string');
      expect(typeof op.description).toBe('string');
      expect(typeof op.handler).toBe('function');
      expect(Array.isArray(op.elements)).toBe(true);
      expect(op.elements.length).toBeGreaterThan(0);
    }
  });

  it('each operation handler is a function that accepts a guid string', () => {
    for (const op of Object.values(DOWNLOAD_OPERATIONS)) {
      expect(op.handler.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('optional dependencies field is an array when present', () => {
    for (const op of Object.values(DOWNLOAD_OPERATIONS)) {
      if (op.dependencies !== undefined) {
        expect(Array.isArray(op.dependencies)).toBe(true);
      }
    }
  });

  describe('syncSDK operation', () => {
    it('has Content and Sitemaps in elements', () => {
      expect(DOWNLOAD_OPERATIONS.syncSDK.elements).toContain('Content');
      expect(DOWNLOAD_OPERATIONS.syncSDK.elements).toContain('Sitemaps');
    });

    it('has Models and Containers in its dependencies', () => {
      expect(DOWNLOAD_OPERATIONS.syncSDK.dependencies).toContain('Models');
      expect(DOWNLOAD_OPERATIONS.syncSDK.dependencies).toContain('Containers');
    });
  });

  describe('containers operation', () => {
    it('has Models as a dependency', () => {
      expect(DOWNLOAD_OPERATIONS.containers.dependencies).toContain('Models');
    });
  });

  describe('assets operation', () => {
    it('has Galleries as a dependency', () => {
      expect(DOWNLOAD_OPERATIONS.assets.dependencies).toContain('Galleries');
    });
  });
});

// ─── DownloadOperationsRegistry.getOperationsForElements ──────────────────────

describe('DownloadOperationsRegistry.getOperationsForElements', () => {
  it('returns all operations when fromPush is true', () => {
    const ops = DownloadOperationsRegistry.getOperationsForElements(true);
    expect(ops.length).toBe(Object.keys(DOWNLOAD_OPERATIONS).length);
  });

  it('returns only operations matching state.elements when fromPush is false', () => {
    setState({ elements: 'Models' });
    const ops = DownloadOperationsRegistry.getOperationsForElements(false);
    const names = ops.map((o: OperationConfig) => o.name);
    expect(names).toContain('downloadAllModels');
  });

  it('auto-includes dependency operations when fromPush is false', () => {
    // Requesting Content triggers Models and Containers auto-inclusion
    setState({ elements: 'Content' });
    const ops = DownloadOperationsRegistry.getOperationsForElements(false);
    const names = ops.map((o: OperationConfig) => o.name);
    expect(names).toContain('downloadAllModels');
    expect(names).toContain('downloadAllContainers');
  });

  it('returns all operations when no state.elements is set (full default list)', () => {
    // resetState sets elements to full default string
    const ops = DownloadOperationsRegistry.getOperationsForElements(false);
    expect(ops.length).toBeGreaterThan(0);
  });

  it('each returned operation conforms to the OperationConfig shape', () => {
    const ops = DownloadOperationsRegistry.getOperationsForElements(false);
    for (const op of ops) {
      expect(typeof op.name).toBe('string');
      expect(typeof op.handler).toBe('function');
      expect(Array.isArray(op.elements)).toBe(true);
    }
  });

  it('returns empty array when state.elements requests only unknown elements', () => {
    setState({ elements: 'NonExistentElement' });
    const ops = DownloadOperationsRegistry.getOperationsForElements(false);
    expect(ops).toHaveLength(0);
  });
});

// ─── DownloadOperationsRegistry dependency resolution (private via public API) ─

describe('DownloadOperationsRegistry dependency resolution', () => {
  it('does not duplicate operations when element already has its dependency in elements list', () => {
    // Both Content and Models are listed — Models should appear only once
    setState({ elements: 'Content,Models' });
    const ops = DownloadOperationsRegistry.getOperationsForElements(false);
    const modelOps = ops.filter((o: OperationConfig) => o.name === 'downloadAllModels');
    expect(modelOps.length).toBe(1);
  });

  it('resolves multiple levels of dependencies (Assets → Galleries)', () => {
    setState({ elements: 'Assets' });
    const ops = DownloadOperationsRegistry.getOperationsForElements(false);
    const names = ops.map((o: OperationConfig) => o.name);
    expect(names).toContain('downloadAllGalleries');
  });
});
