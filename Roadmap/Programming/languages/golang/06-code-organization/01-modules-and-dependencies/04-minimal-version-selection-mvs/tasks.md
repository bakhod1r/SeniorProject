# Minimal Version Selection (MVS) — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to do, what success looks like, and a hint or expected outcome. Solutions are at the end.

---

## Easy

### Task 1 — See the build list

Create a new module `example.com/mvsdemo`. Add one dependency: `go get github.com/google/uuid@v1.6.0`. Then run:

```bash
go list -m all
```

Inspect the output:

- The first line is your main module (no version).
- A second line shows `github.com/google/uuid` at the version MVS selected.

**Goal.** See the build list — the output of MVS — for the simplest possible graph.

---

### Task 2 — Prove a `require` is a floor, not a pin

In the project from Task 1, run:

```bash
go get github.com/google/uuid@v1.3.0   # an older version
go list -m github.com/google/uuid
```

Then bump up and confirm the selected version follows:

```bash
go get github.com/google/uuid@v1.6.0
go list -m github.com/google/uuid
```

**Goal.** Confirm that your direct `require` sets a floor, and (with only one floor in the graph) the selected version equals it.

---

### Task 3 — A new release does NOT upgrade you

After Task 1, note the selected `uuid` version. Now run a plain build and re-check:

```bash
go build ./...
go list -m github.com/google/uuid
```

The version is unchanged — MVS never auto-upgrades, even if a newer `uuid` exists on the proxy. Then deliberately move forward:

```bash
go get github.com/google/uuid@latest
go list -m github.com/google/uuid
```

**Goal.** Internalise that upgrades are explicit (`go get`), never automatic (`go build`).

---

### Task 4 — Read the module graph

Add a second, deeper dependency (e.g. `go get github.com/spf13/cobra@latest`) so the graph has transitive edges. Then:

```bash
go mod graph
```

Find every edge that mentions `golang.org/x/sys` (a common transitive dependency):

```bash
go mod graph | grep 'golang.org/x/sys@'
```

The right-hand versions are the floors. Compare to the selected version:

```bash
go list -m golang.org/x/sys
```

**Goal.** See the difference between the graph (all floors, the input) and the build list (one selected max, the output).

---

### Task 5 — "Highest of the minimums" surprise

In a project that depends on two libraries which both transitively need the same module at *different* versions, find that module:

```bash
go mod graph | grep '<shared-module>@'
```

You should see it required at two (or more) versions. Confirm that `go list -m <shared-module>` shows exactly the *highest* of them.

**Goal.** Verify the core MVS rule on a real, contested module: the selected version is the maximum floor, never higher.

---

## Medium

### Task 6 — Trace an upgrade cascade

Pick a dependency and upgrade it to a newer minor version:

```bash
go get github.com/spf13/cobra@v1.8.0
```

Watch the terminal output and diff `go.mod` before/after. Notice that upgrading `cobra` may also raise *other* modules' floors (because `cobra@v1.8.0`'s own `go.mod` requires newer versions of them). Confirm with:

```bash
git diff go.mod
go list -m all
```

**Goal.** See requirement tightening: upgrading one module pulls in *its* minimums, raising transitive floors.

---

### Task 7 — `go mod why` to justify a dependency

For any module in your build list that you did not add directly, ask why it is there:

```bash
go mod why -m golang.org/x/sys
```

The output is the shortest import chain from your code to that module. Then find one that is *not* needed by any import:

```bash
go mod tidy   # removes floors with no importer
go list -m all
```

**Goal.** Distinguish "in the build because something imports it" from "in the graph as a stray floor that tidy can remove."

---

### Task 8 — Downgrade and observe propagation

Find a module whose selected version is forced *higher* than your direct require by a transitive dependency (use Task 5's shared module). Try to downgrade it:

```bash
go get <shared-module>@<older-version>
```

Read the toolchain's report. It may say `downgraded <other-module> v1.x => v1.y` — because to lower the shared module, MVS had to lower the module that forced it higher.

**Goal.** Experience downgrade propagation: lowering one module can cascade to others.

---

### Task 9 — `// indirect` lines and pruning

In a module with `go 1.16` in `go.mod`, run `go mod tidy` and count the `// indirect` lines. Then bump the directive:

```bash
go mod edit -go=1.22
go mod tidy
grep -c indirect go.mod
```

Notice the count usually *increases* — under `go 1.17+`, tidy pins the entire build list as indirect requires (the pruning requirement). Confirm the *selected versions* did not change:

```bash
go list -m all
```

**Goal.** Connect the `go` directive to module graph pruning and the growth of `// indirect` lines — while seeing the build list stay the same.

---

### Task 10 — `exclude` a version

Suppose a specific version of a transitive dependency is known-bad. Add an `exclude` to your `go.mod`:

```bash
go mod edit -exclude=golang.org/x/text@v0.5.0
go mod tidy
go list -m golang.org/x/text
```

If `v0.5.0` would have been selected, MVS now picks the next-highest required version instead. Confirm the excluded version is no longer selected.

**Goal.** Use `exclude` to veto a candidate without forcing a cascading downgrade.

---

## Hard

### Task 11 — Build a multi-module graph by hand and verify

Create three local modules so you control the floors:

```
graph-lab/
├── app/      (module example.com/app, requires libA and libB)
├── libA/     (module example.com/libA, requires libC v1.1.0)
└── libB/     (module example.com/libB, requires libC v1.3.0)
```

Use local `replace` directives (or a `go.work`) so `app` resolves the local libs. Make `libA` and `libB` each require a *different* version of a shared dependency `libC`. Predict, on paper, which `libC` version `app` will select. Then run `go list -m libC` in `app` and verify.

**Goal.** Construct a contested module graph from scratch and confirm MVS selects the max floor.

---

### Task 12 — Simulate "what would upgrading X do" without mutating the repo

Write a script that, given a module path and target version:

1. Copies the module to a temp directory.
2. Runs `go get path@target` there.
3. Diffs `go list -m all` before and after.
4. Reports which modules changed version (the blast radius of the upgrade).

Run it for a non-trivial upgrade and read the report.

**Goal.** Build safe upgrade-impact tooling by driving the real toolchain in a sandbox.

---

### Task 13 — Parse the build list programmatically

Write a Go program (or a `jq` pipeline) that consumes `go list -m -json all` and emits, for each module: path, version, and whether it is indirect. Then answer:

- How many direct vs indirect dependencies?
- Which module is selected at the highest major version?
- Are any modules present at multiple major versions (`foo` and `foo/v2`)?

```bash
go list -m -json all | jq -r 'select(.Main != true) | "\(.Path) \(.Version) \(.Indirect)"'
```

**Goal.** Treat the MVS output as structured data for auditing.

---

### Task 14 — Find the highest-floor requirer

For a popular transitive module whose selected version surprises you, write a one-liner that finds *which* module sets the highest floor:

```bash
go mod graph | grep ' golang.org/x/sys@' | sort -t@ -k2 -V | tail -1
```

Then confirm with `go mod why` and inspect that requirer's `go.mod`. Decide whether you want that floor — and if not, whether to upgrade/replace the aggressive dependency.

**Goal.** Trace a high selected version back to the single requirement that forced it.

---

### Task 15 — Reproduce a build list from a tag

Check out an old tagged commit of a real Go project (or your own). Without any network access to *upgrade*, regenerate the build list:

```bash
git checkout v1.2.0
go list -m all > buildlist-v1.2.0.txt
git checkout main
go list -m all > buildlist-main.txt
diff buildlist-v1.2.0.txt buildlist-main.txt
```

Confirm that the old tag's build list is fully determined by its committed `go.mod` — no lockfile needed.

**Goal.** Demonstrate MVS reproducibility: the same `go.mod` always yields the same build list, years apart.

---

## Bonus / Stretch

### Task 16 — Patch a transitive CVE by raising a floor

Find a real Go vulnerability (search `pkg.go.dev/vuln`). In a project that transitively depends on the affected module:

1. `govulncheck ./...` confirms the vulnerability.
2. Raise the floor: `go get <affected-module>@<patched-version>` (often as an `// indirect` floor).
3. `go mod tidy`.
4. `govulncheck ./...` is clean.
5. Confirm with `go list -m <affected-module>` that the selected version moved.

**Goal.** Use the "raise a floor" mechanism as the canonical MVS security response.

---

### Task 17 — Compare two build lists (a vendor/version differ)

Build a small CLI that, given two `go list -m all` outputs (or two `go.mod`s), reports:

```
+ github.com/foo/bar v1.2.0  (added)
- github.com/baz/old v0.9.1  (removed)
~ github.com/qux/lib v1.0.0 -> v1.1.0  (bumped)
```

Treat each build list as a map from module path to version; compute set differences and version mismatches. Bonus: order versions with `golang.org/x/mod/semver` rather than string compare.

**Goal.** Build the missing UX layer for reviewing dependency-version changes.

---

### Task 18 — Force a major-version coexistence

Construct a project that imports both `foo` (v1) and `foo/v2` — for example via two dependencies, one on each major. Confirm with `go list -m all` that *both* appear in the build list at once, as different modules. Inspect the binary's dependency set.

**Goal.** See that MVS treats major versions as separate modules that coexist, not conflict.

---

### Task 19 — Inspect pseudo-versions

Add a dependency at a specific untagged commit:

```bash
go get github.com/some/repo@<commit-hash>
go list -m github.com/some/repo
```

Observe the pseudo-version (`v0.0.0-<timestamp>-<commit>`). Decode its three parts. Then verify MVS orders it correctly by adding a tagged version requirement and checking which one is selected.

**Goal.** Understand pseudo-versions as ordinary, orderable MVS inputs.

---

### Task 20 — Upgrade-all vs upgrade-patch

On a project with several outdated dependencies, compare the two upgrade strategies on *copies* of the repo:

```bash
# copy 1
go get -u ./... && go mod tidy && go list -m all > after-u.txt

# copy 2
go get -u=patch ./... && go mod tidy && go list -m all > after-patch.txt

diff after-u.txt after-patch.txt
```

Note which dependencies crossed a minor-version boundary under `-u` but not under `-u=patch`. Write a one-line recommendation for which strategy a routine maintenance bot should use.

**Goal.** Make the upgrade-all vs conservative-patch trade-off concrete.

---

## Solutions (sketched)

### Solution 1
```bash
mkdir mvsdemo && cd mvsdemo
go mod init example.com/mvsdemo
go get github.com/google/uuid@v1.6.0
go list -m all
# example.com/mvsdemo
# github.com/google/uuid v1.6.0
```
With one floor, the selected version equals the floor.

### Solution 2
`go get uuid@v1.3.0` lowers your direct floor; `go list -m` shows `v1.3.0` *only because nothing else floors it higher*. `go get uuid@v1.6.0` raises it back. A `require` is a floor — selection equals the max of all floors.

### Solution 3
A plain `go build` is read-only with respect to `go.mod` (`-mod=readonly` default since 1.16); the selected version never changes. Only `go get` raises floors. `@latest` resolves the newest tag and writes it as your new floor.

### Solution 4
`go mod graph` lists every `A B` edge. `golang.org/x/sys` typically appears at several versions (different requirers). `go list -m golang.org/x/sys` shows the single selected max.

### Solution 5
The grep shows the shared module required at, say, `v1.1.0` and `v1.3.0`. `go list -m` shows `v1.3.0` — the maximum. This is "highest of the minimums" on a real contested module.

### Solution 6
Upgrading `cobra` rewrites its `require` line *and* may raise indirect floors that `cobra@v1.8.0` requires (requirement tightening). The `go.mod` diff shows more than one changed line; `go list -m all` reflects the recomputed build list.

### Solution 7
`go mod why -m foo` prints the import chain. If it prints "(main module does not need module foo)", the floor has no importer; `go mod tidy` removes such strays.

### Solution 8
`go get shared@older` triggers downgrade. The toolchain reports `downgraded other v1.x => v1.y` — it lowered the module that forced `shared` up. If no older version of `other` releases the constraint, it may need `other@none` (removal); decide whether that is acceptable.

### Solution 9
`go 1.16` tidy records fewer indirect requires; `go 1.17+` tidy pins the *entire* build list as indirect requires (pruning requirement), so the count rises. `go list -m all` is identical — pruning changes work, not the result.

### Solution 10
```bash
go mod edit -exclude=golang.org/x/text@v0.5.0
go mod tidy
```
MVS drops `v0.5.0` from the candidate set; if it would have been selected, the next-highest required version is chosen instead. `exclude` is main-module-only.

### Solution 11
With `libA → libC v1.1.0` and `libB → libC v1.3.0`, `app` selects `libC v1.3.0` (the max). `go list -m example.com/libC` in `app` confirms it. Local `replace`/`go.work` lets `app` resolve the local libs.

### Solution 12
```bash
tmp=$(mktemp -d); cp -r . "$tmp"; cd "$tmp"
go list -m all > before.txt
go get "$1@$2"
go list -m all > after.txt
diff before.txt after.txt
```
Driving the real toolchain inherits pruning and directive handling for free.

### Solution 13
```bash
go list -m -json all | jq -r 'select(.Main != true) | "\(.Path) \(.Version) \(.Indirect)"'
```
Count `.Indirect == false` for direct deps. Look for two records sharing a base path but different `/vN` suffixes for major coexistence.

### Solution 14
`sort -t@ -k2 -V | tail -1` picks the highest-versioned edge for the module — its selected version and the requirer that set the highest floor. `go mod why` and the requirer's `go.mod` confirm.

### Solution 15
The two build lists differ only where floors changed between the tag and `main`. The old tag's list is fully reproducible from its committed `go.mod` — no lockfile involved.

### Solution 16
`govulncheck` → `go get affected@patched` → `go mod tidy` → `govulncheck` clean. The raised floor (often an `// indirect` line) is the MVS security-response mechanism; the diff is reviewable.

### Solution 17
Parse each build list into `map[path]version`; report added (in B not A), removed (in A not B), bumped (in both, versions differ). Order with `x/mod/semver` to classify bumps as up/down correctly.

### Solution 18
`go list -m all` shows both `foo` and `foo/v2` — different module paths, independently selected, coexisting in the build. No conflict; both are linked.

### Solution 19
`v0.0.0-20230615120000-abcdef123456` = base version `v0.0.0`, UTC timestamp `2023-06-15 12:00:00`, commit prefix `abcdef123456`. MVS orders it by base+timestamp; a later-tagged release will outrank it.

### Solution 20
`-u` crosses minor boundaries (more change, more risk); `-u=patch` stays within the current minor (bug fixes only). A routine maintenance bot should default to `-u=patch` for low-risk currency, escalating to `-u` only for deliberate, tested minor bumps.

---

## Checkpoints

After completing the easy tasks: you can read the build list, prove a `require` is a floor, and confirm MVS never auto-upgrades.
After completing the medium tasks: you can trace upgrade cascades, observe downgrade propagation, connect the `go` directive to pruning, and use `exclude`.
After completing the hard tasks: you can construct a contested module graph by hand and verify selection, simulate upgrade impact safely, parse the build list as data, and demonstrate reproducibility across tags.
After completing the bonus tasks: you can patch a transitive CVE by raising a floor, build a build-list differ, force major-version coexistence, decode pseudo-versions, and reason about upgrade-all vs patch-only as policy.
