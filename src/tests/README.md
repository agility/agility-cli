# Testing Framework for Agility CLI

This directory contains integration tests for the Agility CLI that use real instances and authentication, not mocked functionality.

## Test Structure

```
src/tests/
├── integration/          # Integration tests using real CLI commands
│   ├── auth.test.ts      # Authentication flow tests
│   └── pull.test.ts      # Pull command functionality tests
├── utils/                # Test utilities and helpers
│   └── cli-test-utils.ts # CLI execution and validation utilities
├── setup.ts              # Jest setup configuration
├── test-env.template     # Environment configuration template
└── README.md            # This file
```

## Local Development Setup

### 1. Create Test Environment Configuration

Copy the template and configure your test instance:

```bash
cp src/tests/test-env.template .env.test.local
```

Edit `.env.test.local` with your test instance details:

```env
TEST_AGILITY_GUID=your-test-instance-guid
TEST_AGILITY_TOKEN=your-personal-access-token
TEST_AGILITY_WEBSITE=website
TEST_AGILITY_LOCALES=en-us
```

**Note:** `.env.test.local` is gitignored for security.

### 2. Run Tests Locally

```bash
# Run all tests
npm test

# Run only integration tests
npm test -- --testPathPattern="integration"

# Run specific test file
npm test -- auth.test.ts

# Run tests with verbose output
TEST_VERBOSE=true npm test

# Run tests and generate coverage
npm test -- --coverage
```

## CI/CD Setup

### GitHub Actions Configuration

The repository includes a GitHub Actions workflow (`.github/workflows/test.yml`) that:

1. Runs tests on Node.js 18.x and 20.x
2. Builds the CLI before testing
3. Runs integration tests if credentials are available
4. Performs security audits
5. Uploads test results and coverage

### Required Secrets

Configure these secrets in your GitHub repository settings:

- `CI_AGILITY_GUID`: Test instance GUID
- `CI_AGILITY_TOKEN`: Personal Access Token for authentication
- `CI_AGILITY_WEBSITE`: Website/channel name (optional, defaults to 'website')
- `CI_AGILITY_LOCALES`: Comma-separated locales (optional, defaults to 'en-us')

### Environment Variables Priority

The test framework checks for credentials in this order:

1. **CI Environment**: `CI_AGILITY_GUID`, `CI_AGILITY_TOKEN`, etc.
2. **Test Environment**: `TEST_AGILITY_GUID`, `TEST_AGILITY_TOKEN`, etc.
3. **Local File**: `.env.test.local` file

## Test Categories

### Authentication Tests (`auth.test.ts`)

- Personal Access Token authentication
- Environment variable authentication
- Server routing validation (US, US2, CA, EU, AUS, DEV)
- Error handling for invalid tokens
- SSL certificate error handling

### Pull Command Tests (`pull.test.ts`)

- Basic pull functionality (models, content, all elements)
- Command-line options (preview, locale, rootPath)
- Multiple locale handling
- Error handling (invalid GUID, locale, timeouts)
- File system validation
- Directory structure verification

## Test Utilities

### `cli-test-utils.ts`

Provides utilities for:

- **`runCLICommand()`**: Execute CLI commands and capture output
- **`loadTestEnvironment()`**: Load test configuration from environment
- **`cleanupTestFiles()`**: Clean up test artifacts
- **`validateDownloadedFiles()`**: Verify downloaded content structure
- **`waitForCondition()`**: Wait for async conditions with timeout

## Writing New Tests

### Example Test Structure

```typescript
import { runCLICommand, loadTestEnvironment, cleanupTestFiles } from '../utils/cli-test-utils';

describe('My New Feature Tests', () => {
  let testEnv: ReturnType<typeof loadTestEnvironment>;

  beforeAll(async () => {
    try {
      testEnv = loadTestEnvironment();
    } catch (error) {
      console.warn('Skipping tests: Test environment not configured');
      return;
    }
  });

  beforeEach(async () => {
    await cleanupTestFiles();
  });

  afterEach(async () => {
    await cleanupTestFiles();
  });

  it('should test my feature', async () => {
    if (!testEnv) {
      console.warn('Skipping test: Test environment not configured');
      return;
    }

    const result = await runCLICommand('my-command', [
      '--sourceGuid', testEnv.guid,
      '--token', testEnv.token,
      '--headless'
    ], {
      timeout: 60000
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('expected output');
  }, 90000);
});
```

### Best Practices

1. **Always check for test environment**: Skip tests gracefully if not configured
2. **Clean up artifacts**: Use `beforeEach`/`afterEach` to clean up test files
3. **Set appropriate timeouts**: Integration tests need longer timeouts
4. **Use headless mode**: Always use `--headless` to prevent UI interactions
5. **Validate outputs**: Check both exit codes and output content
6. **Handle errors gracefully**: Test both success and failure scenarios

## Test Data Requirements

For comprehensive testing, your test instance should have:

- At least 3 content models
- At least 5 content items
- At least 2 pages
- Multiple locales (if testing multi-locale functionality)
- Various content types (text, rich text, images, etc.)

## Troubleshooting

### Common Issues

1. **"Test environment not configured"**
   - Ensure you've set up `.env.test.local` or CI environment variables
   - Verify GUID and token are correct

2. **"Authentication failed"**
   - Check that your Personal Access Token is valid
   - Verify the GUID corresponds to an instance you have access to

3. **"Timeout exceeded"**
   - Increase test timeout for large instances
   - Check network connectivity to Agility servers

4. **"SSL Certificate errors"**
   - Add `--insecure` flag to CLI commands in corporate environments
   - Or set up proper SSL certificate handling

### Debug Mode

Run tests with debug output:

```bash
TEST_VERBOSE=true npm test -- --verbose
```

This will show CLI output and detailed test execution information.
