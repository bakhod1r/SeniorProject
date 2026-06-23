# Workspaces — Optimization

> Honest framing first: a `go.work` file by itself has nothing to optimize. What deserves attention is everything that flows from a workspace decision: contributor onboarding speed, CI run time, reliability of release-time builds, and the prevention of "workspace masking" bugs.
>
> Each entry below states the problem, shows a "before" setup, an "after" setup, and the realistic gain. The goal is not to add more workspace machinery — it is to use the minimum that earns its weight.

---

## Optimization 1 — Move every `replace ../sibling` from `go.mod` into `go.work`

**Problem:** A multi-module repo has accumulated `replace` directives in each `go.mod` pointing at sibling folders. The directives are dev-time conveniences but ship with releases, breaking consumers who have never heard of `../shared`.

**Before (`server/go.mod`):**

```
module example.com/proj/server

require example.com/proj/shared v0.3.0

replace example.com/proj/shared => ../shared
```

When `server v1.0.0` is published, the `replace` line is part of the published `go.mod`. Consumers fail to build.

**After (`go.work` at repo root):**

```
go 1.22

use (
    ./server
    ./shared
)
```

`server/go.mod` is restored to its honest form (just the `require`, no `replace`). The workspace handles the dev-time substitution.

**Gain:** Released `go.mod` files are clean. Consumers can actually use the published versions. Onboarding-day debugging time saved across every future release.

---

## Optimization 2 — Add the two-build CI matrix

**Problem:** CI runs only the workspace-active build. Bugs that depend on cross-module unpublished references slip through to release.

**Before (CI):**

```yaml
- run: go test ./...
```

**After:**

```yaml
jobs:
  workspace-build:
    steps:
      - run: go test ./...

  isolated-build:
    strategy:
      matrix:
        module: [server, auth, billing, shared]
    steps:
      - run: GOWORK=off go test ./...
        working-directory: ${{ matrix.module }}
```

Both must pass for the PR to merge.

**Gain:** Release-time bugs surface at PR time. The number of "I forgot to publish a sibling" hotfixes drops to zero. Total CI time is roughly doubled but parallelisable, and the second build hits cache for unchanged modules.

---

## Optimization 3 — Cache `$GOMODCACHE` keyed on `go.sum` files

**Problem:** Cold CI runners re-download every dependency on every build. With many modules and overlapping transitive sets, the network cost dominates.

**Before:**

```yaml
- uses: actions/setup-go@v5
  with: { go-version: '1.22' }
- run: go test ./...
```

**After:**

```yaml
- uses: actions/setup-go@v5
  with:
    go-version: '1.22'
    cache: true
    cache-dependency-path: |
      **/go.sum
      go.work.sum
```

The cache key now includes every `go.sum` *and* `go.work.sum`, restored on cache hit and rebuilt on dependency change.

**Gain:** Per-job CI time drops by tens of seconds on cache hit. On a busy repo with multiple PRs per day, this is the single highest-impact tweak after workspace introduction.

---

## Optimization 4 — Run `go work sync` in CI and fail on diff

**Problem:** Engineers forget to run `go work sync` before committing. Each `go.mod`'s `require` lines drift from the workspace's resolved versions. Eventually a release ships with stale `require` lines and a consumer is missing a feature.

**Before:** No sync check. Drift accumulates silently.

**After (CI):**

```yaml
- name: Verify workspace sync
  run: |
    go work sync
    git diff --exit-code go.work '*/go.mod' '*/go.sum' go.work.sum
```

The PR fails if `go work sync` produces any change. Engineers re-run locally and commit before merging.

**Gain:** Every release has up-to-date `go.mod` files. The "release-day surprise" of a stale require disappears.

---

## Optimization 5 — Recursive `go work use -r` for monorepo bootstrap

**Problem:** Teams hand-edit `go.work` to add new modules. Easy to miss a sub-module. The workspace becomes inconsistent.

**Before:** A README that says "edit `go.work` and add a `use ./newmod` line."

**After:** A `bootstrap` script:

```bash
#!/usr/bin/env bash
go work init
go work use -r .
```

Or, for a stable workspace:

```bash
go work use -r .
```

run periodically. The `-r` flag scans recursively and adds every directory containing a `go.mod`.

**Gain:** Onboarding is two commands. Adding a new module is "create the folder with `go mod init`, run `go work use -r .`." Forgotten `use` lines disappear.

**Caveat:** Review the `go.work` diff after `-r .` runs — it may pick up sub-modules you do not want grouped (e.g., `examples/`, `_archive/`). Filter with explicit paths in those cases.

---

## Optimization 6 — Replace per-module `go test ./...` loops with workspace-wide `./...`

**Problem:** A Makefile or script loops over modules to run tests, each invocation paying the toolchain startup cost.

**Before:**

```makefile
test:
	for m in $(MODULES); do (cd $$m && go test ./...); done
```

**After (with workspace):**

```makefile
test:
	go test ./...
```

When run from the workspace root, `./...` expands across every listed module. One `go test` invocation, one toolchain startup, parallel package execution.

**Gain:** A few seconds per `make test` and parallel test execution that the per-module loop did not get. On a workspace with ten modules, total test time drops by 20-40%.

The release-time test still uses the per-module loop with `GOWORK=off` — that is the *correct* duplication.

---

## Optimization 7 — Forbid workspace-level `replace` in main branch

**Problem:** Workspace `replace` directives accumulate. "Temporary" pins to forks become permanent. Auditing supply-chain risk becomes painful.

**Before:** No policy. Engineers add `replace` lines and forget them.

**After (CI):**

```bash
if grep -qE '^[[:space:]]*replace' go.work; then
    echo "ERROR: workspace replace directives are forbidden in main"
    exit 1
fi
```

Add this to the merge gate. PRs that introduce a `replace` are explicitly reviewed and approved with a comment trail.

**Alternative (allow-list):**

```bash
allowed='^replace github\.com/forks/.*'
unexpected=$(grep -E '^[[:space:]]*replace' go.work | grep -vE "$allowed" || true)
if [ -n "$unexpected" ]; then
    echo "ERROR: unexpected replace directives:"
    echo "$unexpected"
    exit 1
fi
```

**Gain:** Replace directives stop being "set and forget." Each one carries a name on a PR and an explicit reviewer approval. Quarterly audits of the workspace `replace` lines become trivial.

---

## Optimization 8 — Workspace-level vendor for air-gapped CI (Go 1.22+)

**Problem:** A CI environment cannot reach the public proxy. Builds time out at the network step. Per-module `vendor/` directories are not workspace-compatible.

**Before:** Per-module `vendor/` ignored by the workspace; builds fail under `-mod=vendor` with the workspace active.

**After:**

```bash
go work vendor
go build -mod=vendor ./...
```

`vendor/` at the workspace root holds every dependency every listed module needs. Subsequent builds use it offline.

**Gain:** Zero network access at build time. CI can run inside the most locked-down environment. The trade-off is a larger repo (vendored source) and the discipline of running `go work vendor` after every dependency change.

---

## Optimization 9 — `GOWORK=off` for release binaries with `-trimpath`

**Problem:** Release binaries built inside the workspace embed local file paths and may differ in subtle ways from a clean rebuild. Reproducibility is broken.

**Before:**

```bash
go build -o api .
```

**After:**

```bash
cd cmd/api
GOWORK=off go build -trimpath -ldflags='-s -w' -o api .
```

`GOWORK=off` ensures the build is a function of `cmd/api/go.mod` and `go.sum` only. `-trimpath` strips local file paths. `-ldflags='-s -w'` strips debug symbols (optional; do this if you don't need them).

**Gain:** Reproducible binaries. Two CI runs of the same commit produce byte-identical artefacts. Provenance and SBOM generation become straightforward.

---

## Optimization 10 — Document the workspace bootstrap in three lines

**Problem:** New contributors lose 30 minutes figuring out the multi-module layout. They run `go build` in the wrong folder; they don't know about `go.work`; they read three pages of internal documentation before they get a green build.

**Before:** A wiki page titled "Building the project."

**After:** Three lines at the top of the README:

```
# Setup
git clone <repo>
cd <repo>
cp go.work.example go.work     # or: go work init ./mod1 ./mod2 ./mod3
go test ./...
```

Plus a `.gitignore` entry for `go.work` and `go.work.sum`, and a committed `go.work.example` template.

**Gain:** Onboarding from clone to green build in under a minute. Half the "weird build error" Slack questions disappear.

---

## Optimization 11 — Pre-commit hook that runs `go work sync` and `go mod tidy`

**Problem:** Engineers push commits with un-synced `go.mod` files. CI catches it but the round-trip wastes time.

**Before:** No pre-commit checks. CI is the first line of defence.

**After (`.git/hooks/pre-commit`):**

```bash
#!/usr/bin/env bash
set -euo pipefail

go work sync
for m in $(go list -f '{{.Dir}}' -m); do
    (cd "$m" && GOWORK=off go mod tidy)
done

if ! git diff --quiet -- '*/go.mod' '*/go.sum' go.work go.work.sum; then
    echo "go.mod/go.work files are out of sync. Stage the changes:"
    git diff --stat -- '*/go.mod' '*/go.sum' go.work go.work.sum
    exit 1
fi
```

Or use `pre-commit` (the framework) with a similar hook.

**Gain:** Drift caught on the developer's machine, not in CI. Faster feedback loop, fewer "fix tidy" follow-up commits in the git log.

---

## Optimization 12 — Split a too-big workspace into per-area workspaces

**Problem:** A single `go.work` lists fifteen modules. CI takes 25 minutes. Every module rebuilds when any other changes. Engineers have to keep modules they never touch checked out.

**Before:**

```
mono/
├── go.work             # 15 use directives
└── (15 module folders)
```

**After (split by team or domain):**

```
mono/
├── auth/
│   ├── go.work         # 3 use directives
│   ├── service/
│   ├── tokens/
│   └── ldap-bridge/
├── billing/
│   ├── go.work         # 2 use directives
│   ├── service/
│   └── invoicing/
├── frontend/
│   ├── go.work
│   ├── ui/
│   └── widgets/
└── shared/
    └── go.mod          # released as example.com/mono/shared
```

Cross-area imports go through published versions of `shared`, not through the workspace.

**Gain:** Per-area CI runs are 5-10 minutes instead of 25. Engineers check out only the area they own. Coupling between teams is forced to go through real version boundaries, which improves architectural hygiene.

The split takes effort — you have to actually *publish* `shared` rather than relying on the workspace — but the long-term benefit is large.

---

## Optimization 13 — Pre-flight build for releases

**Problem:** A release script tags a module; the next module in the cascade fails to build against the new tag. The release is half-done; the tag exists; rolling back is messy.

**Before:** Tag, push, hope.

**After (pre-flight):**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Simulate every step of the cascade locally before tagging anything.
for module in shared auth server; do
    (cd "$module" && GOWORK=off go build ./... && GOWORK=off go test ./...)
done

# All green? Now do the cascade for real.
for module in shared auth server; do
    cd "$module"
    git tag "$module/$(cat ../release-versions/$module.txt)"
    cd ..
done
git push --tags
```

The pre-flight catches failures before any tag is created. If a module fails, fix and retry; nothing is committed externally yet.

**Gain:** Aborted releases are 100% recoverable. The release log shows clean tag-after-tag-after-tag, no half-rolled-back middles.

---

## Optimization 14 — Audit and prune `use` directives quarterly

**Problem:** Modules come and go. The `go.work` accumulates stale `use` lines for folders that have been deleted or renamed.

**Before:** No periodic cleanup. Eventually `go.work` references a non-existent folder and the build breaks for someone.

**After:** A small script, run by a scheduled CI job:

```bash
#!/usr/bin/env bash
set -euo pipefail

while read -r line; do
    if [[ "$line" =~ ^[[:space:]]*([./].+)$ ]]; then
        path="${BASH_REMATCH[1]}"
        if [ ! -f "$path/go.mod" ]; then
            echo "MISSING: $path"
        fi
    fi
done < <(grep -E '^\s+\./' go.work)
```

Run weekly or on every push. Fail the build if any listed `use` path is missing or no longer a module.

**Gain:** `go.work` is always honest. The "directory ./X does not exist" build failure is caught at scheduled-job time, not at random merge time.

---

## Closing Notes

The pattern across these optimizations:

- **Workspaces are leverage.** A small file changes how dozens of modules behave. Use the leverage carefully.
- **The release boundary is the real boundary.** Optimizations that protect it (`GOWORK=off` builds, sync checks, replace audits) are higher value than optimizations that just speed up dev-time builds.
- **Small CI checks compound.** A handful of two-line scripts (`grep`, `git diff --exit-code`) prevent classes of bugs that would otherwise need post-release hotfixes.
- **Boundaries scale better than monoliths.** When a workspace grows past a dozen modules, splitting beats optimising. The split forces published-version contracts, which improve everything.

If you adopt only two of these, adopt the two-build CI matrix (Optimization 2) and the sync-or-fail check (Optimization 4). They cover most of the workspace-related production incidents we see in real Go monorepos.
