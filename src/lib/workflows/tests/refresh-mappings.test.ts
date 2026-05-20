import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resetState, setState } from 'core/state';
import { state } from 'core/state';
import * as coreState from 'core/state';
import { refreshAndUpdateMappings } from '../refresh-mappings';
import * as fetchApiStatus from '../../shared/get-fetch-api-status';
import * as mappingVersionUpdater from '../../mappers/mapping-version-updater';
import { Pull } from '../../../core/pull';

let tmpDir: string;
beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agility-test-refresh-'));
});
afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
    resetState();
    state.rootPath = tmpDir;
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

function stubFetchApiSync() {
    return jest.spyOn(fetchApiStatus, 'waitForFetchApiSync').mockResolvedValue({
        synced: true,
        logLines: [],
        elapsed: 0,
    } as any);
}

function stubMappingUpdate() {
    return jest.spyOn(mappingVersionUpdater, 'updateMappingsAfterPublish').mockResolvedValue({
        contentMappingsUpdated: 1,
        pageMappingsUpdated: 1,
        errors: [],
        logLines: [],
    } as any);
}

function stubPullSuccess() {
    return jest.spyOn(Pull.prototype, 'pullInstances').mockResolvedValue({
        success: true,
        results: [],
        elapsedTime: 0,
    });
}

function stubPullFailure() {
    return jest.spyOn(Pull.prototype, 'pullInstances').mockResolvedValue({
        success: false,
        results: [],
        elapsedTime: 0,
    });
}

// ─── refreshAndUpdateMappings ─────────────────────────────────────────────────

describe('refreshAndUpdateMappings', () => {
    describe('when no valid API keys exist for the target', () => {
        it('skips pull and mapping updates when target has no API keys', async () => {
            state.apiKeys = []; // no keys

            const pullSpy = stubPullSuccess();
            const mappingSpy = stubMappingUpdate();

            await refreshAndUpdateMappings([], [], 'src-guid', 'tgt-guid', 'en-us');

            expect(pullSpy).not.toHaveBeenCalled();
            expect(mappingSpy).not.toHaveBeenCalled();
        });

        it('does not throw when no API keys exist', async () => {
            state.apiKeys = [];
            await expect(
                refreshAndUpdateMappings([], [], 'src-guid', 'tgt-guid', 'en-us')
            ).resolves.not.toThrow();
        });
    });

    describe('when valid API keys exist for the target', () => {
        beforeEach(() => {
            state.apiKeys = [{ guid: 'tgt-guid', previewKey: 'pk', fetchKey: 'fk' }];
        });

        it('calls pull.pullInstances on a successful flow', async () => {
            stubFetchApiSync();
            const pullSpy = stubPullSuccess();
            stubMappingUpdate();

            await refreshAndUpdateMappings([1], [2], 'src-guid', 'tgt-guid', 'en-us');

            expect(pullSpy).toHaveBeenCalledWith(true);
        });

        it('calls updateMappingsAfterPublish with correct args on success', async () => {
            stubFetchApiSync();
            stubPullSuccess();
            const mappingSpy = stubMappingUpdate();

            await refreshAndUpdateMappings([1, 2], [3], 'src-guid', 'tgt-guid', 'en-us');

            expect(mappingSpy).toHaveBeenCalledWith([1, 2], [3], 'src-guid', 'tgt-guid', 'en-us');
        });

        it('skips mapping updates when pull fails', async () => {
            stubFetchApiSync();
            stubPullFailure();
            const mappingSpy = stubMappingUpdate();

            await refreshAndUpdateMappings([1], [], 'src-guid', 'tgt-guid', 'en-us');

            expect(mappingSpy).not.toHaveBeenCalled();
        });

        it('does not throw when pull fails', async () => {
            stubFetchApiSync();
            stubPullFailure();

            await expect(
                refreshAndUpdateMappings([1], [], 'src-guid', 'tgt-guid', 'en-us')
            ).resolves.not.toThrow();
        });

        it('continues even when waitForFetchApiSync throws', async () => {
            jest.spyOn(fetchApiStatus, 'waitForFetchApiSync').mockRejectedValue(new Error('timeout'));
            const pullSpy = stubPullSuccess();
            stubMappingUpdate();

            await refreshAndUpdateMappings([1], [], 'src-guid', 'tgt-guid', 'en-us');

            expect(pullSpy).toHaveBeenCalled();
        });

        it('does not throw when updateMappingsAfterPublish rejects', async () => {
            stubFetchApiSync();
            stubPullSuccess();
            jest.spyOn(mappingVersionUpdater, 'updateMappingsAfterPublish').mockRejectedValue(
                new Error('mapping update failed')
            );

            await expect(
                refreshAndUpdateMappings([1], [], 'src-guid', 'tgt-guid', 'en-us')
            ).resolves.not.toThrow();
        });

        it('accepts publishLogLines and does not throw', async () => {
            stubFetchApiSync();
            stubPullSuccess();
            stubMappingUpdate();

            await expect(
                refreshAndUpdateMappings([1], [2], 'src-guid', 'tgt-guid', 'en-us', ['log line 1', 'log line 2'])
            ).resolves.not.toThrow();
        });

        it('creates the logs directory under rootPath/targetGuid/logs', async () => {
            stubFetchApiSync();
            stubPullSuccess();
            stubMappingUpdate();

            await refreshAndUpdateMappings([], [], 'src-guid', 'tgt-guid', 'en-us');

            const expectedLogDir = path.resolve(tmpDir, 'tgt-guid', 'logs');
            expect(fs.existsSync(expectedLogDir)).toBe(true);
        });
    });
});
