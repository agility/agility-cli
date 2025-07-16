# Agility CLI

A powerful command-line tool for Agility CMS that provides dependency-aware content synchronization and intelligent instance management.

## Quick Start

```bash
# Install globally
npm install -g @agility/cli
```

## Core Operations

The Agility CLI provides several key operations for managing Agility CMS instances, with unified command arguments across all operations.

### 🔽 Pull Operation

Downloads content from an Agility CMS instance to your local file system for backup, migration, or synchronization purposes.

```bash
agility pull [options]
```

### 🔄 Sync Operation

Intelligently synchronizes content between two Agility CMS instances using advanced dependency analysis to ensure 100% success rates.

```bash
agility sync --sourceGuid="source-guid" --targetGuid="target-guid" [options]
```

## 🚀 **Refined Flag Architecture**

The Agility CLI uses an intuitive flag system designed for consistent behavior and safer defaults:

### **Core Principles**
- **Fresh Data by Default**: Both pull and sync commands download fresh data by default (`--update=true`)
- **Safer Defaults**: Prevents accidental content overwrites (`--overwrite=false` by default)
- **Consistent Behavior**: Same flags work the same way across commands
- **Performance Options**: Use `--no-update` to skip API calls and use cached data

### **Key Flags**

| Flag | Default | Commands | Purpose |
|------|---------|----------|---------|
| `--update` | `true` | Pull, Sync | Download fresh data from source instance |
| `--no-update` | - | Pull, Sync | Use existing local cache (performance optimization) |
| `--overwrite` | `false` | Sync only | Update existing target items vs create new versions |
| `--publish` | `false` | Sync only | Automatically publish synced content and pages after successful sync |
| `--reset` | `false` | Pull, Sync | Nuclear option: delete local data and start fresh |

### **Typical Usage Patterns**

```bash
# Standard operation (fresh data, safe defaults)
agility pull --sourceGuid="abc123"
agility sync --sourceGuid="abc123" --targetGuid="def456"

# Auto-publish after sync (streamlined workflow)
agility sync --sourceGuid="abc123" --targetGuid="def456" --publish

# Performance optimization (use cached data)
agility sync --sourceGuid="abc123" --targetGuid="def456" --no-update

# Force updates in target (for refreshing existing content)
agility sync --sourceGuid="abc123" --targetGuid="def456" --overwrite

# Complete workflow: force update + auto-publish
agility sync --sourceGuid="abc123" --targetGuid="def456" --overwrite --publish

# Nuclear reset (when things go wrong)
agility pull --sourceGuid="abc123" --reset
```

### 🔑 Authentication Commands

#### Login
Authenticate with Agility CMS to access your instances.

```bash
agility login [options]
```

#### Logout
Clear authentication and log out.

```bash
agility logout [options]
```

### 🧹 Clean Operation

Remove all content from an instance (destructive operation).

```bash
agility clean [options]
```

### ⚙️ Generate Environment

Generate an `.env` file for your instance configuration.

```bash
agility genenv [options]
```

### 🏠 Default Command

Interactive home interface for managing instances.

```bash
agility [options]
```

### 📝 Content Management Commands (Upcoming)

#### Update Content
Update specific content items in an instance (PR #19).

```bash
agility updatecontent --guid="target-guid" --locale="en-us" --contentItems="123,456" [options]
```

#### Publish Content  
Publish specific content items in an instance (PR #19).

```bash
agility publishcontent --guid="target-guid" --locale="en-us" --contentItems="123,456" [options]
```

### Sync Process Flow

```
📊 Source Analysis → 🔗 Dependency Mapping → 📦 Batch Optimization → 🚀 Parallel Upload → ✅ Verification
```

## Command Reference

### Pull Command

Download content from an Agility CMS instance to local files.

```bash
agility pull [options]
```

#### Pull Options

All commands support the following unified system arguments:

**Core Instance Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--sourceGuid` | string | *from .env* | Source instance GUID (required for sync, can be from .env for pull) |
| `--locale` | string | `en-us` | Locale to operate on |
| `--channel` | string | `website` | Channel to operate on |
| `--preview` | boolean | `true` | Use preview (true) or live (false) environment |

**Content Selection Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--elements` | string | `Models,Galleries,Assets,Containers,Content,Templates,Pages` | Comma-separated list of elements to process |
| `--models` | string | *(empty)* | Comma-separated list of model reference names to sync (includes all dependent content, pages, assets, and galleries) |

**File System Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--rootPath` | string | `agility-files` | Root directory for local files |
| `--legacyFolders` | boolean | `false` | Use legacy flat folder structure |

**Operation Control Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--update` | boolean | `true` | **BOTH COMMANDS**: Download fresh data from source instance before operations. Use `--no-update` to use existing local cache only. Default: true (ensures fresh data) |
| `--overwrite` | boolean | `false` | **SYNC ONLY**: Force update existing items in target instance instead of creating new items with -1 IDs. Default: false (safer behavior to prevent overwriting existing content) |
| `--publish` | boolean | `false` | **SYNC ONLY**: Automatically publish synced content and pages after successful sync operations. Uses batch publishing for optimal performance. Default: false |
| `--reset` | boolean | `false` | **BOTH COMMANDS**: Nuclear option - completely delete instance GUID folder and start fresh. For pull: deletes local data. For sync: deletes source data + regenerates mappings. Default: false |
| `--force` | boolean | `false` | **SYNC ONLY**: Override target safety conflicts during sync operations. When target instance has changes AND sync delta has updates, --force will apply sync changes anyway. Default: false (safer behavior to prevent data loss) |
| `--noBatch` | boolean | `false` | **BOTH COMMANDS**: Disable batch processing and use individual item processing instead. Affects both content items and linked content - all items will be processed individually rather than in optimized batches. Default: false (batch processing enabled for better performance) |

> **🎯 Intuitive Flag Design**: `--update` provides consistent fresh data behavior across both pull and sync commands, with safer defaults to prevent accidental overwrites.

**Network & Security Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--baseUrl` | string | *auto-detect* | Override API base URL for your region |
| `--insecure` | boolean | `false` | Disable SSL certificate verification |

**UI & Output Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--headless` | boolean | `false` | Disable UI, log to file only |
| `--verbose` | boolean | `false` | Detailed console output |
| `--blessed` | boolean | `true` | Use experimental Blessed UI |

**Development & Debug Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--dev` | boolean | `false` | Enable developer mode |
| `--local` | boolean | `false` | Enable local mode |
| `--preprod` | boolean | `false` | Enable preprod mode |
| `--test` | boolean | `false` | Enable test mode for analysis and debugging (bypasses auth for sync analysis) |

#### Pull Examples

```bash
# Basic pull using sourceGuid from .env
agility pull

# Pull specific instance with locale
agility pull --sourceGuid="abc123" --locale="en-us"

# Pull specific elements only
agility pull --sourceGuid="abc123" --elements="Models,Content"

# Pull with existing local cache (performance optimization)
agility pull --sourceGuid="abc123" --no-update

# Nuclear option: completely delete instance folder and start fresh  
agility pull --sourceGuid="abc123" --reset

# Pull from live environment
agility pull --sourceGuid="abc123" --preview=false

# Pull with verbose output
agility pull --sourceGuid="abc123" --verbose

# Pull in headless mode
agility pull --sourceGuid="abc123" --headless
```

### Sync Command

Synchronize content between two Agility CMS instances with intelligent dependency resolution.

```bash
agility sync [options]
```

#### Sync Examples

*Note: Sync operations use the same unified system arguments listed above. Both `--sourceGuid` and `--targetGuid` options are required for sync operations.*

```bash
# Basic sync (pulls fresh data by default)
agility sync --sourceGuid="abc123" --targetGuid="def456"
```

> **⚠️ IMPORTANT WARNING FOR LARGE INSTANCES**
> 
> **If you have a large instance (1000+ entities), always use the `--verbose` flag:**
> ```bash
> agility pull --sourceGuid="abc123" --verbose
> agility sync --sourceGuid="abc123" --targetGuid="def456" --verbose
> ```
> 
> **Why this matters:**
> - **Large instances** can appear to "hang" without verbose output
> - **Progress visibility** is essential for operations that may take 10+ minutes
> - **Blessed UI** may not show detailed progress on complex sync operations
> - **Verbose mode** provides real-time feedback on what's being processed
> 
> **Recommended for instances with:**
> - 1000+ content items
> - Complex page hierarchies

```bash
# Full sync specification with additional options
agility sync --sourceGuid="abc123" --targetGuid="def456" --locale="en-us"

# Sync specific elements only
agility sync --sourceGuid="abc123" --targetGuid="def456" --elements="Models,Content"

# Test mode - show dependency analysis without syncing
agility sync --sourceGuid="abc123" --targetGuid="def456" --test

# Force update existing items
agility sync --sourceGuid="abc123" --targetGuid="def456" --overwrite

# Sync to live environment
agility sync --sourceGuid="abc123" --targetGuid="def456" --preview=false

# Use existing local cache instead of fresh data (performance optimization)
agility sync --sourceGuid="abc123" --targetGuid="def456" --no-update

# Force update existing items in target instance instead of creating new versions
agility sync --sourceGuid="abc123" --targetGuid="def456" --overwrite

# Use cached data + force target updates (combine performance with overwrites)
agility sync --sourceGuid="abc123" --targetGuid="def456" --no-update --overwrite

# Sync specific models and their dependencies
agility sync --sourceGuid="abc123" --targetGuid="def456" --models="BlogPost,NewsArticle"

# Sync specific models with verbose output
agility sync --sourceGuid="abc123" --targetGuid="def456" --models="ProductInfo,Category" --verbose

# Test mode - analysis only, no actual sync
agility sync --sourceGuid="abc123" --targetGuid="def456" --test

# Test specific models without syncing
agility sync --sourceGuid="abc123" --targetGuid="def456" --models="BlogPost" --test

# Auto-publish content and pages after sync
agility sync --sourceGuid="abc123" --targetGuid="def456" --publish

# Auto-publish with model-specific sync
agility sync --sourceGuid="abc123" --targetGuid="def456" --models="BlogPost,NewsArticle" --publish

# Complete workflow: force update + auto-publish
agility sync --sourceGuid="abc123" --targetGuid="def456" --overwrite --publish

# Override safety conflicts (use with caution)
agility sync --sourceGuid="abc123" --targetGuid="def456" --force

# Disable batch processing for troubleshooting
agility sync --sourceGuid="abc123" --targetGuid="def456" --noBatch

# Performance-optimized sync with auto-publish
agility sync --sourceGuid="abc123" --targetGuid="def456" --no-update --publish
```

## Auto-Publishing

The `--publish` flag automatically publishes synced content and pages after successful sync operations, providing a streamlined workflow from sync to production-ready content.

### How Auto-Publishing Works

When you use the `--publish` flag with sync:

1. **Sync Operations Execute**: Content and pages are synced to the target instance
2. **ID Collection**: Successfully synced content and page IDs are collected during the process  
3. **Batch Publishing**: Content and pages are published using optimized batch operations
4. **Error Resilience**: Publishing failures don't affect sync success - sync completes regardless

### Auto-Publishing Features

- **Batch Optimization**: Uses Agility's batch publishing APIs for optimal performance
- **Selective Publishing**: Only publishes successfully synced content (skips failed items)
- **Progress Reporting**: Detailed progress information during publishing operations
- **Error Handling**: Individual item failures don't stop the entire publishing process
- **Retry Logic**: Built-in retry mechanism for transient publishing failures

### Usage Examples

```bash
# Basic auto-publish after sync
agility sync --sourceGuid="abc123" --targetGuid="def456" --publish

# Auto-publish specific models and their dependencies
agility sync --sourceGuid="abc123" --targetGuid="def456" --models="BlogPost" --publish

# Complete workflow: update existing items + auto-publish
agility sync --sourceGuid="abc123" --targetGuid="def456" --overwrite --publish

# Performance-optimized: use cache + auto-publish
agility sync --sourceGuid="abc123" --targetGuid="def456" --no-update --publish
```

### Performance Considerations

- **Batch Size**: Publishing uses optimal batch sizes (typically 10 items per batch)
- **Concurrent Operations**: Batch publishing is significantly faster than individual API calls
- **Large Syncs**: For large content sets, expect 1-2 minutes additional time for publishing
- **Memory Efficient**: Target IDs are collected during sync, minimal additional memory usage

### Troubleshooting Auto-Publishing

**Publishing Fails but Sync Succeeds:**
- This is expected behavior - sync operations complete independently
- Check target instance permissions for publishing rights
- Verify content items are in a publishable state

**Partial Publishing:**
- Some items may fail to publish due to validation errors
- Check verbose output (`--verbose`) for detailed error messages
- Failed publishing doesn't affect already-published items

**Publishing Performance:**
- Large content sets may take additional time to publish
- Use `--verbose` flag to monitor publishing progress
- Publishing speed depends on target instance performance

**Common Issues:**
```bash
# Permission issues - ensure user has publish rights
agility sync --sourceGuid="abc123" --targetGuid="def456" --publish --verbose

# Content validation errors - check specific error messages
agility sync --sourceGuid="abc123" --targetGuid="def456" --publish --verbose

# Large batch optimization - publishing happens automatically in batches
agility sync --sourceGuid="abc123" --targetGuid="def456" --models="BlogPost" --publish --verbose
```

### Best Practices

1. **Test First**: Use `--test` flag to validate sync before adding `--publish`
2. **Use Verbose**: Add `--verbose` for detailed publishing feedback
3. **Model-Specific**: Use `--models` with `--publish` for targeted content publishing
4. **Monitor Progress**: Watch for publishing success/failure messages in output
5. **Check Permissions**: Ensure target instance user has publishing permissions

## Authentication

Authentication is handled via the `login` and `logout` commands. This opens a browser window for secure authentication. You must be an Org Admin, Instance Admin, or have Manager role to perform CLI operations.

## Environment Configuration

The CLI supports `.env` file configuration for default values. Here are all the supported environment variables:

### Core Configuration
```env
# Instance and content settings
AGILITY_GUID=your-source-instance-guid
AGILITY_TARGET_GUID=your-target-instance-guid
AGILITY_LOCALES=en-us,fr-ca
AGILITY_WEBSITE=website
AGILITY_API_FETCH_KEY=your-fetch-key
AGILITY_API_PREVIEW_KEY=your-preview-key

# Content selection
AGILITY_ELEMENTS=Models,Galleries,Assets,Containers,Content,Templates,Pages
AGILITY_MODELS=BlogPost,NewsArticle,ProductInfo

# File system settings
AGILITY_ROOT_PATH=agility-files
AGILITY_LEGACY_FOLDERS=false

# Network settings
AGILITY_BASE_URL=https://mgmt.aglty.io
AGILITY_INSECURE=false

# Environment modes (true/false)
AGILITY_DEV=false
AGILITY_LOCAL=false
AGILITY_PREPROD=false

# UI and output flags (true/false)
AGILITY_PREVIEW=true
AGILITY_VERBOSE=false
AGILITY_HEADLESS=false
AGILITY_BLESSED=true

# Debug and analysis flags (true/false)
AGILITY_TEST=false

# Operation control flags (defaults match CLI behavior)
AGILITY_UPDATE=true     # Download fresh data by default (both pull and sync)
AGILITY_OVERWRITE=false # Don't overwrite target items by default (sync only)
AGILITY_PUBLISH=false   # Don't auto-publish by default (sync only)
AGILITY_RESET=false     # Don't delete local data by default (both pull and sync)
```

### Environment Variable Mapping

| Environment Variable | Command Argument | Description |
|---------------------|------------------|-------------|
| `AGILITY_GUID` | `--sourceGuid` | Default source instance GUID |
| `AGILITY_TARGET_GUID` | `--targetGuid` | Default target instance GUID |
| `AGILITY_LOCALES` | `--locale` | Default locale (uses first if multiple) |
| `AGILITY_WEBSITE` | `--channel` | Default channel name |
| `AGILITY_ELEMENTS` | `--elements` | Default elements to process |
| `AGILITY_MODELS` | `--models` | Default models to sync (comma-separated) |
| `AGILITY_ROOT_PATH` | `--rootPath` | Default root directory |
| `AGILITY_LEGACY_FOLDERS` | `--legacyFolders` | Use legacy folder structure |
| `AGILITY_BASE_URL` | `--baseUrl` | Default API base URL |
| `AGILITY_INSECURE` | `--insecure` | Disable SSL verification |
| `AGILITY_DEV` | `--dev` | Enable developer mode |
| `AGILITY_LOCAL` | `--local` | Enable local mode |
| `AGILITY_PREPROD` | `--preprod` | Enable preprod mode |
| `AGILITY_PREVIEW` | `--preview` | Default preview/live setting |
| `AGILITY_VERBOSE` | `--verbose` | Default verbose output setting |
| `AGILITY_HEADLESS` | `--headless` | Default headless mode setting |
| `AGILITY_BLESSED` | `--blessed` | Use blessed UI |
| `AGILITY_TEST` | `--test` | Default test mode setting |
| `AGILITY_UPDATE` | `--update` | Default fresh data setting (both pull and sync) |
| `AGILITY_OVERWRITE` | `--overwrite` | Default overwrite setting (sync only) |
| `AGILITY_PUBLISH` | `--publish` | Default auto-publish setting (sync only) |
| `AGILITY_RESET` | `--reset` | Default reset setting (both pull and sync) |
| `AGILITY_FORCE` | `--force` | Default force setting (sync only) |
| `AGILITY_NO_BATCH` | `--noBatch` | Default batch processing setting (both pull and sync) |

**Note**: Command line arguments always override environment variables when both are provided.

## Sync Token Management

The Agility CLI uses the Content Sync SDK for incremental content synchronization. Understanding how sync tokens work is crucial for managing pull and sync operations effectively.

### How Sync Tokens Work

**Sync tokens** are stored in the `state/sync.json` file and enable incremental content synchronization:

```
agility-files/{guid}/{locale}/{preview|live}/state/sync.json
```

**Token Behavior:**
- **First Pull**: No sync token exists → **Full sync** downloads all content
- **Subsequent Pulls**: Sync token exists → **Incremental sync** downloads only changes since last pull
- **Content Sync SDK**: Automatically manages token creation and updates
- **Management SDK**: Templates, models, containers, assets, galleries don't use sync tokens

### --update vs --reset Flag Behavior

#### --update Flag (Default: false)

**Management SDK Downloaders** (Templates, Models, Containers, Assets, Galleries):
- `--update=false` (default): Skip existing files, download missing files (normal efficient behavior)
- `--update=true`: Force download/overwrite existing files

**Content Sync SDK** (Content, Pages, Sitemaps, Redirections):
- `--update=false` (default): Preserves sync tokens for incremental sync
- `--update=true`: Clears sync tokens for complete refresh

> **🔑 Key Point**: The `--update=true` flag clears sync tokens and forces complete refresh of all content. Use `--update=false` (default) for normal efficient operations.

#### --reset Flag (Default: false)

**Complete Reset** (Both SDKs):
- Deletes entire instance GUID folder
- Removes all sync tokens
- Forces fresh download of everything
- Use when you want to start completely fresh

### Manual Sync Token Reset

To reset **only** the Content Sync SDK without affecting Management SDK downloads:

```bash
# Delete the state folder manually
rm -rf agility-files/{guid}/{locale}/{preview|live}/state/

# Then run pull - will do full content sync but preserve other downloaded files
agility pull --sourceGuid="your-guid"
```

**Manual Reset Examples:**
```bash
# Reset sync token for specific instance preview environment
rm -rf agility-files/abc123-guid/en-us/preview/state/

# Reset sync token for live environment
rm -rf agility-files/abc123-guid/en-us/live/state/

# Reset all environments for an instance
rm -rf agility-files/abc123-guid/*/*/state/
```

### Common Scenarios

#### Fresh Install or First Pull
```bash
# No sync token exists - will do full sync
agility pull --sourceGuid="abc123"
```

#### Regular Updates (Incremental)
```bash
# Uses existing sync token - only downloads changes (default behavior)
agility pull --sourceGuid="abc123"
```

#### Force Complete Refresh
```bash
# Clears sync tokens and forces download/overwrite of all files
agility pull --sourceGuid="abc123" --update
```

#### Force Fresh Download of Everything
```bash
# Nuclear option - deletes everything and starts fresh
agility pull --sourceGuid="abc123" --reset
```

#### Reset Only Content Sync
```bash
# Manual approach - delete state folder then pull
rm -rf agility-files/abc123-guid/en-us/preview/state/
agility pull --sourceGuid="abc123"
```

### Troubleshooting Sync Issues

**Problem**: Content not updating despite changes in source instance
**Solution**: Reset the sync token
```bash
rm -rf agility-files/{guid}/{locale}/{preview|live}/state/
agility pull --sourceGuid="your-guid"
```

**Problem**: Pull operation seems to re-download everything
**Solution**: Check if sync token exists
```bash
# Check if sync token file exists
ls agility-files/{guid}/{locale}/{preview|live}/state/sync.json

# If missing, next pull will be full sync (expected)
```

**Problem**: Want to force full content re-download without affecting other files
**Solution**: Delete only the content directories and state
```bash
rm -rf agility-files/{guid}/{locale}/{preview|live}/item/
rm -rf agility-files/{guid}/{locale}/{preview|live}/list/
rm -rf agility-files/{guid}/{locale}/{preview|live}/state/
agility pull --sourceGuid="your-guid"
```

### Best Practices

1. **Normal Operations**: Let sync tokens handle incremental updates automatically
2. **Debugging**: Use `--verbose` to see sync token status during operations
3. **Fresh Start**: Use `--reset` flag for complete reset of all data
4. **Content Issues**: Manually delete `state/` folder to reset only content sync
5. **Performance**: Use `--no-update` to skip Management SDK downloads while preserving incremental content sync

## Model-Specific Sync

The `--models` parameter enables selective synchronization based on specific content models. This is particularly useful for large instances where you only want to sync certain content types.

### How --models Works

When you specify `--models`, the CLI:

1. **Identifies Model Dependencies**: Analyzes the specified models and finds all their dependencies
2. **Includes Related Content**: Automatically includes all content items based on those models
3. **Finds Dependent Pages**: Includes pages that reference the content from those models
4. **Resolves Asset Dependencies**: Includes all assets referenced by the content and pages
5. **Includes Galleries**: Adds any galleries referenced by the content

### Model-Specific Examples

```bash
# Sync only blog-related content
agility sync --sourceGuid="abc123" --targetGuid="def456" --models="BlogPost,BlogCategory"

# Sync product catalog only
agility sync --sourceGuid="abc123" --targetGuid="def456" --models="Product,ProductCategory,ProductReview"

# Test analysis for specific models (no actual sync)
agility sync --sourceGuid="abc123" --targetGuid="def456" --models="NewsArticle" --test
```

### Benefits of Model-Specific Sync

- **Faster Operations**: Only processes relevant content instead of entire instance
- **Targeted Updates**: Perfect for content-specific deployments
- **Dependency Safety**: Automatically includes all required dependencies
- **Testing**: Use with `--test` to analyze dependencies without syncing

## File Structure

The CLI organizes downloaded content in a structured format:

```
agility-files/
├── {instance-guid}/
│   ├── mappings/             # Reference mappings for sync operations
│   └── {locale}/
│       ├── preview/          # Preview environment
│       │   ├── assets/       # Asset files and metadata
│       │   │   ├── json/     # Asset metadata
│       │   │   └── galleries/ # Gallery definitions
│       │   ├── item/         # Content items
│       │   ├── list/         # Content lists  
│       │   ├── page/         # Page definitions
│       │   ├── models/       # Content models
│       │   ├── containers/   # Content containers
│       │   ├── templates/    # Page templates
│       │   ├── sitemap/      # Flat sitemap
│       │   ├── nestedsitemap/ # Nested sitemap structure
│       │   ├── state/        # Sync state and tokens
│       │   ├── urlredirections/ # URL redirections
│       │   └── logs/         # Operation logs
│       └── live/             # Live environment (same structure as preview)
```

### Legacy Folder Structure

When using the `--legacyFolders` flag, the CLI uses a flattened structure directly in the root path:

```bash
# Use legacy flat structure
agility pull --sourceGuid="abc123" --legacyFolders

# Use legacy structure with custom root path
agility pull --sourceGuid="abc123" --legacyFolders --rootPath="my-content"
```

**Legacy Structure:**
```
{rootPath}/              # Default: agility-files/
├── assets/
│   ├── json/
│   └── galleries/
├── item/
├── list/
├── page/
├── models/
├── containers/
├── templates/
├── sitemap/
├── nestedsitemap/
├── state/
├── urlredirections/
└── logs/
```

**Key Differences:**
- **Flattened**: No instance GUID or locale subdirectories
- **Direct Access**: All content types stored directly in the root path
- **Backwards Compatibility**: Maintains compatibility with older CLI versions
- **Custom Root**: Specify `--rootPath` to change the base directory (default: `agility-files`)

## Reference Mappings

Reference mappings are the core intelligence system that enables successful content synchronization between Agility CMS instances. They establish relationships between source entities and their corresponding target entities, allowing the CLI to resolve dependencies and avoid conflicts during sync operations.

### How Mappings Work

When you run a sync operation, the CLI performs a sophisticated mapping process:

1. **Discovery Phase**: Analyzes both source and target instances to catalog all existing entities
2. **Mapping Creation**: Establishes relationships between source and target entities using reliable identification strategies
3. **Dependency Resolution**: Uses mappings to transform entity references (like model IDs, asset URLs, content references) from source values to target values during sync

### Mapping Persistence

Mappings are automatically saved to disk to optimize performance and enable incremental syncs:

```
agility-files/
├── {source-instance-guid}/
│   ├── mappings/
│   │   └── {target-instance-guid}.json    # Mapping file for source→target sync
│   └── {locale}/...
```

**Mapping File Structure:**
```json
{
  "sourceGUID": "abc123-source",
  "targetGUID": "def456-target", 
  "records": [
    {
      "type": "model",
      "source": { "id": 42, "referenceName": "BlogPost", ... },
      "target": { "id": 84, "referenceName": "BlogPost", ... },
      "sourceGUID": "abc123-source",
      "targetGUID": "def456-target"
    }
  ],
  "modelIds": [[42, 84], [43, 85]],
  "contentIds": [[1001, 2001], [1002, 2002]],
  "templateIds": [[10, 20], [11, 21]],
  "pageIds": [[5, 15], [6, 16]],
  "assetIds": [[301, 401], [302, 402]],
  "galleryIds": [[50, 60], [51, 61]],
  "containerIds": [[7, 17], [8, 18]]
}
```

### Why Mappings Are Essential

**Performance Optimization:**
- Eliminates redundant API calls by caching entity relationships
- Enables bulk operations and intelligent skipping of existing entities
- Reduces sync time from hours to minutes for large instances

**Dependency Resolution:**
- Transforms content field references (model IDs, asset URLs) from source to target values
- Ensures pages reference correct templates in the target instance
- Maintains content relationships across instance boundaries

**Conflict Prevention:**
- Prevents duplicate entity creation by tracking what already exists
- Enables safe re-running of sync operations without data corruption
- Supports incremental syncs that only process new/changed content

**Multi-Instance Support:**
- Each source→target pair has its own mapping file
- Supports complex scenarios like staging→production→backup chains
- Maintains separate mapping states for different sync directions

### Mapping Lifecycle

**Automatic Loading:**
- Mappings are automatically loaded when sync operations start
- Existing mappings are preserved and extended with new discoveries
- Old format mappings are automatically migrated to new format

**Incremental Updates:**
- New entities are added to mappings as they're discovered
- Existing mappings are updated when target entities change
- Mappings are saved after each major operation (models, content, pages, etc.)

**Manual Management:**
- Use `--clearMappings` flag to force fresh mapping generation
- Use `--rebuildMappings` flag to pull fresh data and rebuild all mappings
- Mapping files can be manually deleted to reset sync relationships

### Troubleshooting Mappings

**High Skip Rates:**
```bash
# If sync skips everything, force update existing items
agility sync --sourceGuid="abc123" --targetGuid="def456" --overwrite
```

**Corrupted Mappings:**
```bash  
# Manual reset - delete mapping file to start fresh
rm agility-files/{source-guid}/mappings/{target-guid}.json
```

**Debug Mapping Issues:**
```bash
# Use test mode to see mapping analysis
agility sync --sourceGuid="abc123" --targetGuid="def456" --test --verbose
```

## Base URLs by Region

If pull operations fail, you may need to specify the `--baseUrl` for your region:

| Region | Base URL |
|--------|----------|
| USA | `https://mgmt.aglty.io` |
| Canada | `https://mgmt-ca.aglty.io` |
| Europe | `https://mgmt-eu.aglty.io` |
| Australia | `https://mgmt-aus.aglty.io` |

## Troubleshooting

### Common Issues

**Authentication Failed**
```bash
agility logout
agility login
```

**Pull Operation Fails**
```bash
# Try specifying the base URL for your region
agility pull --sourceGuid="abc123" --baseUrl="https://mgmt.aglty.io"
```

**Sync Shows All Items Skipped**
```bash
# Try with fresh data first (default behavior, but worth being explicit)
agility sync --sourceGuid="abc123" --targetGuid="def456" --update

# If still skipping, force update existing items in target
agility sync --sourceGuid="abc123" --targetGuid="def456" --overwrite

# Combined: fresh data + force updates
agility sync --sourceGuid="abc123" --targetGuid="def456" --update --overwrite
```

**Debug Sync Issues**
```bash
# Show dependency analysis without syncing
agility sync --sourceGuid="abc123" --targetGuid="def456" --test --verbose
```

### Log Files

All operations create detailed logs at `agility-files/logs/instancelog.txt`.

## Support

- **Documentation**: [Agility CMS Help Center](https://help.agilitycms.com/hc/en-us)
- **Community**: [Agility Slack](https://join.slack.com/t/agilitycommunity/shared_invite/enQtNzI2NDc3MzU4Njc2LWI2OTNjZTI3ZGY1NWRiNTYzNmEyNmI0MGZlZTRkYzI3NmRjNzkxYmI5YTZjNTg2ZTk4NGUzNjg5NzY3OWViZGI)
- **Issues**: [GitHub Issues](https://github.com/agility/agility-cms-management-cli/issues)
- **Website**: [agilitycms.com](https://agilitycms.com)

---

*Built with ❤️ by the Agility CMS team*