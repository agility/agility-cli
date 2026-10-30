# Live sync test (`sync-permutation.yml`)

An end-to-end test of `agility sync` against real instances. Each run leases throwaway instances,
syncs a source to a target with the CLI under test, checks the result, and always deletes the
instances afterwards.

The unit tests (`test.yml`) and the hermetic sync tests (`integration-tests.yml`) need no
credentials and run on every PR, forks included. This test needs credentials, so it runs only where
they're available.

## When it runs

| Trigger                                                          | Tier        | CLI under test                                                |
| ---------------------------------------------------------------- | ----------- | ------------------------------------------------------------- |
| A pull request from a branch in this repo                        | `quick`     | the PR's build. The result shows as a check on the PR         |
| A `v*` tag push (each release, published to npm `beta`)          | `beta`      | the published package, installed from npm                     |
| Nightly at 07:00 UTC                                             | `nightly`   | `main`. Also deletes any instances an earlier run left behind |
| By hand (Actions tab → _Sync permutation test_ → _Run workflow_) | your choice | the branch you pick, or a published version                   |

Pull requests from forks and from Dependabot skip it, because they get no credentials.

From a terminal:

```bash
gh workflow run sync-permutation.yml -f tier=quick
gh workflow run sync-permutation.yml -f tier=beta -f cli_version=1.2.3   # test a published version
gh run rerun <run-id>                                                    # re-run with fresh instances
```

## What it checks

Today (the first slice):

- **First sync:** `sync` exits 0 and its `--jsonSummary` reports no failed items.
- **verify:** `agility verify` reports that the target matches the source (exit 0).
- **Nothing left to sync:** an immediate `sync --preflight` plans no creates, updates or conflicts.

Each check is a row in the run's job summary. The JSON results are kept as an artifact for 30 days.
Later slices add generated sources, rounds of changes on both sides, more target types, and
reverse, round-trip and chained syncs.

## Promotion to `latest`

`npm-publish.yml` refuses to promote a version to `latest` unless that version's tag run of this
test passed. If a tag run failed for a reason unrelated to the CLI, re-run it, then promote again.

## Cleanup

Instances are deleted in three ways, so a run can't leave them behind:

1. The `release` job runs after every run, including failed and cancelled ones, and deletes every
   instance labelled with that run.
2. Every instance expires shortly after the run's time budget and is then deleted automatically.
3. The nightly run deletes any instance from an earlier run that is more than 6 hours old.

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
