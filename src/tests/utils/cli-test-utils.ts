import { spawn, SpawnOptions } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const access = promisify(fs.access);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

export interface CLITestResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
}

export interface TestEnvironment {
  guid: string;
  token: string;
  website: string;
  locales: string;
}

/**
 * Load test environment configuration from environment variables or .env.test.local
 */
export function loadTestEnvironment(): TestEnvironment {
  // Try standard AGILITY_* environment variables (works for CI, tests, and regular usage)
  if (process.env.AGILITY_GUID && process.env.AGILITY_TOKEN) {
    // Validate they're not placeholder values
    if (process.env.AGILITY_GUID.includes('your-') || process.env.AGILITY_TOKEN.includes('your-')) {
      throw new Error(
        'Environment variables contain placeholder values. Please set real AGILITY_GUID and AGILITY_TOKEN values.'
      );
    }
    return {
      guid: process.env.AGILITY_GUID,
      token: process.env.AGILITY_TOKEN,
      website: process.env.AGILITY_WEBSITE || 'website',
      locales: process.env.AGILITY_LOCALES || 'en-us',
    };
  }

  // Try loading from .env.test.local file
  const envFile = path.join(process.cwd(), '.env.test.local');
  if (fs.existsSync(envFile)) {
    const envContent = fs.readFileSync(envFile, 'utf8');
    const envVars: Record<string, string> = {};

    envContent.split('\n').forEach((line) => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        envVars[match[1].trim()] = match[2].trim();
      }
    });

    if (envVars.AGILITY_GUID && envVars.AGILITY_TOKEN) {
      // Validate they're not placeholder values
      if (envVars.AGILITY_GUID.includes('your-') || envVars.AGILITY_TOKEN.includes('your-')) {
        throw new Error(
          '.env.test.local file contains placeholder values. Please edit it with your real AGILITY_GUID and AGILITY_TOKEN.'
        );
      }
      return {
        guid: envVars.AGILITY_GUID,
        token: envVars.AGILITY_TOKEN,
        website: envVars.AGILITY_WEBSITE || 'website',
        locales: envVars.AGILITY_LOCALES || 'en-us',
      };
    } else if (fs.existsSync(envFile)) {
      throw new Error(
        '.env.test.local file exists but is missing AGILITY_GUID or AGILITY_TOKEN values.'
      );
    }
  }

  // Provide helpful error message based on what's missing
  const hasEnvFile = fs.existsSync(envFile);
  const hasEnvVars = !!(process.env.AGILITY_GUID || process.env.AGILITY_TOKEN);

  if (hasEnvFile && !hasEnvVars) {
    throw new Error(
      "Found .env.test.local but it's missing valid AGILITY_GUID/AGILITY_TOKEN. Please edit the file with your credentials."
    );
  } else if (!hasEnvFile && hasEnvVars) {
    throw new Error(
      'Found partial environment variables. Please set both AGILITY_GUID and AGILITY_TOKEN.'
    );
  } else {
    throw new Error(
      'No test credentials found. Please set AGILITY_GUID/AGILITY_TOKEN environment variables OR create .env.test.local file.'
    );
  }
}

/**
 * Execute a CLI command and return the result
 */
export async function runCLICommand(
  command: string,
  args: string[] = [],
  options: { timeout?: number; cwd?: string; env?: Record<string, string> } = {}
): Promise<CLITestResult> {
  const startTime = Date.now();
  const { timeout = 60000, cwd = process.cwd(), env = {} } = options;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let finished = false;

    const spawnOptions: SpawnOptions = {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    };

    const child = spawn('node', ['dist/index.js', command, ...args], spawnOptions);

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (!finished) {
        finished = true;
        resolve({
          exitCode: code || 0,
          stdout,
          stderr,
          duration: Date.now() - startTime,
        });
      }
    });

    child.on('error', (error) => {
      if (!finished) {
        finished = true;
        resolve({
          exitCode: 1,
          stdout,
          stderr: stderr + error.message,
          duration: Date.now() - startTime,
        });
      }
    });

    // Set timeout
    const timeoutHandle = setTimeout(() => {
      if (!finished) {
        finished = true;
        child.kill('SIGKILL');
        resolve({
          exitCode: -1,
          stdout,
          stderr: stderr + '\nTest timeout exceeded',
          duration: Date.now() - startTime,
        });
      }
    }, timeout);

    child.on('close', () => {
      clearTimeout(timeoutHandle);
    });
  });
}

/**
 * Clean up test artifacts (both agility-files and test-agility-files directories)
 */
export async function cleanupTestFiles(testDir?: string): Promise<void> {
  const dirsToClean = testDir ? [testDir] : ['agility-files', 'test-agility-files']; // Clean both by default

  for (const dir of dirsToClean) {
    const fullPath = path.join(process.cwd(), dir);

    try {
      await access(fullPath);
      // Directory exists, remove it
      await fs.promises.rm(fullPath, { recursive: true, force: true });
    } catch (error) {
      // Directory doesn't exist, nothing to clean up
    }
  }
}

// Authentication management has been moved to scripts/clear-tokens.js
// Tests assume authentication is already configured

/**
 * Validate that files were downloaded correctly
 */
export async function validateDownloadedFiles(
  guid: string,
  locale: string = 'en-us',
  rootDir: string = 'agility-files'
): Promise<{
  hasModels: boolean;
  hasContent: boolean;
  hasPages: boolean;
  hasAssets: boolean;
  modelCount: number;
  contentCount: number;
  pageCount: number;
  assetCount: number;
}> {
  const basePath = path.join(process.cwd(), rootDir, guid);

  const result = {
    hasModels: false,
    hasContent: false,
    hasPages: false,
    hasAssets: false,
    modelCount: 0,
    contentCount: 0,
    pageCount: 0,
    assetCount: 0,
  };

  try {
    // Check models
    const modelsPath = path.join(basePath, 'models');
    try {
      await access(modelsPath);
      const modelFiles = await readdir(modelsPath);
      result.hasModels = modelFiles.length > 0;
      result.modelCount = modelFiles.filter((f) => f.endsWith('.json')).length;
    } catch (error) {
      // Models directory doesn't exist
    }

    // Check content
    const contentPath = path.join(basePath, 'content');
    try {
      await access(contentPath);
      const contentFiles = await readdir(contentPath);
      result.hasContent = contentFiles.length > 0;
      result.contentCount = contentFiles.filter((f) => f.endsWith('.json')).length;
    } catch (error) {
      // Content directory doesn't exist
    }

    // Check pages
    const pagesPath = path.join(basePath, 'pages');
    try {
      await access(pagesPath);
      const pageFiles = await readdir(pagesPath);
      result.hasPages = pageFiles.length > 0;
      result.pageCount = pageFiles.filter((f) => f.endsWith('.json')).length;
    } catch (error) {
      // Pages directory doesn't exist
    }

    // Check assets
    const assetsPath = path.join(basePath, 'assets');
    try {
      await access(assetsPath);
      const assetFiles = await readdir(assetsPath);
      result.hasAssets = assetFiles.length > 0;
      result.assetCount = assetFiles.filter((f) => f.endsWith('.json')).length;
    } catch (error) {
      // Assets directory doesn't exist
    }
  } catch (error) {
    // Base path doesn't exist
  }

  return result;
}

/**
 * Wait for a condition to be true with timeout
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 30000,
  interval: number = 1000
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    try {
      const result = await condition();
      if (result) {
        return true;
      }
    } catch (error) {
      // Condition check failed, continue waiting
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  return false;
}
