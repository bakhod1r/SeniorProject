# Module Graph Pruning — Find the Bug

> Each snippet contains a real-world bug related to module graph pruning. Pruning (Go 1.17+) loads only the import-relevant part of the module graph for a main module at `go 1.17` or higher; to stay correct, a pruned `go.mod` records a larger set of `// indirect` requirements so it is self-contained. Find the bug, explain it, fix it.

---

## Bug 1 — Deleting the `// indirect` block to "clean up" `go.mod`

```go.mod
module example.com/app

go 1.21

require github.com/spf13/cobra v1.8.0

// removed the "noisy" indirect block by hand
```

```bash
$ go build ./...
go: updates to go.mod needed; to update it:
	go mod tidy
```

**Bug:** Under pruning, the `// indirect` block is not noise — it records the indirect dependency versions that keep the pruned `go.mod` self-contained. Deleting it makes `go.mod` incomplete, and the default `-mod=readonly` build refuses to silently rewrite it.

**Fix:** never hand-prune the indirect block. Regenerate it:

```bash
$ go mod tidy
$ git add go.mod go.sum
$ git commit -m "Restore indirect requirements"
```

The block exists *because* pruning does not load the deep graph; it must be recorded.

---

## Bug 2 — `go get` without re-tidying

```bash
$ go get github.com/spf13/cobra@v1.8.0
$ git add go.mod go.sum
$ git commit -m "Bump cobra"
$ # CI:
$ go build ./...
go: updates to go.mod needed; to update it:
	go mod tidy
```

**Bug:** `go get` changed the direct requirement but did not recompute the full pruned indirect set. The recorded indirect block is now stale relative to what the new version needs, so the self-contained `go.mod` is incomplete.

**Fix:** always follow a version change with `go mod tidy`:

```bash
$ go get github.com/spf13/cobra@v1.8.0
$ go mod tidy
$ git add go.mod go.sum
$ git commit --amend --no-edit
```

CI guard:

```bash
$ go mod tidy
$ git diff --exit-code go.mod go.sum
```

---

## Bug 3 — Staying on `go 1.16` "to keep go.mod small"

```go.mod
module example.com/service

go 1.16   // deliberately old to avoid the big indirect block
```

```bash
$ time go list -m all
# ... slow: loads the full transitive graph every command
```

**Bug:** Pinning the `go` directive to `1.16` disables pruning. The `go.mod` is smaller, but every `go` command loads the *full* module graph — slower, with more `go.mod` fetches. This trades a small file for a slow, full-graph build.

**Fix:** bump to a modern directive and accept the larger, self-contained `go.mod`:

```bash
$ go mod tidy -go=1.21
$ git add go.mod go.sum
$ git commit -m "Enable module graph pruning (go 1.21)"
```

The bigger `go.mod` is the *faster* choice.

---

## Bug 4 — Migrating without `-compat`, breaking older consumers

```bash
$ go mod tidy -go=1.21      # no -compat
$ git commit -am "Go 1.21"
$ git push                  # library consumed by a Go 1.17 team
```

```bash
# downstream, on Go 1.17:
$ go build ./...
go: missing go.sum entry for go.mod file of
	example.com/app@v1.4.0
```

**Bug:** Tidying with `-go=1.21` and the default `-compat` (1.20) dropped the `go.sum` `go.mod`-hash entries that a Go 1.17 consumer needs to load the *full* graph. The library still builds for you, but breaks for older consumers.

**Fix:** set `-compat` to your real support floor:

```bash
$ go mod tidy -go=1.21 -compat=1.17
$ git add go.mod go.sum
$ git commit -m "Re-tidy with -compat=1.17 for older consumers"
```

Add a CI matrix job on Go 1.17 that resolves and builds the module as a consumer would.

---

## Bug 5 — Reverting the lines a deepening event added

```bash
$ git diff go.mod
  require example.com/newdep v1.0.0
+ require (
+     example.com/transitive-a v0.3.0 // indirect
+     example.com/transitive-b v0.5.1 // indirect
+ )
$ # reviewer: "you only added one import, why three lines? revert the extras"
$ git checkout -- go.mod   # kept only the direct require
$ go build ./...
go: updates to go.mod needed; to update it:
	go mod tidy
```

**Bug:** Adding one import *deepened* the pruned graph, revealing constraints that pruning had elided. The extra `// indirect` lines are the correct, MVS-preserving record of those constraints. Reverting them breaks self-containment.

**Fix:** keep the deepened lines; they are not redundant:

```bash
$ go mod tidy        # re-derives the same lines
$ git add go.mod go.sum
```

Educate reviewers: one import change legitimately producing several `go.mod` lines is pruning working as designed.

---

## Bug 6 — A `go 1.15` dependency silently re-inflates the graph

```bash
$ go list -m -json all | jq -r 'select(.GoVersion < "1.17") | "\(.Path) \(.GoVersion)"'
github.com/legacy/lib 1.15
$ go mod graph | wc -l
1842        # far larger than peers expect for this dep count
```

**Bug:** One transitive dependency declares `go 1.15`. It is not self-contained, so Go must load its *full* transitive requirements, re-inflating the loaded graph for everyone downstream. Pruning's benefit is partially lost.

**Fix:** upgrade the laggard to a `go 1.17+` release, or `replace` it with a maintained fork:

```bash
$ go get github.com/legacy/lib@latest      # if a modern release exists
$ go mod tidy
$ go mod graph | wc -l                      # should drop
```

If upstream is dead:

```bash
$ go mod edit -replace=github.com/legacy/lib=github.com/maintained/fork@v2.0.0
$ go mod tidy
```

---

## Bug 7 — `GOFLAGS=-mod=mod` hides un-tidied `go.mod` in CI

```yaml
# ci.yml
env:
  GOFLAGS: -mod=mod
steps:
  - run: go build ./...      # silently rewrites go.mod during build
```

**Bug:** With `-mod=mod`, the build *silently* updates `go.mod` to add missing indirect requirements instead of erroring. CI therefore never catches a contributor who forgot to run `go mod tidy`; the stale-`go.mod` signal is suppressed, and drift accumulates.

**Fix:** rely on the `-mod=readonly` default (which surfaces "updates to go.mod needed") and gate tidiness explicitly:

```yaml
env:
  GOFLAGS: ""        # do not force -mod=mod
steps:
  - run: go build ./...
  - run: |
      go mod tidy
      git diff --exit-code go.mod go.sum
```

---

## Bug 8 — Forgetting to re-vendor after a directive bump

```bash
$ go mod tidy -go=1.21        # migrated to pruning
$ git commit -am "Go 1.21"
$ # vendor/ left untouched
$ go build ./...
go: inconsistent vendoring in /code/app:
	github.com/x/y@v1.2.0: is marked as explicit in vendor/modules.txt,
	but not explicitly required in go.mod
	(Use "go mod vendor" to sync.)
```

**Bug:** Bumping the `go` directive changed the pruned indirect set *and* the per-module `## go <version>` markers `vendor/modules.txt` should carry (added in Go 1.17). The committed `vendor/` is now inconsistent with the new pruned `go.mod`.

**Fix:** re-vendor after any directive or dependency change:

```bash
$ go mod tidy
$ go mod vendor
$ git add go.mod go.sum vendor
$ git commit -m "Re-vendor after enabling pruning"
```

---

## Bug 9 — Hand-editing `go.sum` to remove "unused" lines

```bash
$ # someone deleted go.mod-hash lines that "weren't used by the build"
$ git diff go.sum
- github.com/foo/bar v1.0.0/go.mod h1:...
$ # later, an older Go consumer:
$ go build ./...
go: missing go.sum entry for go.mod file of github.com/foo/bar@v1.0.0
```

**Bug:** Pruning loads fewer `go.mod` files, so some `go.mod`-hash lines look unused *to the current pruned build*. But an older consumer loading the full graph still needs them — that is exactly what `-compat` retains. Hand-deleting them breaks older-Go graph loading.

**Fix:** never hand-edit `go.sum`. Let `tidy` (with the right `-compat`) manage it:

```bash
$ go mod tidy -compat=1.17
$ git checkout -- go.sum 2>/dev/null; go mod tidy -compat=1.17
$ git add go.sum
```

---

## Bug 10 — Assuming pruning changed a selected version

```bash
$ go mod edit -go=1.21 && go mod tidy
$ go list -m github.com/foo/bar
github.com/foo/bar v1.4.0        # was v1.2.0 before!
$ # "pruning bumped my dependency!"  -> reverts the directive
```

**Bug:** The bump was *not* caused by pruning per se. Crossing into the pruned regime *deepened* the graph and recorded a higher minimum that was always logically present in the full graph (some module required `v1.4.0`). Pruning preserves MVS selection; the recorded result is the correct version. Reverting the directive hides a constraint rather than fixing anything.

**Fix:** accept the correct MVS result, or pin a lower compatible version *explicitly and knowingly* if you have a reason:

```bash
$ go mod why -m github.com/foo/bar      # find who requires v1.4.0
$ # if the bump is genuinely unwanted and safe to avoid:
$ go get github.com/foo/bar@v1.3.0      # explicit, informed pin
$ go mod tidy
```

Do not "fix" it by abandoning pruning.

---

## Bug 11 — `go mod tidy` on the wrong toolchain churns `go.mod`

```bash
# Developer A, Go 1.20:
$ go mod tidy && git commit -am "tidy"
# Developer B, Go 1.22:
$ go mod tidy && git commit -am "tidy"   # reverts A's go.sum entries
# ... PRs ping-pong forever
```

**Bug:** Different local toolchains across the pruning boundary produce slightly different indirect sets and `go.sum` contents (the default `-compat` is also dynamic — one minor below the directive). Each `tidy` reverts the other.

**Fix:** pin the toolchain and agree on `-compat`:

```go.mod
go 1.21

toolchain go1.22.4
```

```bash
$ go mod tidy -compat=1.20      # one agreed value, documented
$ git add go.mod go.sum
```

Document the toolchain and `-compat` in `CONTRIBUTING.md`; add a CI tidiness gate so only the canonical result is accepted.

---

## Bug 12 — Expecting a dependency's test deps in the pruned graph

```bash
$ go test ./...
# fails: a helper from github.com/foo/bar's *_test.go is unavailable
vendor/github.com/foo/bar/internal/testhelper: cannot find package
```

**Bug:** The pruned graph (and vendoring) includes what is needed to build and test *your* packages, but **not** the test-only dependencies of your dependencies. The code tried to reach an upstream module's `_test.go`-only helper, which pruning legitimately excludes — this is exactly the bloat pruning removed.

**Fix:** do not depend on an upstream module's test-only code. Either ask upstream to move the helper into a non-test package, vendor/replace a fork that does, or copy the helper into your own `internal/` package:

```bash
# preferred: the helper belongs in your own test support package
$ mkdir -p internal/testsupport
$ # reimplement or vendor the small helper you actually need
```

---

## Bug 13 — `go mod graph` looks "truncated" after upgrading Go

```bash
$ go mod graph | wc -l
214        # used to be ~1900 on the old project
$ # "did the upgrade lose dependencies?"
```

**Bug:** Not a bug in the build — a misread. The project's `go` directive is now `1.21`, so `go mod graph` prints the *pruned* graph, which is intentionally far smaller than the old full graph. The smaller number is correct, not truncated.

**Fix:** confirm by comparing regimes; nothing to repair:

```bash
$ go list -m all | wc -l        # build list still complete
$ go mod edit -go=1.16 && go mod tidy && go mod graph | wc -l   # see the full count
$ go mod edit -go=1.21 && go mod tidy                            # restore
```

Document for the team that a pruned `go mod graph` is expected to be compact.

---

## Bug 14 — `go mod tidy -compat` inconsistency ignored

```bash
$ go mod tidy -compat=1.16
go: example.com/app: the pruned module graph and the go 1.16 module graph
	disagree on the version of golang.org/x/text:
	v0.14.0 (pruned) vs v0.13.0 (go 1.16)
$ # ignored the warning, committed anyway
```

**Bug:** `-compat` detected that the pruned regime and the older regime would select *different* versions for an imported package — a genuine cross-version hazard. Ignoring it ships a module that builds differently on Go 1.16 vs Go 1.21.

**Fix:** treat the inconsistency as an error to resolve, not a warning to suppress. Usually you raise an explicit requirement so both regimes agree:

```bash
$ go get golang.org/x/text@v0.14.0     # pin so both regimes select the same
$ go mod tidy -compat=1.16             # must now report no inconsistency
$ git add go.mod go.sum
```

If you cannot reconcile, raise your support floor (drop 1.16) deliberately rather than shipping divergence.

---

## Bug 15 — `replace` to a `go 1.15` fork re-inflates the graph

```go.mod
go 1.21

require github.com/x/y v1.5.0

replace github.com/x/y => github.com/me/y-fork v1.5.0-patch
```

```bash
$ # me/y-fork's go.mod says: go 1.15
$ go mod graph | wc -l        # jumped after adding the replace
```

**Bug:** Pruning decides self-containment from the *replacement's* `go` directive. The fork declares `go 1.15`, so Go loads its full transitive requirements — re-inflating the graph even though the original `github.com/x/y` was pruned-friendly.

**Fix:** bump the fork's own `go` directive to `1.17+` and re-tag:

```bash
# in the fork:
$ go mod edit -go=1.21
$ go mod tidy
$ git tag v1.5.0-patch.1 && git push --tags
# in the consumer:
$ go mod edit -replace=github.com/x/y=github.com/me/y-fork@v1.5.0-patch.1
$ go mod tidy
$ go mod graph | wc -l        # back down
```

A fork should match the directive expectations of what it replaces.

---

## Bug 16 — Treating the two `require` blocks as a merge mistake

```go.mod
require github.com/spf13/cobra v1.8.0

require (
	github.com/inconshreveable/mousetrap v1.1.0 // indirect
	github.com/spf13/pflag v1.0.5 // indirect
)
```

```bash
$ # "the merge created a duplicate require block, let me combine them"
$ # manually merged into one block and dropped the // indirect comments
$ go build ./...
go: updates to go.mod needed; to update it:
	go mod tidy
```

**Bug:** The two `require` blocks are not a merge artifact — `go mod tidy` deliberately separates direct from `// indirect` requirements for readability. Combining them is harmless *if* the `// indirect` comments are preserved, but dropping those comments mislabels indirect deps as direct, and `tidy` will fight the change.

**Fix:** leave the structure to `tidy`:

```bash
$ go mod tidy
$ git diff go.mod        # tidy restores the two-block, correctly-commented form
```

The split is a convention; the `// indirect` markers are semantically meaningful and must stay.

---

## Bug 17 — Vendoring at `go 1.16` and expecting pruned `modules.txt` markers

```bash
$ go mod edit -go=1.16     # downgraded for "compatibility"
$ go mod vendor
$ grep -c '^## go ' vendor/modules.txt
0                          # no per-module go markers
```

**Bug:** The `## go <version>` markers in `vendor/modules.txt` are emitted for pruned (`go 1.17+`) modules. At `go 1.16`, vendoring uses full-graph semantics and does not record them. A toolchain expecting pruning-aware vendor metadata finds none.

**Fix:** keep the main module at `go 1.17+` so vendoring records the markers:

```bash
$ go mod edit -go=1.21
$ go mod tidy
$ go mod vendor
$ grep -c '^## go ' vendor/modules.txt    # now non-zero
```

Downgrading the directive disables both pruning *and* its vendor metadata.

---

## Bug 18 — Adding a dependency in `go.mod` by hand without tidying

```go.mod
go 1.21

require (
	github.com/spf13/cobra v1.8.0
	github.com/google/uuid v1.6.0      // hand-added, no indirect deps recorded
)
```

```bash
$ go build ./...
go: updates to go.mod needed; to update it:
	go mod tidy
```

**Bug:** Hand-adding a direct `require` does not record the *indirect* requirements that dependency pulls in. Under pruning, those must be in the self-contained `go.mod`, but a manual edit cannot know them. The readonly build refuses to proceed.

**Fix:** add dependencies through the toolchain, then tidy:

```bash
$ go get github.com/google/uuid@v1.6.0
$ go mod tidy
$ git add go.mod go.sum
```

`go mod tidy` discovers and records the indirect closure a hand-edit cannot.

---

## Bug 19 — Assuming `go.mod` size means dependency count

```bash
$ wc -l go.mod
  47 go.mod        # "47 dependencies?! we need to cut these"
$ go list -m all | grep -v '=> ' | wc -l
  43               # actually selected modules
$ # team starts removing // indirect lines to "reduce dependencies"
```

**Bug:** The line count of a pruned `go.mod` is dominated by the *recorded* indirect requirements, not by how many modules you directly chose. Treating each line as a dependency to "cut" leads to deleting the indirect block — breaking self-containment.

**Fix:** distinguish *direct* dependencies (your real choices) from *recorded indirect* ones (derived):

```bash
$ go list -m -json all | jq -r 'select(.Indirect != true and .Main != true) | .Path'   # real direct deps
$ # to genuinely reduce dependencies, drop imports and let tidy prune:
$ go mod tidy
```

The indirect block is a consequence of pruning, not a backlog of dependencies to remove.

---

## Bug 20 — `go mod tidy` removed an indirect line you thought was needed

```bash
$ go mod tidy
$ git diff go.mod
- github.com/old/helper v0.4.0 // indirect
$ # "tidy is broken, it deleted a dependency we use"
```

**Bug:** A refactor removed the last import that (transitively) reached `github.com/old/helper`. Since nothing in the pruned import graph needs it anymore, `tidy` correctly removed it from the self-contained `go.mod`. This is the *intended* removal half of tidy, not a bug.

**Fix:** verify with `go mod why` before assuming breakage:

```bash
$ go mod why -m github.com/old/helper
# (main module does not need module github.com/old/helper)
$ go build ./... && go test ./...    # confirm nothing actually needs it
```

If a build/test *does* fail, the import still exists somewhere — re-tidy will re-add it. Trust the import graph, not intuition.

---

## Summary

The pruned module graph looks like a smaller graph and a bigger `go.mod`, but it is a tightly-coupled system with strict consistency rules. Most pruning bugs come from one of three habits:

1. **Treating the `// indirect` block (or `go.sum`) as editable noise.** It is derived state that makes the pruned `go.mod` self-contained. Deleting lines, merging blocks, or trimming `go.sum` breaks correctness — and is undone or rejected by `go mod tidy` and the `-mod=readonly` default. Always regenerate; never hand-prune.
2. **Forgetting that `go.mod` is downstream of every dependency and directive change.** Every `go get`, directive bump, `replace`, or merge must be followed by `go mod tidy` (and `go mod vendor` if vendored), committed atomically. CI must diff `go.mod`/`go.sum` after `tidy` and fail on drift.
3. **Misreading pruning's outputs.** A compact `go mod graph`, a multi-line `go.mod` diff from one import (deepening), a "bumped" version (a recorded full-graph constraint), and a large indirect block are all *correct*. A `go < 1.17` dependency (or fork) silently re-inflates the graph; audit directives and set `-compat` to your real support floor.

Treat the pruned `go.mod` and `go.sum` as compiled output that happens to live in your repo: owned by `go mod tidy`, kept tidy in CI, pinned to one toolchain, never hand-massaged. With those habits, pruning becomes invisible — fast commands and reproducible, self-contained metadata.
