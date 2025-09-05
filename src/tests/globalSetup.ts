import { execSync } from 'child_process';

/**
 * Jest global setup - runs once before all tests
 * This ensures the CLI is built only once for the entire test suite
 */
export default async function globalSetup() {
  console.log('🔨 Building CLI for integration tests...');
  
  try {
    execSync('npm run build', { 
      cwd: process.cwd(),
      stdio: 'pipe' 
    });
    console.log('✅ CLI build completed successfully');
  } catch (error) {
    console.error('❌ Failed to build CLI for tests:', error);
    throw new Error('CLI build failed - cannot run integration tests');
  }

  // Set test environment
  process.env.NODE_ENV = 'test';
}
