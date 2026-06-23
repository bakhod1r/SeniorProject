# Minimal Version Selection (MVS) — Optimization

> Honest framing first: MVS itself is not slow. Selecting the maximum required version per module is a linear graph walk with no backtracking — it is never the bottleneck. What is genuinely worth optimizing is the *cost of loading the module graph*, the *currency process* MVS deliberately omits, the *legibility* of dependency-version changes, and the *quality of the floors* you commit. "Optimizing MVS" really means optimizing the workflow and the graph around a fast, deterministic core.
>
> Each entry below states the problem, shows a "before" setup, an "after" setup, and the realistic gain. The closing sections cover measurement and the cases where the apparent optimization is the wrong move.

---

## Optimization 1 — Enable module graph pruning by bumping the `go` directive

**Problem:** With a `go` directive below 1.17, MVS loads the *entire transitive module graph* — every `go.mod` of every reachable module, however deep and however irrelevant. On a large dependency tree, `go list -m all`, `go mod graph`, and `go get` all pay this cost.

**Before:**
```text
// go.mod
go 1.15
```
```bash
$ time go list -m all     # loads the full transitive graph
real    0m11.8s
```

**After:**
```bash
$ go mod edit -go=1.22
$ go mod tidy             # pins the build list as // indirect requires
$ time go list -m all
real    0m0.7s
```
Pruning scopes the graph to requirements needed for actually-imported packages; lazy loading defers reading `go.mod` files until needed.

**Expected gain:** On large graphs, module operations drop from seconds to sub-second. Critically, pruning changes the *work*, not the *result* — the build list is identical. This is the single highest-leverage MVS performance action.

---

## Optimization 2 — Warm the module cache before MVS needs the graph

**Problem:** Computing the build list requires reading each relevant module's `go.mod`. On a cold cache (fresh CI runner), MVS triggers proxy fetches for those `go.mod` files, serialising network round-trips into every module command.

**Before:**
```yaml
- uses: actions/setup-go@v5
  with: { go-version: '1.23' }
- run: go build ./...     # cold: fetches go.mod files mid-build-list-computation
```

**After:**
```yaml
- uses: actions/setup-go@v5
  with:
    go-version: '1.23'
    cache: true                    # caches $GOMODCACHE keyed on go.sum
    cache-dependency-path: go.sum
- run: go build ./...              # graph already on disk; MVS is instant
```

**Expected gain:** On cache hits, graph loading is local-disk-fast and the network round-trips disappear. The MVS computation was never the cost — the `go.mod` fetches were.

---

## Optimization 3 — Inspect, don't recompute, the build list

**Problem:** Tooling that needs the selected versions sometimes re-implements MVS or re-runs heavy resolution, when the toolchain already exposes the computed result cheaply.

**Before:**
```bash
# custom script walking go.mod files and re-deriving versions by hand
$ ./my-mvs-reimplementation     # brittle, drifts across Go releases, slow
```

**After:**
```bash
$ go list -m -json all          # the authoritative build list, as data
$ go list -m all                # human-readable
$ go mod graph                  # the floors (input), if you need them
```

**Expected gain:** Correct results (including pruning, replace/exclude, version ordering) for free, and far faster than re-deriving. Never re-implement the `max`; the subtlety (pseudo-versions, `+incompatible`, pruning) is exactly what hand-rolled tooling gets wrong.

---

## Optimization 4 — Use `-u=patch` for routine currency, not `-u`

**Problem:** MVS never auto-upgrades, so you need a currency process — but `go get -u ./...` crosses minor-version boundaries, pulling in behavioural changes and larger review burden on every routine refresh.

**Before:**
```bash
# monthly maintenance
$ go get -u ./...     # jumps every dep to latest minor/patch — risky, noisy
```

**After:**
```bash
# routine, low-risk currency
$ go get -u=patch ./...   # latest PATCH within the current minor only
$ go mod tidy
$ govulncheck ./...
```
Reserve full `-u` for deliberate, tested minor bumps in their own PRs.

**Expected gain:** Patch-only upgrades pick up bug and security fixes with minimal behavioural risk, keeping routine dependency PRs small and reviewable. The blast radius per refresh shrinks; minor-version surprises move to intentional, isolated changes.

---

## Optimization 5 — Automate the currency MVS omits

**Problem:** Reproducibility means a repo can sit on stale, vulnerable versions forever, because MVS will not raise a floor on its own. "Someone will upgrade eventually" is usually nobody.

**Before:** `go.mod` last touched 14 months ago; `govulncheck` flags 6 transitive CVEs with patched releases available, and nobody noticed.

**After (scheduled refresh + scan):**
```yaml
# .github/workflows/deps.yml
on:
  schedule: [{ cron: '0 6 1 * *' }]   # 06:00 UTC, first of each month
  workflow_dispatch:
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.23' }
      - run: |
          go get -u=patch ./...
          go mod tidy
      - run: govulncheck ./... || true
      - uses: peter-evans/create-pull-request@v6
        with:
          title: 'deps: monthly patch refresh'
          branch: deps/monthly-refresh
```

**Expected gain:** CVE exposure window drops from "whenever someone notices" to roughly 30 days. The floor-raising diff is small (patch-level), reviewable, and reversible. MVS gives you a stable floor; this gives you currency on top.

---

## Optimization 6 — Make version changes legible in review

**Problem:** Because MVS encodes versions as committed floors, every upgrade is a `go.mod`/`go.sum` diff — but if upgrades are mixed into feature PRs, the version change hides among unrelated edits and gets rubber-stamped.

**Before:** One PR titled "add search endpoint" that also bumps three dependencies — reviewers cannot tell which `go.mod` lines are intentional.

**After:**
```bash
# Commit 1: the floor change only
$ go get github.com/some/lib@v1.5.0
$ go mod tidy
$ git add go.mod go.sum
$ git commit -m "deps: raise some/lib floor to v1.5.0"

# Commit 2: the code that uses the new version
$ git add internal/search/
$ git commit -m "search: use lib v1.5 API"
```
Reviewers read the floor change independently of the feature code.

**Expected gain:** Faster, more accurate review; `git bisect` can isolate a bad upgrade to one floor commit; `git blame go.mod` attributes every floor to a deliberate decision. MVS's "versions are source" property pays off only if the diffs are kept legible.

---

## Optimization 7 — Keep floors honest with `go mod tidy`

**Problem:** Over time, `go.mod` accumulates floors for modules no longer imported (stale direct requires) and drifts from the actual import graph. MVS faithfully honours every floor, so stale ones drag in versions and transitive trees you do not use.

**Before:**
```text
// go.mod
require github.com/old/unused v1.4.2   // last import removed two refactors ago
```
The unused floor pulls `old/unused` (and its transitive deps) into the build list.

**After:**
```bash
$ go mod tidy                          # drops floors with no importer
$ go mod why github.com/some/lib       # justify each remaining require
$ go list -m all | wc -l               # count before/after
```

**Expected gain:** A smaller, honest build list — fewer modules, smaller graph to load, fewer false-positive CVE alerts, and a `go.mod` that reflects what the project actually depends on. Run tidy after every dependency change.

---

## Optimization 8 — Trace a surprising selected version to one floor

**Problem:** A popular transitive module is selected at a version higher than you expected. Hunting through the whole graph by eye wastes time.

**Before:** Scrolling `go mod graph` output trying to spot which dependency forces `golang.org/x/sys` high.

**After (targeted query):**
```bash
# Highest floor for the module == its selected version, and who set it:
$ go mod graph | grep ' golang.org/x/sys@' | sort -t@ -k2 -V | tail -1
$ go mod why -m golang.org/x/sys
```
The last line of the sorted floors is the selected version; `go mod why` names the import chain.

**Expected gain:** Seconds instead of minutes to answer "why that version, and who is responsible." If the floor is undesirable, you now know exactly which dependency to upgrade or replace.

---

## Optimization 9 — Prefer `/vN` modules to make incompatible upgrades coexist

**Problem:** A breaking change in a dependency that does *not* follow the major-version-as-path-suffix convention (`+incompatible`) cannot coexist with the older major — you are forced into an all-or-nothing migration across the whole graph.

**Before:** `github.com/legacy/lib v2.0.0+incompatible` — v1 and v2 share the import path `github.com/legacy/lib`, so MVS must pick one, and every consumer must migrate together.

**After:** Prefer dependencies that publish `github.com/foo/bar/v2`. Then `github.com/foo/bar` (v1) and `github.com/foo/bar/v2` are *different modules* that MVS selects independently and that coexist in one build:
```bash
$ go list -m all | grep foo/bar
github.com/foo/bar v1.9.0
github.com/foo/bar/v2 v2.3.0
```

**Expected gain:** Incompatible upgrades become *incremental* — some code uses v1, some v2, no flag day. The SAT-world "diamond of death" turns into harmless coexistence. This is a dependency-selection optimization: choose libraries that version correctly.

---

## Optimization 10 — Detect dependency drift in CI without re-resolving

**Problem:** A CI step that runs heavy resolution or full `go get -u` on every PR is slow and produces noisy diffs on PRs that did not touch dependencies.

**Before:**
```yaml
- run: go get -u ./... && git diff --exit-code   # runs every PR; noisy, slow
```

**After (gate only when floors changed):**
```yaml
- name: Detect go.mod change
  id: m
  run: |
    git diff --name-only origin/main... | grep -E '^go\.(mod|sum)$' \
      && echo "changed=true" >> $GITHUB_OUTPUT || true
- name: Verify tidy is clean
  if: steps.m.outputs.changed == 'true'
  run: |
    go mod tidy
    git diff --exit-code -- go.mod go.sum
```

**Expected gain:** Faster CI on the majority of PRs (the check is skipped entirely), and a reliable signal when a floor *should* have been tidied but was not. MVS determinism means "tidy produced no diff" is a sufficient drift check — no re-resolution needed.

---

## Optimization 11 — Simulate upgrade impact in a sandbox before committing

**Problem:** Raising a floor can cascade (requirement tightening) and move several transitive versions. Discovering the blast radius *after* committing wastes a review cycle.

**Before:** `go get foo@v2.0.0` on the working tree, see the damage, `git checkout` to undo, repeat.

**After (read-only simulation):**
```bash
$ tmp=$(mktemp -d); cp -r . "$tmp"; ( cd "$tmp" \
    && go list -m all > before.txt \
    && go get foo@v2.0.0 >/dev/null 2>&1 \
    && go list -m all > after.txt \
    && diff before.txt after.txt )
```
The diff is the exact set of modules the upgrade would move — computed without touching your repo.

**Expected gain:** Know the blast radius before you commit. Driving the real toolchain in a sandbox inherits pruning, `replace`/`exclude`, and version ordering for free — far safer than guessing or re-implementing.

---

## Optimization 12 — Pin the toolchain so MVS results are byte-stable across machines

**Problem:** MVS selects the same *versions* everywhere, but `go mod tidy`'s *bookkeeping* (which `// indirect` lines it writes, pruning behaviour) can differ slightly across Go toolchain versions. Two contributors on different Go versions produce alternating `go.mod` diffs.

**Before:** Person A on Go 1.21 and Person B on Go 1.23 keep re-tidying and reverting each other's `go.mod`.

**After:**
```text
// go.mod
go 1.22
toolchain go1.23.4      // everyone uses the same toolchain for tidy/vendor
```
```bash
$ go mod tidy           # deterministic across contributors
```

**Expected gain:** Stable `go.mod`/`go.sum` across the team; no churn from toolchain-version differences. The selected versions were always identical (MVS is deterministic) — pinning the toolchain stabilises the *file representation* too.

---

## Optimization 13 — Reduce floor inflation from one aggressive dependency

**Problem:** A single minor dependency floors a popular module (e.g. `golang.org/x/sys`) far higher than anything else needs, dragging the whole build onto a version you did not intend.

**Before:**
```bash
$ go mod graph | grep ' golang.org/x/sys@' | sort -t@ -k2 -V | tail -1
github.com/niche/tool@v0.1.0 golang.org/x/sys@v0.21.0   # niche/tool forces it
```

**After:** decide whether you want that floor. If the aggressive dependency is doing it gratuitously, upgrade it (a newer version may relax the floor), replace it, or drop it:
```bash
$ go mod why -m github.com/niche/tool     # is it even pulling its weight?
$ go get github.com/niche/tool@latest     # may lower its x/sys requirement
# or remove the dependency if it is not essential
```

**Expected gain:** The selected version of the popular module returns to what the *rest* of your graph actually needs, reducing exposure to an untested-by-you version and shrinking the surprise surface. Audit who sets the high floors.

---

## Optimization 14 — Don't fight MVS; reach for the right escape hatch

**Problem:** Teams burn time hand-editing `go.mod` to force versions, then re-tidying away their edits, in a loop — because they are using the wrong tool for the job.

**Before:**
```text
// hand-edited go.mod, reverted by the next `go mod tidy`
require golang.org/x/text v0.3.0   // "downgrade" — silently ignored, higher floor wins
```

**After (match the tool to the intent):**
```bash
# Skip a single known-bad version, keep selection otherwise:
$ go mod edit -exclude=golang.org/x/text@v0.5.0

# Substitute a fork/patched build (documented, audited):
$ go mod edit -replace=golang.org/x/text=golang.org/x/text@v0.9.1-patched

# Actually lower a module (accept the cascade report):
$ go get golang.org/x/text@v0.3.0
```

**Expected gain:** Changes that *stick* and that `go mod tidy` will not undo, plus a legible audit trail. The optimization is choosing `exclude` (veto), `replace` (substitute), or a real downgrade (lower + propagate) deliberately, instead of fighting the `max` rule by hand.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. For MVS workflows the most useful signals are:

```bash
# How long does graph loading / build-list computation actually take?
time go list -m all
time go mod graph | wc -l        # graph size (pruned vs full)

# How big is the build list (modules in the build)?
go list -m all | wc -l

# Confirm pruning is active (go directive + indirect pinning):
go mod edit -json | jq '.Go'
grep -c indirect go.mod

# What would an upgrade move? (sandbox simulation)
tmp=$(mktemp -d); cp -r . "$tmp"; (cd "$tmp" && \
  go list -m all > a && go get foo@latest >/dev/null 2>&1 && \
  go list -m all > b && diff a b)

# Currency / security posture:
go list -m -u all                # which selected versions have newer releases
go list -m -u -retracted all     # selected versions that are retracted
govulncheck ./...                # vulnerable selected versions

# Who forces a high floor?
go mod graph | grep ' <module>@' | sort -t@ -k2 -V | tail -1
```

Track two metrics over time: **module-operation latency** (`time go list -m all`, the headline gain from pruning) and **dependency-currency lag** (count of `go list -m -u all` entries with available updates, the headline cost MVS leaves you to manage).

---

## When the "Optimization" Is the Wrong Move

MVS's behaviour is deliberate; several tempting "optimizations" work against it.

- **`go get -u ./...` inside a release build:** destroys reproducibility — the release tag builds against whatever was latest *that day*. Upgrade in reviewed PRs; build releases from the frozen `go.mod` with `-mod=readonly`.
- **Re-implementing the build-list rule for speed:** the `max` is trivial, but pruning, version ordering (pseudo-versions, `+incompatible`), and `replace`/`exclude` are easy to get subtly wrong. Use `go list -m -json all`.
- **Forcing high floors "to stay current":** manually flooring a popular module above what anything needs drags the whole build onto an untested version and can name versions that do not exist. Let `go get` set real, tested floors.
- **Hand-editing `go.mod` to downgrade below another floor:** silently ignored by MVS. Use `exclude`, `replace`, or a real downgrade.
- **Treating "no auto-upgrade" as "no need to upgrade":** reproducibility without a currency process is *reproducibly insecure*. Schedule `govulncheck` and patch refreshes.
- **Deleting `// indirect` lines or `go.sum` to "clean up":** breaks pruning's build-list pinning and integrity verification respectively, without changing selection. Let `go mod tidy` own them.

The deepest optimization is conceptual: MVS makes dependency versions part of your source, selected deterministically and changed only by reviewed diffs. Optimize the workflow around that — fast graph loading, automated currency, legible upgrades, honest floors — not the already-optimal selection core.

---

## Summary

MVS's selection is already optimal: a linear, deterministic `max`-per-module walk with no backtracking and no unsatisfiable case. The real optimization targets are everything *around* it. **Graph loading** is the historical cost — bump the `go` directive to 1.17+ for pruning and lazy loading (sub-second module operations, identical build list) and warm the module cache so MVS reads `go.mod` files locally, not over the network. **Currency** is the cost MVS deliberately leaves you — automate it with scheduled `go get -u=patch` refreshes and `govulncheck`, because reproducibility without upgrades is reproducible insecurity. **Legibility** is what makes MVS's "versions are source" property pay off — keep upgrades in their own commits, pin the toolchain for stable `go.mod` representation, and trace surprising selected versions to one floor with `go mod graph` + `go mod why`. And **honest floors** — kept by `go mod tidy`, set by `go get` (never invented by hand), with `exclude`/`replace` reserved for genuine vetoes and substitutions — keep the graph small and the build list trustworthy. The biggest optimization is conceptual: stop fighting the `max` rule, and instead optimize the workflow that feeds it.
