# Development Guide

## Getting Started

### Prerequisites

- Node.js 20.x or higher
- Git

### Setup

```bash
npm install
npm run build
```

## Code Quality & Formatting

This project uses **Prettier** for code formatting and **ESLint** for code quality.

### Automatic Formatting

- **VS Code**: Install recommended extensions, code formats automatically on save
- **Manual**: Run `npm run format` to format all files
- **Check**: Run `npm run format:check` to check if files are properly formatted

### Linting

- **Check**: `npm run lint` - Shows warnings for code quality issues
- **Fix**: `npm run lint:fix` - Automatically fixes what can be fixed
- **Type Check**: `npm run type-check` - TypeScript type checking without building

### Pre-commit Hooks

**Husky** automatically runs quality checks before each commit:

```bash
🚀 Running pre-commit checks...
🎨 Formatting and linting staged files...
🔍 Running TypeScript type check...
✅ Pre-commit checks passed!
```

**What happens automatically:**

1. **Staged files** are automatically formatted with Prettier
2. **ESLint fixes** are applied to staged files
3. **TypeScript type checking** ensures no type errors
4. **Commit is blocked** if any check fails

**Manual pre-commit test:**

```bash
npm run pre-commit  # Test lint-staged without committing
```

## Available Commands

### CLI Commands

```bash
npm start                 # Run the CLI
node dist/index.js --help # Show CLI help
```

### Development Commands

```bash
npm run build            # Build TypeScript to JavaScript
npm run format           # Format all TypeScript files
npm run format:check     # Check if files are formatted
npm run lint             # Run ESLint (warnings only)
npm run lint:fix         # Fix ESLint issues automatically
npm run type-check       # TypeScript type checking
```

### Testing Commands

```bash
npm test                 # Run essential tests (CI/CD optimized)
npm run test:full        # Run ALL tests (including advanced)
npm run test:auth        # Run authentication tests only
npm run test:pull-basic  # Run basic pull tests only
npm run test:coverage    # Run tests with coverage report
```

### Utility Commands

```bash
npm run clear-tokens     # Clear cached authentication tokens
npm run setup-test-env   # Interactive test environment setup
```

## VS Code Setup

### Recommended Extensions

The project includes VS Code extension recommendations:

- **Prettier**: Auto-formatting
- **ESLint**: Code quality
- **TypeScript**: Enhanced TypeScript support

### Settings

Auto-configured in `.vscode/settings.json`:

- Format on save enabled
- ESLint auto-fix on save
- Prettier as default formatter

## Git Workflow

### Standard Workflow

```bash
git add .                # Stage changes
git commit -m "message"  # Pre-commit hooks run automatically
git push                 # Push to remote
```

### If Pre-commit Fails

```bash
# Fix the issues shown in the error output
npm run lint:fix         # Auto-fix ESLint issues
npm run format           # Format code
npm run type-check       # Check for type errors

# Try committing again
git commit -m "message"
```

## Code Style Guidelines

### Prettier Configuration

- **Single quotes**: `'hello'` instead of `"hello"`
- **Semicolons**: Required
- **Line width**: 100 characters
- **Tab width**: 2 spaces
- **Trailing commas**: ES5 compatible

### ESLint Configuration

- **Warnings**: Most rules are warnings, not errors
- **TypeScript**: Full TypeScript support
- **Unused variables**: Prefix with `_` to ignore (e.g., `_unusedParam`)
- **Console**: `console.log` allowed (CLI tool)
- **Require**: Legacy `require()` statements show warnings

## CI/CD

### GitHub Actions

The workflow runs on Node.js 20.x and includes:

1. **Build**: TypeScript compilation
2. **Lint**: ESLint checks (warnings allowed)
3. **Format**: Prettier formatting validation
4. **Test**: Essential integration tests
5. **Security**: Vulnerability scanning

### Environment Variables

Required for CI/CD:

- `AGILITY_GUID`: Test instance GUID
- `AGILITY_TOKEN`: Personal Access Token

## Troubleshooting

### Pre-commit Hook Issues

```bash
# Skip pre-commit hooks (emergency only)
git commit --no-verify -m "message"

# Re-install hooks if broken
npx husky init
```

### Formatting Issues

```bash
# Check what files need formatting
npm run format:check

# Format all files
npm run format

# Format specific file
npx prettier --write src/path/to/file.ts
```

### Type Errors

```bash
# Check for type errors
npm run type-check

# Build to see detailed errors
npm run build
```
