# Agility CLI

A powerful command-line tool for Agility CMS that provides dependency-aware content synchronization and intelligent instance management.

## Quick Start

```bash
# Install globally
npm install -g @agility/cli
```

## Core Operations

The Agility CLI focuses on two primary operations: **Pull** and **Sync**. These operations work together to provide a complete content management workflow.

### 🔽 Pull Operation

Downloads content from an Agility CMS instance to your local file system for backup, migration, or synchronization purposes.

```bash
agility pull --guid="instance-guid"
```

### 🔄 Sync Operation

Intelligently synchronizes content between two Agility CMS instances using advanced dependency analysis to ensure 100% success rates.

```bash
agility sync --sourceGuid="source-guid" --targetGuid="target-guid"
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

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--guid` | string | *required* | Instance GUID to pull from |
| `--locale` | string | `en-us` | Locale to pull |
| `--channel` | string | `website` | Channel to pull from |
| `--preview` | boolean | `true` | Pull from preview (true) or live (false) |
| `--elements` | string | `all` | Comma-separated list: `Galleries,Assets,Models,Containers,Content,Templates,Pages` |
| `--baseUrl` | string | auto-detect | Override API base URL |
| `--rootPath` | string | `agility-files` | Local directory for downloaded files |
| `--legacyFolders` | boolean | `false` | Use legacy flat folder structure |
| `--overwrite` | boolean | `false` | Force overwrite existing local files |
| `--verbose` | boolean | `false` | Detailed console output |
| `--headless` | boolean | `false` | No UI, log to file only |

#### Pull Examples

```bash
# Basic pull
agility pull --guid="abc123" --locale="en-us" --channel="website"

# Pull specific elements only
agility pull --guid="abc123" --locale="en-us" --elements="Models,Content"

# Pull with overwrite (refresh local files)
agility pull --guid="abc123" --locale="en-us" --overwrite

# Pull from live environment
agility pull --guid="abc123" --locale="en-us" --preview=false
```

### Sync Command

Synchronize content between two Agility CMS instances with intelligent dependency resolution.

```bash
agility sync [options]
```

#### Sync Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--sourceGuid` | string | *required* | Source instance GUID |
| `--targetGuid` | string | *required* | Target instance GUID |
| `--locale` | string | `en-us` | Locale to sync |
| `--channel` | string | `website` | Channel to sync |
| `--preview` | boolean | `true` | Sync to preview (true) or live (false) |
| `--elements` | string | `all` | Comma-separated list: `Models,Content,Assets,Pages,Galleries,Containers,Templates` |
| `--rootPath` | string | `agility-files` | Local directory for sync files |
| `--legacyFolders` | boolean | `false` | Use legacy flat folder structure |
| `--forceUpdate` | boolean | `false` | Update existing items instead of skipping |
| `--debug` | boolean | `false` | Show dependency analysis without syncing |
| `--verbose` | boolean | `true` | Detailed console output |
| `--headless` | boolean | `false` | No UI, log to file only |

#### Sync Examples

```bash
# Basic sync
agility sync --sourceGuid="abc123" --targetGuid="def456" --locale="en-us"

# Sync specific elements only
agility sync --sourceGuid="abc123" --targetGuid="def456" --elements="Models,Content"

# Debug mode - show dependency analysis without syncing
agility sync --sourceGuid="abc123" --targetGuid="def456" --debug

# Force update existing items
agility sync --sourceGuid="abc123" --targetGuid="def456" --forceUpdate

# Sync to live environment
agility sync --sourceGuid="abc123" --targetGuid="def456" --preview=false
```

## Authentication

### Login

Authenticate with Agility CMS to access your instances.

```bash
agility login
```

This opens a browser window for secure authentication. You must be an Org Admin, Instance Admin, or have Manager role to perform CLI operations.

### Logout

```bash
agility logout
```

## Environment Configuration

The CLI supports `.env` file configuration for default values:

```env
AGILITY_GUID=your-default-instance-guid
AGILITY_LOCALES=en-us,fr-ca
AGILITY_WEBSITE=website
```

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
agility pull --guid="abc123" --legacyFolders

# Use legacy structure with custom root path
agility pull --guid="abc123" --legacyFolders --rootPath="my-content"
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
# If sync skips everything, data may be stale
agility sync --sourceGuid="abc123" --targetGuid="def456" --rebuildMappings
```

**Corrupted Mappings:**
```bash  
# Force fresh mapping generation
agility sync --sourceGuid="abc123" --targetGuid="def456" --clearMappings
```

**Manual Reset:**
```bash
# Delete mapping file to start fresh
rm agility-files/{source-guid}/mappings/{target-guid}.json
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
agility pull --guid="abc123" --baseUrl="https://mgmt.aglty.io"
```

**Sync Shows All Items Skipped**
```bash
# Force update existing items
agility sync --sourceGuid="abc123" --targetGuid="def456" --forceUpdate
```

**Debug Sync Issues**
```bash
# Show dependency analysis without syncing
agility sync --sourceGuid="abc123" --targetGuid="def456" --debug --verbose
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