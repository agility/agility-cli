# Mapping Dependency Enforcer - Examples

This document shows the conceptual shift from data dependency to mapping dependency enforcement.

## 🔴 BEFORE: Data Dependency Enforcement

### Current Behavior (Problematic)
```bash
# User wants to push 1 page
node dist/index.js sync --sourceGuid 13a8b394-u --targetGuid 90c39c80-u --locale en-us --elements Pages

# Current system forces download of ALL dependencies:
# 🔄 Downloading 1,247 Templates (150MB)
# 🔄 Downloading 3,619 Containers (200MB) 
# 🔄 Downloading 6,875 Content Items (500MB)
# 🔄 Downloading 2,441 Assets (1.2GB)
# 🔄 Downloading 156 Galleries (50MB)
# Total: 2.1GB downloaded to push 1 page!
```

### Problems
- **Massive over-fetching**: Downloads GBs to push MBs
- **Slow operations**: 10+ minutes for simple page push
- **Resource waste**: Downloads data that's never used
- **Poor UX**: User waits forever for simple operations

## 🟢 AFTER: Mapping Dependency Enforcement

### New Behavior (Efficient)
```bash
# User wants to push 1 page
node dist/index.js sync --sourceGuid 13a8b394-u --targetGuid 90c39c80-u --locale en-us --elements Pages

# New system checks mapping availability:
# ✅ Template mappings: 45 available
# ✅ Container mappings: 23 available  
# ✅ Content mappings: 156 available
# ❌ Asset mappings: 0 available
# ❌ Gallery mappings: 0 available

# ⚠️ Missing Mapping Dependencies
# Missing mappings for: asset, gallery
# These mappings are required to resolve entity references during push operations.
#
# 📋 Recommendations:
# To establish missing mappings, run these pull commands:
#   node dist/index.js pull --guid 13a8b394-u --locale en-us --channel website --elements Assets
#   node dist/index.js pull --guid 13a8b394-u --locale en-us --channel website --elements Galleries
# Note: This only downloads mapping data, not complete entity data
#
# 💡 Performance Benefit:
# Mapping-based dependencies are 10x faster than full data downloads.
# Establish mappings once, then push entities multiple times efficiently.
```

### Benefits
- **Fast validation**: Seconds instead of minutes
- **Targeted guidance**: Exact commands for missing mappings  
- **Efficient operations**: Only downloads what's needed
- **Clear feedback**: User understands exactly what's required

## 📊 Comparison Examples

### Scenario 1: Push Single Page
```bash
# BEFORE (Data Dependency)
Time: 12 minutes
Download: 2.1GB
Success: Page pushed after massive data download

# AFTER (Mapping Dependency)  
Time: 30 seconds
Download: 15KB (mapping data only)
Success: Page pushed using existing mappings
```

### Scenario 2: Push 5 Content Items
```bash
# BEFORE (Data Dependency)
Time: 8 minutes
Download: 800MB (all containers, models, assets)
Success: 5 content items pushed

# AFTER (Mapping Dependency)
Time: 45 seconds  
Download: 8KB (mapping validation only)
Success: 5 content items pushed using cached mappings
```

### Scenario 3: Missing Mappings
```bash
# BEFORE (Data Dependency)
Time: 15 minutes
Download: 2.5GB
Result: Error after massive download - missing target entities

# AFTER (Mapping Dependency)
Time: 5 seconds
Download: 0KB
Result: Clear error with specific pull commands to establish mappings
```

## 🎯 Workflow Examples

### Efficient Mapping-First Workflow
```bash
# 1. Establish mappings once (targeted pulls)
node dist/index.js pull --guid SOURCE --elements Templates --locale en-us
node dist/index.js pull --guid SOURCE --elements Containers --locale en-us  
node dist/index.js pull --guid SOURCE --elements Models --locale en-us

# 2. Push many times efficiently (using cached mappings)
node dist/index.js sync --sourceGuid SOURCE --targetGuid TARGET --elements Pages --locale en-us
node dist/index.js sync --sourceGuid SOURCE --targetGuid TARGET --elements Content --locale en-us
node dist/index.js sync --sourceGuid SOURCE --targetGuid TARGET --elements Pages --locale en-us
# Each push is fast because mappings are already established
```

### Smart Incremental Operations
```bash
# Push specific pages without downloading entire CMS
node dist/index.js sync --sourceGuid SOURCE --targetGuid TARGET --elements Pages --filter "home,about" --locale en-us

# System checks: Do we have mappings for home/about page dependencies?
# ✅ Template mappings: Available
# ✅ Container mappings: Available  
# ✅ Content mappings: Available
# ✅ Proceed with push operation (fast!)
```

## 🔧 Implementation Benefits

### For Developers
- **Predictable Performance**: Mapping checks are always fast
- **Clear Error Messages**: Specific guidance for missing requirements
- **Efficient Debugging**: Separate mapping issues from push issues
- **Flexible Operations**: Push subsets without complete downloads

### For Users  
- **Fast Feedback**: Know immediately if operation can proceed
- **Targeted Actions**: Exact commands to establish missing mappings
- **Efficient Workflows**: Establish mappings once, push many times
- **Resource Savings**: Download only what's needed for reference resolution

### For System Architecture
- **Separation of Concerns**: Mapping establishment vs entity pushing
- **Caching Benefits**: Mappings persist across multiple operations  
- **Scalability**: Works efficiently with large CMS instances
- **Maintainability**: Clear boundaries between different system responsibilities 