/**
 * Jest setup file - loads environment variables for testing
 * 
 * Test env file location: src/tests/.env.test
 * Copy .env.test.example to .env.test and fill in your test credentials
 */
import dotenv from 'dotenv';
import path from 'path';

// Load .env.test from the tests folder (not project root)
const envPath = path.resolve(__dirname, '.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
    console.warn(`
⚠️  Test environment file not found: ${envPath}
    Copy src/tests/.env.test.example to src/tests/.env
    and fill in your test credentials.
`);
}
