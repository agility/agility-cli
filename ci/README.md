# Live sync test (`sync-permutation.yml`)

An end-to-end test of `agility sync` against real instances. Each run leases throwaway instances,
syncs a source to a target with the CLI under test, checks the result, and always deletes the
instances afterwards.

The unit tests (`test.yml`) and the hermetic sync tests (`integration-tests.yml`) need no
credentials and run on every PR, forks included. This test needs credentials, so it runs only where
they're available.

## When it runs

It leases two instances and runs for 10 to 15 minutes, so it runs only for a release, and by hand:

| Trigger                                                          | Tier        | CLI under test                                   |
| ---------------------------------------------------------------- | ----------- | ------------------------------------------------ |
| A `v*` tag push (a release; `npm-publish.yml` calls it)          | `beta`      | the tag's build. npm gets it only if this passes |
| By hand (Actions tab → _Sync permutation test_ → _Run workflow_) | your choice | the branch you pick, or a published version      |

From a terminal:

```bash
gh workflow run sync-permutation.yml -f tier=quick
gh workflow run sync-permutation.yml -f tier=beta -f cli_version=1.2.3   # test a published version
gh run rerun <run-id>                                                    # re-run with fresh instances
```

## What it checks

Before the first sync, `ci/permutation/fixtures.mjs` adds what the blog template lacks: content
that references each other (A ↔ B) and itself, through a required linked field with a companion
field (PROD-3076). After round 0, the **cycles** check confirms each copy on B points at its
partner's B ID.

A run first syncs source **A** to target **B**, then runs rounds of changes in alternating
directions:

- **Odd rounds** edit A and `sync` A → B.
- **Even rounds** edit B and `reverse-sync` B → A.
- **Every round** also edits the other instance (drift: a content item, a list's order, a page
  template's section name and a URL redirection's destination) and one item on both sides (a
  conflict). Before syncing, the run waits for the Fetch API to show each edit, a list's new order
  included (it shows up later than a new version). The redirection is one the run adds to A before the first sync; the Management SDK can
  only delete redirections, so the run saves it through the Management API's batch endpoint and
  waits for the Fetch API to list each edit, as the CLI does.

The changes, in `ci/permutation/changes.mjs`, are discovered from whatever each instance holds:

| Area       | Changes                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------- |
| Content    | edit, add, add a linked item together with an item that links to it, delete, publish and unpublish |
| Ordering   | move a list's last item to the top (as drag and drop does, no new versions); reverse the components in a page zone |
| Pages      | edit title and menu text, add a page, delete it later                                              |
| Components | remove one from a zone                                                                             |
| Models     | add a field, change a label, rename a field                                                        |
| Templates  | rename a section's display name                                                                    |

The `quick` tier runs a fixed set covering every area in two rounds. `beta` (4 rounds) and `nightly`
(6 rounds) pick changes at random from a seed printed in the summary. Replay one with
`gh workflow run sync-permutation.yml -f tier=nightly -f seed=<seed>`.

Every sync and preflight passes `--syncDeletes`, so a delete on one side reaches the other. After
every sync it checks:

- **sync:** exit 0 and no failed items in `--jsonSummary`;
- **conflict:** the item edited on both sides ends at the synced side's value, or the sync reported a
  conflict;
- **drift:** an edit made only on the receiving side is overwritten, or kept with a "target changed"
  warning (not a conflict), never silently kept;
- **drift:listOrder, drift:template, drift:urlRedirection:** a list reorder, a template edit or a
  redirection edit made only on the receiving
  side is kept with a "target changed" warning, or reported as a conflict when the round's own changes
  touched the same list or template. These have no version, so the sync tells which side changed
  from what it recorded at the last sync (PROD-3078); overwriting them without `--overwrite` fails;
- **resolve:** when the sync kept such edits, the same sync with `--overwrite` settles them, as an
  editor would, before the checks below;
- **verify:** `agility verify` finds no differences. A verify that finds some is tried once more a
  minute later, because the Fetch API it reads lags behind saves (a model field rename most of all);
- **noop:** a `--preflight` in the same direction plans no creates, updates, deletes or conflicts;
- **apply:** the change itself could be made.

Nothing stops a run early: every round runs, and each check is a row in the job summary. The JSON
results are kept as an artifact for 30 days.

## Promotion to `latest`

A `v*` tag push runs this test on the tag's build first, and `npm-publish.yml` publishes to npm
(under `beta`) only if it passed, so every version on npm from then on has passed it. If it failed
for a reason unrelated to the CLI, re-run the failed jobs of that tag's _Publish to npm_ run: the
test runs again on fresh instances, then the publish. Promote a published version to `latest` with
_Publish to npm_ → _Run workflow_.

## Cleanup

Instances are deleted in three ways, so a run can't leave them behind:

1. The `release` job runs after every run, including failed and cancelled ones, and deletes every
   instance labelled with that run.
2. Every instance expires shortly after the run's time budget and is then deleted automatically.
3. Every run first deletes any instance from an earlier run that is more than 6 hours old.

## Running it locally

The scripts need no dependencies beyond Node 20+. With `LEASE_API_URL` and `LEASE_API_TOKEN` set (ask
the CLI maintainers), and `AGILITY_TOKEN` set to a token that can write to the leased instances:

```bash
npm run build
node ci/leases.mjs create my-run- source:blog target:blank      # prints both instance GUIDs
SOURCE_GUID=<source> TARGET_GUID=<target> CLI="node $PWD/dist/index.js" node ci/permutation/run.mjs
node ci/leases.mjs release my-run-
```

Results land in `./permutation-out`. The CLI's own logs are under `permutation-out/work/agility-files/logs`.

## Configuration

Everything that identifies our infrastructure lives in the `cli-dev-live` GitHub Environment as
**secrets**, not in this repo and not as variables. The Actions logs of a public repo are public,
and GitHub masks secrets in them but prints variables.
