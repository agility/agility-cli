# Agility CLI

A powerful command-line tool for Agility CMS that provides dependency-aware content synchronization and intelligent instance management.

## Quick Start

```bash
# Install globally
npm install -g @agility/cli
```

**Note:** Authentication happens automatically when you run `pull` or `sync` commands. The `login` and `logout` commands are primarily used for troubleshooting authentication issues (see [Troubleshooting](#troubleshooting)).

**Required Permissions:** You must be an Org Admin, Instance Admin, or have Manager role to perform CLI operations.
---
## Commands

### Pull Command

Download content from an Agility CMS instance to your local file system for backup, migration, or synchronization purposes.

```bash
agility pull [options]
```

#### Pull Options

**Core Instance Options:**

| Option         | Type    | Default     | Description                                                         |
| -------------- | ------- | ----------- | ------------------------------------------------------------------- |
| `--sourceGuid` | string  | _(empty)_ | Source instance GUID (required for sync, can be from .env for pull) |
| `--locales`    | string  | _(empty)_ | Comma-separated list of locales to operate on. If not specified, locales are automatically pulled from the instance |

**Content Selection Options:**

| Option       | Type   | Default                                                      | Description                                                                                                          |
| ------------ | ------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `--elements` | string | `Models,Galleries,Assets,Containers,Content,Templates,Pages` | Comma-separated list of elements to process                                                                          |
| `--models`   | string | _(empty)_                                                    | Comma-separated list of model reference names to sync (only syncs the specified models)                             |

**File System Options:**

| Option       | Type    | Default         | Description                      |
| ------------ | ------- | --------------- | -------------------------------- |
| `--rootPath` | string  | `agility-files` | Root directory for local files   |

**Operation Control Options:**

| Option     | Type    | Default | Description                                                                 |
| ---------- | ------- | ------- | --------------------------------------------------------------------------- |
| `--update` | boolean | `false`  | Set to `true` to force updating source data                 |

**UI & Output Options:**

| Option       | Type    | Default | Description                  |
| ------------ | ------- | ------- | ---------------------------- |
| `--headless` | boolean | `false` | Disable logging and console/terminal output, log to file only (CI/CD) |
| `--verbose`  | boolean | `true`  | Detailed console output      |

#### Pull Examples

```bash
# Basic pull
agility pull --sourceGuid="abc123"

# Pull specific elements only
agility pull --sourceGuid="abc123" --locales="en-us" --elements="Models,Content"

# Pull with update (refresh local files)
agility pull --sourceGuid="abc123" --locales="en-us" --update=true

# Pull from live environment
agility pull --sourceGuid="abc123" --locales="en-us"
```
---
### Sync Command

Synchronize content between two Agility CMS instances with intelligent dependency resolution.

```bash
agility sync [options]
```

#### Sync Options

**Core Instance Options:**

| Option         | Type    | Default     | Description                                                         |
| -------------- | ------- | ----------- | ------------------------------------------------------------------- |
| `--sourceGuid` | string  | _(empty)_ | Source instance GUID (required for sync)                            |
| `--targetGuid` | string  | _(empty)_ | Target instance GUID (required for sync)                            |
| `--locales`    | string  | _(empty)_ | Comma-separated list of locales to operate on. If not specified, locales are automatically pulled from the source instance. **Note:** For sync operations, if locales are not specified, the target instance must have all the same locales set up, or the sync will error. You can selectively sync only specific locales (e.g., `--locales="en-us"`) to avoid requiring all locales to be set up in the target instance |

**Content Selection Options:**

| Option             | Type   | Default                                                      | Description                                                                                                          |
| ------------------ | ------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `--elements`       | string | `Models,Galleries,Assets,Containers,Content,Templates,Pages` | Comma-separated list of elements to process                                                                          |
| `--models`         | string | _(empty)_                                                    | Comma-separated list of model reference names to sync (only syncs the specified models)                             |
| `--models-with-deps` | string | _(empty)_                                                    | Comma-separated list of model reference names to sync with dependencies (includes content, assets, galleries, containers, and lists, but not pages) |

**File System Options:**

| Option       | Type    | Default         | Description                      |
| ------------ | ------- | --------------- | -------------------------------- |
| `--rootPath` | string  | `agility-files` | Root directory for local files   |

**Operation Control Options:**

| Option           | Type    | Default | Description                                                                                                                                    |
| ---------------- | ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `--update`       | boolean | `false` | Download fresh data from source instance before operations, if left false, incremental sync is performed to only get changed data.           |
| `--overwrite`    | boolean | `false` | Force update existing items in target instance instead of creating new items with -1 IDs. Default: false (Warning: may cause duplicate items in lists, overwriting existing content) |
| `--autoPublish`  | string  | _(disabled)_ | Automatically publish synced items that were published in the source instance. Values: `content`, `pages`, `both`. If flag is provided without a value, defaults to `both`. Items that are only in staging (not published) in the source are skipped. |

**UI & Output Options:**

| Option       | Type    | Default | Description                                                                    |
| ------------ | ------- | ------- | ------------------------------------------------------------------------------ |
| `--headless` | boolean | `false` | Disable logging and console/terminal output, log to file only (CI/CD)          |
| `--verbose`  | boolean | `true`  | Detailed console output                                                        |


#### Sync Examples

```bash
# Basic sync (pulls fresh data by default, syncs all locales from source)
agility sync --sourceGuid="abc123" --targetGuid="def456"

# Sync specific locale only (target instance only needs this locale set up)
agility sync --sourceGuid="abc123" --targetGuid="def456" --locales="en-us"

# Sync specific elements only
agility sync --sourceGuid="abc123" --targetGuid="def456" --elements="Assets"

# Force update existing items
agility sync --sourceGuid="abc123" --targetGuid="def456" --overwrite

# Sync only specified models (models only, no dependencies)
agility sync --sourceGuid="abc123" --targetGuid="def456" --models="BlogPost,BlogCategory"

# Sync models with dependencies (includes content, assets, galleries, containers, lists, but not pages)
agility sync --sourceGuid="abc123" --targetGuid="def456" --models-with-deps="BlogPost,BlogCategory"

# Sync and auto-publish everything that was published in source
agility sync --sourceGuid="abc123" --targetGuid="def456" --autoPublish

# Sync and auto-publish only content (not pages)
agility sync --sourceGuid="abc123" --targetGuid="def456" --autoPublish=content

# Sync and auto-publish only pages
agility sync --sourceGuid="abc123" --targetGuid="def456" --autoPublish=pages
```
---
## Advanced Topics

### Auto-Publish

The `--autoPublish` flag lets you automatically publish synced content and/or pages in the target instance immediately after a sync completes. Only items that are **published in the source instance** will be published in the target — staging-only items are skipped.

#### Modes

| Value     | Behavior                                      |
| --------- | --------------------------------------------- |
| `both`    | Publish both content items and pages (default when flag is provided without a value) |
| `content` | Publish only content items                    |
| `pages`   | Publish only pages                            |

#### How It Works

1. During sync, the CLI tracks which content items and pages were successfully pushed to the target instance
2. It also checks the publish state of each item in the source — only items with a published state are eligible
3. After all sync operations complete, the CLI publishes the eligible items in the target using the batch workflow API
4. Publishing is done per-locale to match the workflow API requirements
5. After publishing, reference mappings are updated to reflect the new published versions

#### Examples

```bash
# Auto-publish everything (content + pages) — flag without value defaults to 'both'
agility sync --sourceGuid="abc123" --targetGuid="def456" --autoPublish

# Explicitly publish both
agility sync --sourceGuid="abc123" --targetGuid="def456" --autoPublish=both

# Publish only content items (skip pages)
agility sync --sourceGuid="abc123" --targetGuid="def456" --autoPublish=content

# Publish only pages (skip content)
agility sync --sourceGuid="abc123" --targetGuid="def456" --autoPublish=pages
```

> **Note:** Auto-publish only works with `sync` operations (not `pull`). Items that fail to sync will not be published. Any publish errors are reported in the final summary alongside sync errors.

---

### Model-Specific Sync

The CLI provides two options for selective synchronization based on specific content models: `--models` and `--models-with-deps`. This is particularly useful for large instances where you only want to sync certain content types.

#### --models

The `--models` parameter syncs **only the specified models** in CSV format. It does not include any dependencies.

```bash
# Sync only the specified models (no dependencies)
agility sync --sourceGuid="abc123" --targetGuid="def456" --models="BlogPost,BlogCategory"
```

#### --models-with-deps

The `--models-with-deps` parameter syncs the specified models **plus their dependencies**. It includes:
- Content items based on those models
- Assets referenced by the content
- Galleries referenced by the content
- Containers
- Lists

**Note:** Pages are **not** included when using `--models-with-deps`.

```bash
# Sync models with all dependencies (except pages)
agility sync --sourceGuid="abc123" --targetGuid="def456" --models-with-deps="BlogPost,BlogCategory"
```

#### Model-Specific Examples

```bash
# Sync only models (no dependencies)
agility sync --sourceGuid="abc123" --targetGuid="def456" --models="BlogPost,BlogCategory"

# Sync models with dependencies (content, assets, galleries, containers, lists - but not pages)
agility sync --sourceGuid="abc123" --targetGuid="def456" --models-with-deps="Product,ProductCategory,ProductReview"
```

#### Benefits of Model-Specific Sync

- **Faster Operations**: Only processes relevant content instead of entire instance
- **Targeted Updates**: Perfect for content-specific deployments
- **Flexible Control**: Choose between models-only or models with dependencies

### Sync Token Management

The Agility CLI uses the Content Sync SDK for incremental content synchronization. Understanding how sync tokens work is crucial for managing pull and sync operations effectively.

#### How Sync Tokens Work

**Sync tokens** are stored in the `state/sync.json` file and enable incremental content synchronization:

```
agility-files/{instance-guid}/{locale}/preview/state/sync.json
agility-files/{instance-guid}/{locale}/live/state/sync.json
```

**Token Behavior:**

- **First Pull**: No sync token exists → **Full sync** downloads all content
- **Subsequent Pulls**: Sync token exists → **Incremental sync** downloads only changes since last pull
- **Content Sync SDK**: Automatically manages token creation and updates
- **Management SDK**: Templates, models, containers, assets, galleries don't use sync tokens

### Reference Mappings

Reference mappings persist state between two Agility CMS instances during sync operations. They establish relationships between source entities and their corresponding target entities, allowing the CLI to resolve dependencies and avoid conflicts during sync operations.

#### How Mappings Work

When you run a sync operation, the CLI performs a mapping process:

1. **Discovery Phase**: Analyzes both source and target instances to catalog all existing entities
2. **Mapping Creation**: Establishes relationships between source and target entities using reliable identification strategies
3. **Dependency Resolution**: Uses mappings to transform entity references (like model IDs, asset URLs, content references) from source values to target values during sync

#### Mapping Persistence

Mappings are automatically saved to disk to persist state between sync operations:

```
agility-files/
├── mappings/
│  └──{sourceGuid}-{targetGuid}/
│    └── {locale}/
│       ├── item/         # Content items
│       ├── page/         # Page definitions
│    ├── assets/           # Asset files and metadata
│    ├── galleries/    # Gallery definitions
│    ├── models/           # Content models
│    ├── containers/       # Content containers
│    ├── templates/        # Page templates
```

> **⚠️ CRITICAL WARNING: Mapping File Safety**
> 
> **If you lose your mappings, syncing again will result in duplicate content being created in the target instance.** The CLI uses mappings to identify existing content and avoid duplicates. Without mappings, it cannot determine what already exists and will create new items.
> 
> **Recommended Practices:**
> - **Persist your mappings** through shared file storage or a repository (e.g., Git) when working on a team
> - **Do not have multiple instances of the CLI syncing the same source→target instance pairs simultaneously** - this can cause mapping conflicts and duplicate content
> - **Back up your `agility-files/mappings/` directory** before performing destructive operations

## File Structure

The CLI organizes downloaded content in a structured format:

```
agility-files/
├── mappings/             # Reference mappings for sync operations
├── {instance-guid}/
│   └── {locale}/
│       ├── item/         # Content items
│       ├── page/         # Page definitions
│   ├── assets/           # Asset files and metadata
│   │   ├── json/         # Asset metadata
│   ├── galleries/        # Gallery definitions
│   ├── models/           # Content models
│   ├── containers/       # Content containers
│   ├── templates/        # Page templates
│   ├── sitemap/          # Flat sitemap
│   ├── urlredirections/  # URL redirections
│   ├── state/            # Sync state and tokens
│   ├── nestedsitemap/    # Nested sitemap structure
├── logs/                 # Operation logs
```

## Configuration

### Environment Variables

For CI/CD pipelines and automation, you can configure the CLI using environment variables. Command line arguments always override environment variables when both are provided.

| Environment Variable     | Command Argument  | Description                                     |
| ------------------------ | ----------------- | ----------------------------------------------- |
| `AGILITY_GUID`           | `--sourceGuid`    | Default source instance GUID                    |
| `AGILITY_TARGET_GUID`    | `--targetGuid`    | Default target instance GUID                    |
| `AGILITY_LOCALES`        | `--locales`       | Comma-separated list of locales to operate on   |
| `AGILITY_WEBSITE`        | `--channel`       | Default channel name                            |
| `AGILITY_ELEMENTS`       | `--elements`      | Default elements to process                     |
| `AGILITY_MODELS`         | `--models`        | Default models to sync (comma-separated, models only)        |
| `AGILITY_MODELS_WITH_DEPS` | `--models-with-deps` | Default models to sync with dependencies (comma-separated) |
| `AGILITY_ROOT_PATH`      | `--rootPath`      | Default root directory                          |
| `AGILITY_VERBOSE`        | `--verbose`       | Default verbose output setting                  |
| `AGILITY_HEADLESS`       | `--headless`      | Default headless mode setting                   |
| `AGILITY_UPDATE`         | `--update`        | Default fresh data setting (both pull and sync) |
| `AGILITY_OVERWRITE`      | `--overwrite`     | Default overwrite setting (sync only)           |

## Troubleshooting

### Authentication Issues

Authentication happens automatically when you use `pull` or `sync` commands. However, if you encounter authentication errors, you can manually manage your authentication:

```bash
# Clear existing authentication
agility logout

# Re-authenticate (opens browser window)
agility login
```

**Note:** The `login` command opens a browser window for secure authentication. You must be an Org Admin, Instance Admin, or have Manager role to perform CLI operations.

### Log Files

All operations create detailed logs. Check the following locations:

- Operation logs: `agility-files/{instance-guid}/{locale}/preview/logs/` or `agility-files/{instance-guid}/{locale}/live/logs/`
- General logs: `agility-files/logs/` (if applicable)

## Support

- **Documentation**: [Agility CMS Help Center](https://help.agilitycms.com/hc/en-us)
- **Community**: [Agility Slack](https://join.slack.com/t/agilitycommunity/shared_invite/enQtNzI2NDc3MzU4Njc2LWI2OTNjZTI3ZGY1NWRiNTYzNmEyNmI0MGZlZTRkYzI3NmRjNzkxYmI5YTZjNTg2ZTk4NGUzNjg5NzY3OWViZGI)
- **Issues**: [GitHub Issues](https://github.com/agility/agility-cms-management-cli/issues)
- **Website**: [agilitycms.com](https://agilitycms.com)

---

_Built with ❤️ by the Agility CMS team_
