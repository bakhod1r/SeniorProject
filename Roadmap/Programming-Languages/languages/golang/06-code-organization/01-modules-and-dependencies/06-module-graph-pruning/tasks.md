# Module Graph Pruning — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are at the end.

---

## Easy

### Task 1 — Create a pruned module and read its `go.mod`

Create a new module `example.com/prunedemo`. Add `github.com/spf13/cobra` as a dependency (it has transitive dependencies, so the indirect block will be non-empty). Write a `main.go` that constructs a `&cobra.Command{}`. Run `go mod tidy`, then read `go.mod`.

Confirm:

- The `go` directive is `1.17` or higher (so the module is pruned).
- There is a direct `require` for `github.com/spf13/cobra`.
- There is a second `require` block of `// indirect` entries.

**Goal.** See what a pruned `go.mod` looks like on disk and identify the direct/indirect split.

---

### Task 2 — Identify the pruning switch

In the module from Task 1, run:

```bash
go mod edit -json | grep -A1 '"Go"'
```

Note the `go` version. Then explain, in one sentence, which exact line in `go.mod` decides whether the graph is pruned, and what value range turns pruning on.

**Goal.** Internalise that the `go` directive (`≥ 1.17`) is the switch.

---

### Task 3 — Trace an indirect dependency

Pick one `// indirect` entry from Task 1 (e.g. `github.com/spf13/pflag`). Run:

```bash
go mod why -m github.com/spf13/pflag
```

Explain why it appears in your `go.mod` even though your `main.go` never imports it.

**Goal.** Understand that indirect entries are recorded because *your dependencies* need them, to keep the pruned `go.mod` self-contained.

---

### Task 4 — Compare pruned vs full graph size

In the Task 1 module, capture the pruned graph size:

```bash
go mod graph | wc -l
```

Now temporarily downgrade the directive and re-tidy, then capture again:

```bash
go mod edit -go=1.16
go mod tidy
go mod graph | wc -l
```

Compare the two counts. Restore the modern directive afterward:

```bash
go mod edit -go=1.21
go mod tidy
```

**Goal.** *See* pruning: the full-graph edge count is larger than the pruned one.

---

### Task 5 — Observe the indirect block change across the boundary

Repeat Task 4 but instead of (or in addition to) the edge count, diff `go.mod` between the `go 1.16` and `go 1.21` versions. Note which regime records *more* `// indirect` lines and explain why.

**Goal.** Connect the directive bump to the size of the indirect block: the pruned regime records more, for self-containment.

---

## Medium

### Task 6 — Verify pruning does not change selected versions

For the Task 1 module, record the build list under the pruned directive:

```bash
go list -m all > /tmp/pruned.txt
```

Switch to `go 1.16`, re-tidy, and record again:

```bash
go mod edit -go=1.16 && go mod tidy
go list -m all > /tmp/full.txt
diff /tmp/pruned.txt /tmp/full.txt
```

Confirm the selected *versions* of the modules you actually import are identical (the lists may differ in which modules appear, but imported packages' versions match). Restore the modern directive.

**Goal.** Confirm that pruning preserves MVS's selection — it changes loading, not versions.

---

### Task 7 — Migrate a `go 1.16` module to pruning

Create a module with `go 1.16` explicitly (`go mod init` then `go mod edit -go=1.16`), add two or three dependencies, and tidy. Then migrate:

```bash
go mod tidy -go=1.17
```

Diff `go.mod` before and after. Identify: the directive change, the grown indirect block, and any `go.sum` changes.

**Goal.** Perform the canonical migration command and understand the diff it produces.

---

### Task 8 — Use `-compat` to support an older Go

On a `go 1.21` module, run:

```bash
go mod tidy -compat=1.17
```

Then inspect whether `go.sum` retained additional entries compared to `go mod tidy` with the default `-compat`. Explain what `-compat=1.17` guarantees for a consumer on Go 1.17.

**Goal.** Understand that `-compat` preserves the `go.sum` metadata older toolchains need and checks the two regimes agree.

---

### Task 9 — Find non-self-contained dependencies

In a real project (or one with several dependencies), list every dependency whose `go` directive is below 1.17:

```bash
go list -m -json all | jq -r 'select(.GoVersion != null and .GoVersion < "1.17") | "\(.Path) \(.GoVersion)"'
```

These are the modules that are *not* self-contained and therefore inflate the loaded graph. Pick one and check whether a newer release exists.

**Goal.** Audit the graph for legacy dependencies that erode pruning.

---

### Task 10 — CI tidiness gate

Add a CI step that fails if `go.mod`/`go.sum` are not tidy:

```yaml
- run: |
    go mod tidy
    git diff --exit-code go.mod go.sum
```

Push a PR that adds a new import *without* running `go mod tidy`. Confirm CI catches the stale indirect block and fails.

**Goal.** Build the core pruning-discipline guard: an always-tidy `go.mod`.

---

## Hard

### Task 11 — Reproduce graph deepening

Start from a tidy pruned module. Add a *single* new import that pulls in a dependency not previously in your graph (choose a library with its own transitive deps). Run `go mod tidy`. Observe that one import change produced *several* new `// indirect` lines.

Explain why: the new import deepened the graph, revealing constraints that pruning had elided.

**Goal.** Witness deepening first-hand and understand that the multi-line `go.mod` diff is correct, not a bug.

---

### Task 12 — Quantify a legacy dependency's cost

Set up two scratch modules that both depend on the same library, but force one to depend (via `replace` or a chosen version) on a transitive dependency at `go 1.16`. Compare `go mod graph | wc -l` between the two. Show that the legacy-dependency variant loads a larger graph.

**Goal.** Demonstrate that a single `go < 1.17` dependency re-inflates the loaded graph.

---

### Task 13 — Pruning and vendoring together

Take a pruned module and vendor it:

```bash
go mod vendor
grep -E '^## (explicit|go )' vendor/modules.txt | head
```

Confirm `vendor/modules.txt` contains `## go <version>` markers. Then bump the `go` directive, re-tidy, and *forget* to re-vendor. Run `go build` and observe the "inconsistent vendoring" error. Fix with `go mod vendor`.

**Goal.** Understand the 1.17 `## go` marker and the re-vendor-after-directive-bump discipline.

---

### Task 14 — Cross-version consistency check

On a `go 1.21` module, deliberately try to create a situation where the pruned and `-compat` regimes might disagree (e.g. an unusual `replace`). Run:

```bash
go mod tidy -compat=1.16
```

If `tidy` reports an inconsistency, read the message and explain what cross-version hazard it caught. If it does not, explain why `-compat`'s consistency check is still valuable as a guard.

**Goal.** Understand `-compat` as a consistency check, not just a metadata-retention flag.

---

### Task 15 — Parse the build list programmatically

Write a Go (or `jq`) tool that consumes `go list -m -json all` and reports:

- Total module count, and how many are `// indirect`.
- How many dependencies are at `go < 1.17` (non-self-contained).
- The dependency with the lowest `go` directive.

Run it against a real project.

**Goal.** Build tooling that surfaces pruning-relevant health metrics from the build list.

---

## Bonus / Stretch

### Task 16 — Graph-size regression guard

Write a CI script that records `go mod graph | wc -l` and fails the build if it grows by more than a configurable threshold versus the value on `main`. This catches a legacy dependency or a heavyweight new dependency entering the tree.

**Goal.** Operationalise graph-size as a tracked metric.

---

### Task 17 — Directive-bump PR hygiene

Take a real repo and perform a `go 1.16 → go 1.21` migration as *two* commits: one for the directive bump + tidy (large `go.mod`/`go.sum` diff, no code), one for any code changes. Show how `git diff` of the second commit is clean of dependency noise.

**Goal.** Practise isolating the high-diff migration so reviews and bisects stay clean.

---

### Task 18 — `go.mod` self-containment proof

For a pruned module, demonstrate self-containment: with a warm cache, show that `go list -m all` resolves correctly, then reason about why the main module's `go.mod` plus the `go.mod` of relevant `go 1.17+` deps is sufficient — i.e. the deep graph is not needed. (Optional: simulate a restricted network and confirm the common build path still works.)

**Goal.** Connect "self-contained `go.mod`" to the practical offline/lazy-loading benefit.

---

### Task 19 — Compare `go mod why` outputs

Run `go mod why -m <module>` for a *direct* dependency and for an *indirect* one. Compare the import chains they print. Explain how the output reflects the import graph that pruning follows.

**Goal.** Read the import-chain explanation and tie it back to the import-vs-require distinction.

---

### Task 20 — Decide a `-compat` policy

For a library you maintain (or imagine), write down: the oldest Go version you support, the `-compat` value you will pass, the CI matrix entry that tests it, and how you will announce raising the floor later. Justify each choice against your consumer base.

**Goal.** Turn `-compat` from a flag into a deliberate, documented support policy.

---

## Solutions (sketched)

### Solution 1
```bash
mkdir prunedemo && cd prunedemo
go mod init example.com/prunedemo
cat > main.go <<'EOF'
package main
import ("fmt"; "github.com/spf13/cobra")
func main() { c := &cobra.Command{Use: "x"}; fmt.Println(c.Use) }
EOF
go mod tidy
cat go.mod
```
A `go 1.2x` directive, a direct `require github.com/spf13/cobra`, and a second `require (...)` block of `// indirect` lines.

### Solution 2
The `go 1.x` directive is the switch. `1.17` or higher → pruned; `1.16` or lower → full graph.

### Solution 3
`go mod why -m github.com/spf13/pflag` prints an import chain like `cobra → pflag`. It is recorded because `cobra` imports it; you do not import it directly, hence `// indirect`.

### Solution 4
The pruned (`go 1.21`) edge count is smaller than the full (`go 1.16`) one. Restore the directive after measuring.

### Solution 5
The pruned regime records *more* `// indirect` lines, because the deep graph is no longer loaded at build time and the indirect versions must be recorded for self-containment.

### Solution 6
The selected versions of imported modules are identical across regimes. The full-graph list may *list* more modules, but pruning does not change MVS's choice for imported packages.

### Solution 7
`go mod tidy -go=1.17` bumps the directive and rewrites `go.mod` for the pruned regime — the indirect block grows, and `go.sum` may change. Commit it in isolation.

### Solution 8
`-compat=1.17` keeps the `go.sum` `go.mod`-hash entries a Go 1.17 consumer needs to load its graph, and checks the pruned and 1.17 build lists agree. Without it, the default `-compat` (one below the directive) may drop entries a 1.17 consumer needs.

### Solution 9
```bash
go list -m -json all | jq -r 'select(.GoVersion != null and .GoVersion < "1.17") | "\(.Path) \(.GoVersion)"'
```
Each result is a non-self-contained dependency. Upgrading it to a `go 1.17+` release shrinks the loaded graph.

### Solution 10
```yaml
- name: go.mod tidiness gate
  run: |
    go mod tidy
    git diff --exit-code go.mod go.sum || \
      (echo "Run 'go mod tidy' before pushing" && exit 1)
```

### Solution 11
The new import deepens the pruned graph; Go loads the newly-relevant region and records its constraints as several `// indirect` lines. The diff is correct — do not delete the extra lines.

### Solution 12
The variant with a `go 1.16` transitive dependency has a larger `go mod graph | wc -l`, because that dependency's full requirement subtree is loaded (it is not self-contained).

### Solution 13
```bash
go mod vendor
grep -E '^## go ' vendor/modules.txt   # per-module go directive markers
```
After a directive bump without re-vendoring, `go build` reports "inconsistent vendoring." Fix: `go mod vendor`, commit.

### Solution 14
If the pruned and `-compat=1.16` build lists disagree, `tidy` errors and names the conflict — a real cross-version hazard. If they agree, the check still guards future changes that could introduce a divergence.

### Solution 15
```bash
go list -m -json all | jq -s '
  { total: length,
    indirect: ([.[] | select(.Indirect)] | length),
    legacy: ([.[] | select(.GoVersion != null and .GoVersion < "1.17")] | length) }'
```
Extend with a `min_by(.GoVersion)` for the lowest-directive dependency.

### Solution 16
Record the baseline on `main`, compare on the PR branch:
```bash
base=$(git show main:go.mod >/dev/null 2>&1; go mod graph | wc -l)
# compare against a stored baseline; fail if delta > threshold
```
A jump usually means a legacy or heavyweight dependency entered the tree.

### Solution 17
Commit 1: `go mod edit -go=1.21 && go mod tidy && git commit go.mod go.sum`. Commit 2: code changes only. `git diff` of commit 2 has no `go.mod` noise.

### Solution 18
A tidy pruned `go.mod` plus the `go.mod` of relevant `go 1.17+` deps fully determines the build list; the deep graph is not needed. This is why the common build path stays fast and works behind restricted networks.

### Solution 19
`go mod why -m` prints the shortest import path. For a direct dep the chain starts at your package; for an indirect dep it routes through a dependency. The chains trace the *import* graph that pruning follows.

### Solution 20
Document: minimum supported Go, the `-compat` value, a CI matrix job on that version, and a plan to announce floor raises as minor breaking changes.

---

## Checkpoints

After completing the easy tasks: you can create a pruned module, identify the directive switch, trace an indirect dependency, and see pruning via graph size.
After completing the medium tasks: you can confirm version-selection equivalence, migrate across the 1.17 boundary, use `-compat`, and audit for legacy dependencies.
After completing the hard tasks: you can reproduce deepening, quantify a legacy dependency's cost, combine pruning with vendoring, exercise the `-compat` consistency check, and parse the build list programmatically.
After completing the bonus tasks: you have built tooling around pruning — graph-size guards, clean migration commits, self-containment reasoning — and you can define a deliberate `-compat` support policy.
