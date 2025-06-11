import path from 'path';
import fs from 'fs';
import { jest } from '@jest/globals';
import { SinglePassContentPusher } from '../lib/pushers/single-pass-content-pusher';
import { ContainerPusher } from '../lib/pushers/container-pusher';
import { ModelPusher } from '../lib/pushers/model-pusher';
import { ReferenceMapper } from '../lib/reference-mapper';
import { Auth } from '../lib/services/auth';
import { ApiClient, Options } from '@agility/management-sdk';
import { ComprehensiveAnalysisRunner } from '../lib/services/sync-analysis/comprehensive-analysis-runner';

// --- Real Test Setup ---
const SOURCE_GUID = '67bc73e6-u';
const TARGET_GUID = '13a8b394-u'; // Using a different, known-good test instance
const LOCALE = 'en-us';

let apiClient: ApiClient;
let referenceMapper: ReferenceMapper;
let modelPusher: ModelPusher;
let containerPusher: ContainerPusher;
let contentPusher: SinglePassContentPusher;

// --- Load Test Data ---
const basePath = path.resolve(process.cwd(), `agility-files/${SOURCE_GUID}/${LOCALE}/preview`);
const changelogModel = JSON.parse(fs.readFileSync(path.join(basePath, 'models/28.json'), 'utf8'));
const releaseModel = JSON.parse(fs.readFileSync(path.join(basePath, 'models/29.json'), 'utf8'));
const changelogContainer = JSON.parse(fs.readFileSync(path.join(basePath, 'containers/ChangeLog_ChangeLog.json'), 'utf8'));
const releaseContainer = JSON.parse(fs.readFileSync(path.join(basePath, 'containers/ChangeLog.json'), 'utf8'));
const contentItem1216 = JSON.parse(fs.readFileSync(path.join(basePath, 'item/1216.json'), 'utf8'));


describe('SinglePassContentPusher - E2E Tests', () => {
    beforeAll(async () => {
        // Use the real Auth service to get a token
        const auth = new Auth();
        const token = await auth.getToken();
        
        if (!token) {
            throw new Error("Authentication failed. Make sure you are logged in via the Agility CLI.");
        }

        const options: Options = {
            token: token,
            // Setting baseUrl to undefined to satisfy TypeScript while letting the SDK handle it.
            baseUrl: undefined, 
            refresh_token: '',
            duration: 0,
            retryCount: 3
        };

        apiClient = new ApiClient(options);
    });

    beforeEach(() => {
        referenceMapper = new ReferenceMapper('source-guid', 'target-guid');
        
        modelPusher = new ModelPusher({
            referenceMapper,
            apiClient,
            targetGuid: TARGET_GUID,
        });

        containerPusher = new ContainerPusher({
            referenceMapper,
            apiClient,
            targetGuid: TARGET_GUID,
        });

        contentPusher = new SinglePassContentPusher({
            referenceMapper,
            apiClient,
            targetGuid: TARGET_GUID,
            locale: LOCALE,
        });
    });

    it('should push models, containers, and content in the correct order', async () => {
        // Step 1: Push the models that our containers and content depend on
        console.log("Step 1: Pushing Models...");
        await modelPusher.process([releaseModel, changelogModel]);
        
        // Step 2: Push the containers
        console.log("Step 2: Pushing Containers...");
        await containerPusher.process([releaseContainer, changelogContainer]);

        // Step 3: Push the content item
        console.log("Step 3: Pushing content...");
        await contentPusher.process([contentItem1216]);

        // Step 4: Verify the final content mapping
        console.log("Step 4: Verifying mappings...");
        const mappedId = referenceMapper.getMapping('content', contentItem1216.contentID);
        expect(mappedId).toBeDefined();
        expect(typeof (mappedId as any).id).toBe('number'); // Expecting the new ID from the server
        console.log(`   ✅ Content item ${contentItem1216.contentID} mapped to new ID ${(mappedId as any).id}`);
        
    }, 60000); // Increase timeout for real API calls
}); 