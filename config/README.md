# Agility CLI Test Configuration

This directory contains the configuration and tools for systematic testing of the Agility CLI across multiple instances.

## Files

- **`test-instances.json`** - Configuration file containing all source and target instances
- **`../scripts/test-runner.js`** - Test runner script that uses the configuration

## Source Instances (Validated)

All source instances have been validated with **100% entity reconciliation** across **24,164 total entities**.

| Name | GUID | Entities | Description |
|------|------|----------|-------------|
| **Small** | `67bc73e6-u` | 3,619 | Agility Documentation Site - clean structure, good for basic testing |
| **Medium** | `13a8b394-u` | 6,064 | Primary Test Instance - most thoroughly tested, complex hierarchies |  
| **Large** | `e287280d-7513-459a-85cc-2b7c19f13ac8` | 14,481 | Complex Production Instance - largest dataset for stress testing |

## Target Instances

| Name | GUID | Status |
|------|------|--------|
| **Target 1** | `90c39c80-u` | Available for testing |
| **Target 2** | `e67929d5-u` | Available for testing |
| **Target 3** | `f3866b86-u` | Available for testing |
| **Target 4** | `0bdf7173-u` | Available for testing |

## Test Runner Usage

### Basic Commands

```bash
# Show help and available instances
node scripts/test-runner.js

# List configuration summary  
node scripts/test-runner.js list

# Analyze a source instance (dependency analysis only)
node scripts/test-runner.js analyze small
node scripts/test-runner.js analyze medium  
node scripts/test-runner.js analyze large

# Pull content from a source instance
node scripts/test-runner.js pull small

# Run sync between source and target instances
node scripts/test-runner.js sync medium target1
```

### Predefined Test Scenarios

```bash
# Basic functionality test (small → target1)
node scripts/test-runner.js scenario basic

# Standard sync test (medium → target2)  
node scripts/test-runner.js scenario standard

# Stress test (large → target3)
node scripts/test-runner.js scenario stress
```

## Test Scenarios

### Recommended Testing Workflow

1. **Basic Testing**: Start with `small` instance to verify basic functionality
2. **Standard Testing**: Use `medium` instance for comprehensive feature testing
3. **Stress Testing**: Use `large` instance to test performance and scalability
4. **Cross-Instance Testing**: Test different source/target combinations

### Example Test Matrix

| Test Type | Source | Target | Purpose |
|-----------|--------|--------|---------|
| Basic | small | target1 | Basic functionality validation |
| Standard | medium | target2 | Comprehensive feature testing |
| Stress | large | target3 | Performance and scale testing |
| Cross-test | small | target4 | Alternative target validation |

## Validation Status

- ✅ **All source instances validated** with 100% entity reconciliation
- ✅ **Model duplication tracking** working across all instances
- ✅ **Container relationship mapping** fixed and validated
- ✅ **6-step dependency analysis** working correctly
- ✅ **24,164 total entities** successfully processed

## Adding New Instances

To add new test instances, edit `test-instances.json`:

1. Add to `sourceInstances` or `targetInstances` section
2. Include GUID, name, description, and any relevant metadata
3. Update the test runner script if new scenario types are needed

## Debug Flags

All test commands automatically include:
- `--verbose` - Detailed output
- `--test` - Bypasses authentication for analysis-only testing

For additional debugging, manually add `--debug` flag to see detailed relationship mapping. 