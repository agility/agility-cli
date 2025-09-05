import {
  runCLICommand,
  loadTestEnvironment,
  cleanupTestFiles,
  validateDownloadedFiles,
} from '../utils/cli-test-utils';
import path from 'path';

describe('Advanced Pull Command Tests', () => {
  let testEnv: ReturnType<typeof loadTestEnvironment>;

  beforeAll(async () => {
    try {
      testEnv = loadTestEnvironment();
      console.log(
        `✅ Test environment loaded: GUID=${testEnv.guid.substring(0, 8)}..., TOKEN=${testEnv.token.substring(0, 8)}...`
      );
    } catch (error) {
      console.warn('❌ Skipping advanced pull tests: Test environment not configured');
      console.warn(
        '📝 For local development: Edit .env.test.local with your actual AGILITY_GUID and AGILITY_TOKEN'
      );
      console.warn('🔧 For CI/CD: Set AGILITY_GUID and AGILITY_TOKEN environment variables');
      console.warn(
        '💡 These tests require PAT authentication - Auth0 flow is not supported in automated testing'
      );
      return;
    }
  });

  beforeEach(async () => {
    await cleanupTestFiles();
  });

  afterEach(async () => {
    await cleanupTestFiles();
  });

  describe('Pull Command Options', () => {
    it('should respect --preview flag', async () => {
      if (!testEnv) {
        console.warn('Skipping test: Test environment not configured');
        return;
      }

      const result = await runCLICommand(
        'pull',
        [
          '--sourceGuid',
          testEnv.guid,
          '--locale',
          testEnv.locales.split(',')[0],
          '--channel',
          testEnv.website,
          '--token',
          testEnv.token,
          '--headless',
          '--preview',
          'true',
          '--elements',
          'Models',
        ],
        {
          timeout: 90000,
        }
      );

      expect(result.exitCode).toBe(0);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/preview|staging/i);
    }, 120000);

    it('should handle custom rootPath', async () => {
      if (!testEnv) {
        console.warn('Skipping test: Test environment not configured');
        return;
      }

      const customRoot = 'test-agility-files';

      const result = await runCLICommand(
        'pull',
        [
          '--sourceGuid',
          testEnv.guid,
          '--locale',
          testEnv.locales.split(',')[0],
          '--channel',
          testEnv.website,
          '--token',
          testEnv.token,
          '--headless',
          '--rootPath',
          customRoot,
          '--elements',
          'Models',
        ],
        {
          timeout: 90000,
        }
      );

      expect(result.exitCode).toBe(0);

      // Validate files were created in custom directory
      const validation = await validateDownloadedFiles(
        testEnv.guid,
        testEnv.locales.split(',')[0],
        customRoot
      );
      expect(validation.hasModels).toBe(true);

      // Clean up custom directory
      await cleanupTestFiles(customRoot);
    }, 120000);
  });

  describe('Pull Error Handling', () => {
    it('should fail gracefully with invalid GUID', async () => {
      if (!testEnv) {
        console.warn('Skipping test: Test environment not configured');
        return;
      }

      const result = await runCLICommand(
        'pull',
        [
          '--sourceGuid',
          'invalid-guid-12345',
          '--locale',
          'en-us',
          '--channel',
          'website',
          '--token',
          testEnv.token,
          '--headless',
          '--elements',
          'Models',
        ],
        {
          timeout: 60000,
        }
      );

      expect(result.exitCode).not.toBe(0);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/guid|instance|access|error/i);
    }, 90000);

    it('should fail gracefully with invalid locale', async () => {
      if (!testEnv) {
        console.warn('Skipping test: Test environment not configured');
        return;
      }

      const result = await runCLICommand(
        'pull',
        [
          '--sourceGuid',
          testEnv.guid,
          '--locale',
          'invalid-locale',
          '--channel',
          testEnv.website,
          '--token',
          testEnv.token,
          '--headless',
          '--elements',
          'Models',
        ],
        {
          timeout: 60000,
        }
      );

      expect(result.exitCode).not.toBe(0);
      const output = result.stdout + result.stderr;
      expect(output).toMatch(/locale|language|invalid/i);
    }, 90000);

    it('should handle network timeouts gracefully', async () => {
      if (!testEnv) {
        console.warn('Skipping test: Test environment not configured');
        return;
      }

      // This test verifies timeout handling - we'll use a very short timeout
      const result = await runCLICommand(
        'pull',
        [
          '--sourceGuid',
          testEnv.guid,
          '--locale',
          testEnv.locales.split(',')[0],
          '--channel',
          testEnv.website,
          '--token',
          testEnv.token,
          '--headless',
          '--elements',
          'Models',
        ],
        {
          timeout: 5000, // Very short timeout to force a timeout
        }
      );

      // Should either succeed quickly or timeout gracefully
      if (result.exitCode !== 0) {
        const output = result.stdout + result.stderr;
        expect(output).toMatch(/timeout|time|exceeded/i);
      }
    }, 15000);
  });
});
