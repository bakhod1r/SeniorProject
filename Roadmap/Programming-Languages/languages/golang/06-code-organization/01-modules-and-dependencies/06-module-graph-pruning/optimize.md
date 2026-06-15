# Module Graph Pruning — Optimization

> Honest framing first: module graph pruning *is itself* an optimization — the Go 1.17 change that shrinks how much of the module graph the `go` command loads. You do not "tune" pruning; you *get* it by being on a modern `go` directive. What is genuinely worth optimizing is everything around it: keeping the benefit (avoiding legacy dependencies that re-inflate the graph), running the expensive commands (`go mod tidy`, `go mod graph`) deliberately, keeping `go.mod` diffs reviewable, and pinning the toolchain so the indirect block does not churn. Each entry below states the problem, shows a "before" and "after", and the realistic gain. The closing sections cover measurement and the cases where the right move is to stop fighting the graph.

---

## Optimization 1 — Be on a modern `go` directive (turn pruning on)

**Problem:** A module pinned to `go 1.16` (or lower) loads the *full* transitive module graph on every command. On a large dependency tree this means thousands of `go.mod` reads per invocation — slow `go list`, slow IDE feedback, more network fetches.

**Before:**
```go.mod
go 1.16
```
```bash
$ time go list -m all      # loads the full graph every time
```

**After:**
```bash
$ go mod tidy -go=1.21
```
```go.mod
go 1.21
```
The graph is pruned: only the import-relevant subgraph plus one level of requirements loads.

**Expected gain:** On large projects, graph-load time drops from O(full transitive closure) to O(import-relevant subgraph) — frequently thousands of `go.mod` reads down to dozens. Cold `go list -m all` and IDE `go` invocations speed up noticeably; the cost is a larger, self-contained `go.mod`.

---

## Optimization 2 — Eliminate legacy (`go < 1.17`) dependencies

**Problem:** Pruning's benefit is conditional. A single transitive dependency at `go 1.16` or lower is *not* self-contained, so Go loads its full requirement subtree — re-inflating the graph for everyone downstream and partially undoing pruning.

**Before:**
```bash
$ go list -m -json all | jq -r 'select(.GoVersion < "1.17") | "\(.Path) \(.GoVersion)"'
github.com/legacy/lib 1.15
$ go mod graph | wc -l
1842
```

**After:**
```bash
$ go get github.com/legacy/lib@latest        # a go 1.17+ release
$ go mod tidy
$ go mod graph | wc -l
  411
```
Or, if upstream is unmaintained, `replace` it with a fork whose own `go.mod` is `go 1.17+`.

**Expected gain:** Removing a legacy dependency restores self-containment in its region of the graph. The graph-edge count and per-command load cost drop, sometimes dramatically when the laggard sat near the root of a deep subtree.

---

## Optimization 3 — Run `go mod tidy` deliberately, not in hot loops

**Problem:** `go mod tidy` is the *expensive* command — it loads the full graph (and, with `-compat`, a second regime) to compute the recorded indirect closure. Scripts that run it on every save, every test, or every CI step pay full-graph cost repeatedly for no benefit.

**Before:**
```makefile
test:
	go mod tidy        # full-graph load every test run
	go test ./...
```

**After:**
```makefile
test:
	go test ./...      # pruned/lazy load; fast

tidy:
	go mod tidy        # run on dependency changes only
```
Gate tidiness in CI (one tidy + diff), not in the inner dev loop.

**Expected gain:** Everyday `make test` drops the full-graph load entirely, falling back to the cheap pruned/lazy path. Tidy runs only when dependencies actually change.

---

## Optimization 4 — Pin the toolchain to stop indirect-block churn

**Problem:** Different local Go versions can produce slightly different indirect sets and `go.sum` contents across the pruning boundary (the default `-compat` is dynamic). Contributors' `go mod tidy` runs then alternately revert each other, and CI flaps.

**Before:** Developer A on Go 1.20 and B on Go 1.22 each tidy; their PRs ping-pong on `go.mod`/`go.sum`.

**After:**
```go.mod
go 1.21

toolchain go1.22.4
```
```bash
$ go mod tidy -compat=1.20        # one agreed value, documented
```
Plus a CI image pinned to the same Go version and a tidiness gate.

**Expected gain:** The indirect block and `go.sum` become deterministic across the team. No more revert wars; CI stops flapping on dependency metadata.

---

## Optimization 5 — Set `-compat` to your real support floor (not reflexively low)

**Problem:** A library that tidies with an unnecessarily low `-compat` retains extra `go.sum` `go.mod`-hash entries it does not need, bloating metadata. One that tidies with too high a floor (or the default) silently breaks older consumers with "missing go.sum entry."

**Before:**
```bash
$ go mod tidy            # default -compat (one below directive); breaks Go 1.17 consumers
```
or
```bash
$ go mod tidy -compat=1.11   # ancient floor; retains entries nobody needs
```

**After:**
```bash
$ go mod tidy -go=1.21 -compat=1.17    # exactly your documented support floor
```
With a CI matrix job on Go 1.17 that resolves and builds the module as a consumer.

**Expected gain:** Minimal, correct `go.sum` metadata for your actual support matrix — no older-consumer breakage, no superfluous retained entries. The floor becomes a deliberate, tested policy rather than an accident.

---

## Optimization 6 — Keep `go.mod` diffs reviewable

**Problem:** Pruning makes `go.mod` larger and noisier; a one-line import change can deepen the graph and touch several `// indirect` lines. Bundled with feature work, the dependency churn drowns the real change and reviewers rubber-stamp it.

**Before:** One commit titled "add export endpoint + bump deps" with a 60-line `go.mod` diff plus 20 lines of handler code.

**After:**
```bash
# Commit 1: dependency change + tidy only
go get github.com/some/lib@v1.4.0
go mod tidy
git add go.mod go.sum
git commit -m "deps: add some/lib v1.4.0"

# Commit 2: code that uses it
git add internal/api/
git commit -m "api: add export endpoint"
```
Review the direct block carefully; scan the indirect block for surprises (`go mod why -m <module>` on anything alarming).

**Expected gain:** Faster, more accurate review; cleaner bisects (a dependency change is revertible independently of the code that consumes it); and the indirect-block noise stops hiding the substantive diff.

---

## Optimization 7 — Validate the indirect block's *contents*, not just its diff

**Problem:** Because the indirect block is derived and noisy, reviewers skim it — so an undesirable dependency (vulnerable, license-incompatible, abandoned) can enter unnoticed. Pruning's larger recorded set makes this *more* likely, not less.

**Before:** Reviewers approve any `go.mod` diff that "looks like tidy output."

**After:**
```bash
govulncheck ./...                                   # vulnerable transitive deps
go-licenses report ./... 2>/dev/null                # license surprises
go list -m -json all | jq -r 'select(.GoVersion < "1.17") | .Path'   # legacy deps
```
Run these in CI so the *contents* of the (skimmed) indirect block are validated automatically.

**Expected gain:** The audit value of a recorded dependency set is realised. A new vulnerable or non-compliant transitive dependency fails CI instead of being approved in the noise.

---

## Optimization 8 — Cache the module cache; pruning reduces fetches but does not eliminate them

**Problem:** Teams expect pruning to make all network fetches disappear. It reduces `go.mod` fetches on the common path, but `go mod tidy` and cold builds still populate the module cache. Cold CI runners re-fetch every job.

**Before:**
```yaml
- uses: actions/setup-go@v5
  with: { go-version: '1.23' }
- run: go build ./...        # cold cache: fetches modules
```

**After:**
```yaml
- uses: actions/setup-go@v5
  with:
    go-version: '1.23'
    cache: true
    cache-dependency-path: go.sum
- run: go build ./...
```
The `go.sum`-keyed cache restores `GOMODCACHE` across jobs; pruning then keeps per-command graph loading cheap on top of a warm cache.

**Expected gain:** Cold-fetch cost amortises across jobs. Pruning and cache caching are complementary: cache removes re-fetching; pruning removes re-loading the deep graph.

---

## Optimization 9 — Use `go mod graph` sparingly and know it loads the full graph

**Problem:** `go mod graph` is treated as a cheap inspection command and wired into hot CI paths. But it loads the *full* graph to print all edges — far more expensive than a pruned build.

**Before:**
```yaml
- run: go mod graph > graph.txt     # full-graph load on every CI run
- run: go build ./...
```

**After:**
```yaml
- run: go build ./...               # cheap pruned/lazy path
# run go mod graph only in a dedicated, infrequent analysis job:
- run: go mod graph | wc -l         # in a separate scheduled audit
```

**Expected gain:** The common pipeline stops paying full-graph cost for an inspection it rarely needs. Graph analysis moves to a scheduled job where the cost is acceptable.

---

## Optimization 10 — Track graph size as a regression metric

**Problem:** Pruning's benefit silently erodes over time as legacy dependencies sneak in. Without a tracked number, nobody notices until commands feel slow.

**Before:** No visibility; "go commands got slower this quarter" with no cause.

**After:**
```yaml
- name: Graph-size guard
  run: |
    n=$(go mod graph | wc -l)
    echo "module graph edges: $n"
    # compare against a stored baseline; fail if it jumps beyond a threshold
    test "$n" -le "$(cat .graph-baseline)" || {
      echo "Module graph grew — check for a new go<1.17 or heavyweight dep";
      go list -m -json all | jq -r 'select(.GoVersion < "1.17") | .Path';
      exit 1;
    }
```

**Expected gain:** A sudden graph-size jump (usually a legacy or heavyweight dependency) is caught at the PR that introduces it, while it is cheap to fix, instead of after months of accumulation.

---

## Optimization 11 — Migrate across the 1.17 boundary as an isolated commit

**Problem:** A `go 1.16 → go 1.21` migration produces a large `go.mod`/`go.sum` diff (the indirect block grows substantially). Bundled with other changes, it makes review and bisecting painful and risks someone reverting the "extra" lines.

**Before:** A feature PR that *also* happens to bump the directive, with a 100-line `go.mod` diff buried among code changes.

**After:**
```bash
go mod tidy -go=1.21 -compat=<floor>
go build ./... && go test ./...
git add go.mod go.sum
git commit -m "Enable module graph pruning (go 1.21)"
# code changes go in separate, later commits
```

**Expected gain:** The high-diff migration is reviewable on its own, bisectable, and revertible as a unit. Nobody mistakes the grown indirect block for noise to clean up.

---

## Optimization 12 — Prune unused direct dependencies before they cost you

**Problem:** A direct dependency abandoned in code but left in `go.mod` keeps its entire transitive (and now-recorded indirect) subtree in your graph and `go.mod`. Pruning records *more* indirect entries, so a dead direct dep is more expensive to carry than pre-1.17.

**Before:**
```
go.mod  →  require github.com/old/sdk v2.1.0   // last import removed in a refactor
// drags in a dozen recorded indirect entries
```

**After:**
```bash
go mod tidy        # drops the unused direct require and its now-orphaned indirect entries
go mod why github.com/some/dep   # justify each remaining direct dep
```

**Expected gain:** `tidy` removes the dead direct dependency and the indirect closure it pulled in, shrinking both `go.mod` and the loaded graph. The indirect block becomes an honest reflection of what you actually use.

---

## Optimization 13 — Do not re-vendor on every PR; do re-vendor after directive bumps

**Problem:** Two opposite mistakes. (a) Running `go mod vendor` on every PR produces a noisy diff and re-validates an unchanged tree. (b) Forgetting to re-vendor after a `go` directive bump leaves stale `## go` markers and "inconsistent vendoring."

**Before:**
```yaml
- run: go mod vendor          # every PR, even code-only ones
```

**After:**
```yaml
- name: Detect dependency/directive change
  id: deps
  run: |
    git diff --name-only origin/main... | grep -E '^go\.(mod|sum)$' \
      && echo "changed=true" >> $GITHUB_OUTPUT || true
- name: Re-vendor + verify
  if: steps.deps.outputs.changed == 'true'
  run: |
    go mod vendor
    git diff --exit-code -- vendor/
```
Re-vendor only when `go.mod`/`go.sum` changed — which includes every directive bump.

**Expected gain:** No vendor noise on code-only PRs; guaranteed re-vendor (and correct `## go` markers) exactly when a dependency or directive change requires it. See [03-go-mod-vendor/optimize.md](../03-go-mod-vendor/optimize.md).

---

## Optimization 14 — Reproducibility: pin the directive *and* the toolchain

**Problem:** Teams assume a pruned, self-contained `go.mod` alone guarantees reproducible builds. It pins the *graph*, but not the compiler, standard library, or language semantics — which the `go` and `toolchain` directives govern.

**Before:**
```go.mod
go 1.21
// no toolchain directive; CI image floats
```
Builds differ across CI images even with an identical pruned graph.

**After:**
```go.mod
go 1.21

toolchain go1.21.6
```
Plus a CI image pinned to `go1.21.6` and a tidy, committed `go.mod`/`go.sum`.

**Expected gain:** The graph dimension (pruned, self-contained `go.mod`) and the toolchain dimension (fixed compiler + stdlib) are both pinned. Builds become reproducible across machines and over time — pruning contributes its part, the toolchain pin contributes the rest.

---

## Benchmarking and Measurement

Optimization without measurement is folklore. For pruning the most useful signals are:

```bash
# How big is the (pruned) graph?
go mod graph | wc -l

# Compare against the full graph for the same project:
go mod edit -go=1.16 && go mod tidy && go mod graph | wc -l
go mod edit -go=1.21 && go mod tidy            # restore

# How long does build-list determination take?
time go list -m all

# Which dependencies are NOT self-contained (re-inflate the graph)?
go list -m -json all | jq -r 'select(.GoVersion != null and .GoVersion < "1.17") | "\(.Path) \(.GoVersion)"'

# How big is the recorded indirect set?
go list -m -json all | jq -r 'select(.Indirect == true) | .Path' | wc -l

# Verify go.mod is self-contained / tidy:
go mod tidy && git diff --exit-code go.mod go.sum
```

Track two metrics over time: the **graph-edge count** (`go mod graph | wc -l`) as the headline pruning health signal, and the **count of `go < 1.17` dependencies** as the leading indicator of pruning erosion. A "pruning optimization" that does not move these is not one.

---

## When the Right Move Is to Stop Fighting the Graph

Pruning is automatic and almost always beneficial; there is little to "turn off." But some efforts are misdirected:

- **Do not downgrade the `go` directive to shrink `go.mod`.** You trade a small file for a slow, full-graph build. The larger pruned `go.mod` is the faster choice.
- **Do not hand-curate the indirect block or `go.sum`.** They are derived; `go mod tidy` owns them. Manual edits are reverted or rejected by the readonly default.
- **Do not chase a smaller `go mod graph` by deleting recorded requirements.** The way to shrink the graph legitimately is to drop imports (then `tidy`) and to upgrade legacy dependencies — not to edit metadata.
- **Do not bundle the 1.17 migration with feature work.** Isolate the high-diff commit.
- **Do not wire `go mod graph`/`go mod tidy` into hot paths.** They load the full graph by design; reserve them for dependency changes and scheduled audits.

Spend optimization effort where it pays: keeping dependencies modern (so the graph stays self-contained), pinning the toolchain (so metadata is deterministic), gating tidiness in CI, and keeping `go.mod` diffs reviewable.

---

## Summary

Module graph pruning is itself the optimization — being on a `go 1.17+` directive turns the dominant graph-load cost from the full transitive closure into the import-relevant subgraph plus one level of requirements. The wins around it come from *keeping* that benefit and *not paying for it twice*: eliminate `go < 1.17` dependencies that re-inflate the graph, run the expensive commands (`go mod tidy`, `go mod graph`) deliberately rather than in hot loops, pin the toolchain so the indirect block is deterministic, set `-compat` to your real support floor, and keep `go.mod` diffs reviewable while validating their *contents* with `govulncheck` and license checks.

The biggest single lever is upstream of all the tuning: stay on a modern directive and keep your dependencies modern too. A pruned graph fed by self-contained dependencies gives you fast `go` commands and reproducible, self-contained metadata for free — and the best "optimization" is to let `go mod tidy` own the indirect block and never touch it by hand.
