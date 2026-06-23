# `go mod tidy` — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are at the end.

---

## Easy

### Task 1 — First tidy

Create a fresh directory `tidy-demo`. Initialise it as a module:

```bash
go mod init example.com/tidy-demo
```

Add a `main.go` that imports `github.com/google/uuid`:

```go
package main

import (
    "fmt"
    "github.com/google/uuid"
)

func main() {
    fmt.Println(uuid.New())
}
```

Now run `go mod tidy`. Confirm:

- A `require github.com/google/uuid vX.Y.Z` line appeared in `go.mod`.
- A `go.sum` file was created with at least two lines per dependency (`h1:` and `go.mod h1:`).
- `go run .` prints a UUID.

**Goal.** See tidy turn an import into a recorded dependency.

---

### Task 2 — Add then remove

Continuing from Task 1, edit `main.go` to *also* import `github.com/fatih/color`:

```go
import (
    "github.com/fatih/color"
    "github.com/google/uuid"
)
```

Run `go mod tidy`. Confirm `color` was added to `go.mod`.

Now delete the `color` import and the line that uses it. Run `go mod tidy` again. Confirm:

- The `require github.com/fatih/color ...` line is **gone** from `go.mod`.
- The corresponding `h1:` lines in `go.sum` are gone too.

**Goal.** Watch tidy add and then prune.

---

### Task 3 — Inspect `go.sum` before and after

In a fresh tidy-demo, run:

```bash
wc -l go.sum
```

Note the line count. Now run `go mod tidy` *again* with no source changes. Run `wc -l go.sum` again.

**Goal.** Confirm tidy is idempotent when nothing has changed.

Hint: line count should be identical, file mtime may or may not change depending on Go version.

---

### Task 4 — The `// indirect` marker

Add a single direct dependency that itself has dependencies. A good candidate:

```go
import "github.com/spf13/cobra"
```

Run `go mod tidy`. Open `go.mod` and identify:

1. Which `require` block has direct dependencies (no comment).
2. Which `require` block has lines ending with `// indirect`.
3. Pick one indirect line and explain in a sentence why it is indirect (the package is not imported by your code, but is needed by `cobra`).

**Goal.** Learn to read a real-world `go.mod`.

---

### Task 5 — Verbose tidy

Run `go mod tidy -v` on a project that has at least three direct imports. Read the output carefully. Identify:

- Lines starting with `unused` (modules being removed).
- Lines indicating that a module was `added` to fulfil an import.
- The order in which the toolchain processes things.

**Goal.** Learn what the verbose flag actually prints.

---

## Medium

### Task 6 — Imports under build tags

Create a project with two files:

`main.go`:
```go
package main

import "fmt"

func main() { fmt.Println("hi") }
```

`linux.go`:
```go
//go:build linux

package main

import _ "github.com/godbus/dbus/v5"
```

Run `go mod tidy` on macOS or Windows. Then run it on a Linux machine (or with `GOOS=linux go mod tidy`). Compare the two `go.mod` files.

**Goal.** Understand that tidy considers *all* build configurations, not just the current one.

---

### Task 7 — `-compat=1.17` mode

Take a project with at least one transitive dependency. Run:

```bash
go mod tidy -compat=1.17
```

Open `go.mod` and notice that the indirect block is now larger than after a plain `go mod tidy`. Explain why in a sentence.

**Goal.** Understand the lazy-loading trade-off between Go 1.17+ default behaviour and the older "all transitives listed" behaviour.

---

### Task 8 — CI tidy-drift gate

Add a GitHub Actions workflow `.github/workflows/tidy.yml` to a repo. The workflow must:

1. Check out the code.
2. Set up Go using `go-version-file: go.mod`.
3. Run `go mod tidy`.
4. Fail if `git diff --exit-code go.mod go.sum` reports any change.

Push a deliberately untidy change (e.g., add an `import` of a new package without running tidy) and confirm the workflow fails.

**Goal.** Build the most common module-related CI gate.

---

### Task 9 — Tidy after `go get @latest`

In an existing project that depends on a library, run:

```bash
go get github.com/spf13/cobra@latest
go mod tidy
```

Open `go.mod` and explain:

- Why the version line for `cobra` changed.
- Whether any `// indirect` lines disappeared or appeared.
- Whether `go.sum` grew, shrank, or stayed the same.

**Goal.** See how tidy reconciles `go get`'s effects.

---

### Task 10 — Workspace + tidy

Create a `go.work` workspace with two modules:

```
ws/
├── go.work
├── service/
│   └── go.mod          (example.com/service, imports example.com/lib)
└── lib/
    └── go.mod          (example.com/lib)
```

Run `go mod tidy` from inside `service/`. Then run it from inside `lib/`. Observe:

- Tidy operates on **one module at a time**, not the workspace.
- The workspace overlay is *not* used to resolve `example.com/lib` during tidy — only when building.

**Goal.** Understand that tidy is module-local.

---

## Hard

### Task 11 — Air-gapped tidy

Set up a project that already has all dependencies populated in the module cache (`go env GOMODCACHE`). Then:

1. Disconnect from the network (or set `GOPROXY=off`).
2. Run `go mod tidy`.

Confirm it succeeds because everything it needs is cached. Now delete one entry from the cache and re-run; confirm it fails with a clear network error.

**Goal.** Understand the cache as the offline source of truth.

Hint: `go mod download all` before going offline guarantees the cache is warm.

---

### Task 12 — `replace` survives tidy

Take a project that depends on `github.com/spf13/cobra`. Clone cobra to `/tmp/cobra-fork`. Add to `go.mod`:

```
replace github.com/spf13/cobra => /tmp/cobra-fork
```

Run `go mod tidy`. Confirm:

- The `replace` line is **still there** afterward.
- The `require` line for cobra still exists (replace does not remove the require).
- A small edit to `/tmp/cobra-fork` is reflected when you `go run .`.

**Goal.** Verify tidy and replace coexist correctly.

---

### Task 13 — Ambiguous import

Reproduce an "ambiguous import" error. Setup:

1. Create a module that imports a package whose path could resolve through two different `require` lines (e.g., a parent module and a `/v2` major-version module both providing the same package).
2. Run `go mod tidy` and capture the error.
3. Resolve it by removing one of the conflicting requires (or by using a more specific import path).

**Goal.** Recognise and fix one of tidy's nastier failure modes.

Hint: you can synthesise this by adding both `github.com/foo/bar` and `github.com/foo/bar/v2` as requires, and importing a package that exists in both at the same relative path.

---

### Task 14 — Tidy + `go mod vendor`

In a project with several dependencies:

1. Run `go mod tidy`.
2. Run `go mod vendor`.
3. Open `vendor/modules.txt`.
4. Verify that every module in `vendor/modules.txt` corresponds to either a direct or indirect entry in `go.mod`.
5. Now manually add an unused import to a Go file, run `go mod tidy`, then `go mod vendor`. Confirm `vendor/modules.txt` was updated coherently.

**Goal.** Understand the contract between tidy and vendor.

---

### Task 15 — Monorepo tidy script

Set up a monorepo with several modules:

```
mono/
├── api/      go.mod
├── worker/   go.mod
├── shared/   go.mod
└── tools/    go.mod
```

Write a shell script `tidy-all.sh` that:

1. Finds every directory containing a `go.mod` (use `find . -name go.mod -not -path './vendor/*'`).
2. Runs `go mod tidy` in each one.
3. After all runs, executes `git diff --exit-code` and lists which modules drifted.

Run the script on a deliberately untidy monorepo. Confirm it reports the right modules.

**Goal.** Build infrastructure that scales tidy to many modules.

---

## Bonus / Stretch

### Task 16 — Reimplement the resolver outline

Write a small Go program that:

1. Parses `go.mod` using `golang.org/x/mod/modfile`.
2. Walks the source tree using `go/parser` to collect every `import` path.
3. Runs `go list -m -json all` and indexes the result.
4. For every import, identifies which module satisfies it.
5. Reports any import that has no satisfier (would be added by tidy) and any required module no import refers to (would be removed).

You do **not** need to invoke `go mod tidy`. Print a tidy-equivalent report.

**Goal.** Understand tidy's algorithm by sketching it.

---

### Task 17 — PR diff bot

Write a script (any language) that, given a PR's `go.mod` diff:

1. Identifies *new* `require` lines that are direct (not `// indirect`).
2. Looks up each new dependency on `pkg.go.dev` (or just prints a markdown-formatted link).
3. Posts the result as a PR comment via `gh pr comment` (or prints to stdout).

The point is to surface "this PR introduces a new dependency on X" reviewers may otherwise miss.

**Goal.** Build a guardrail around dependency growth.

---

### Task 18 — Pin `go` low

Take a working project. Edit `go.mod` and lower the `go` directive to a deliberately old version (e.g., `go 1.19`). Run `go mod tidy`.

Now use a Go 1.21+ feature in code (e.g., `min(a, b)` builtin or `clear(m)`). Run `go build`. Capture the error. Run `go mod tidy` again. Did tidy bump the `go` directive?

**Goal.** Understand tidy's limited automatic role for the `go` directive.

---

### Task 19 — `go.work` and `go work sync`

In a workspace project:

1. Note the difference between `go work sync` (which updates *workspace* module dependencies to a common version) and `go mod tidy` (which acts per-module).
2. Set up a workspace where two member modules pin different versions of the same library. Run `go work sync` and observe the resolution.
3. Then run `go mod tidy` in each member; do the versions diverge again?

**Goal.** Master workspace dependency reconciliation.

---

### Task 20 — `go.sum` forensics

Given a `go.sum` file from an unfamiliar project (or your own, deliberately damaged):

1. Identify lines whose modules are no longer required by `go.mod`.
2. Identify modules that *are* required but missing checksum entries.
3. Build a script that flags both kinds of staleness without running `go mod tidy`.

Hint: parse `go.mod` with `golang.org/x/mod/modfile`, parse `go.sum` line by line (`module version hash`), and compare the sets.

**Goal.** Read `go.sum` directly and reason about it.

---

## Solutions (sketched)

### Solution 1
```bash
mkdir tidy-demo && cd tidy-demo
go mod init example.com/tidy-demo
# write main.go with the uuid import
go mod tidy
cat go.mod         # has require github.com/google/uuid vX.Y.Z
cat go.sum         # has at least two lines for uuid
go run .           # prints a UUID
```

### Solution 2
After adding `color`, `go.mod` gains:
```
require (
    github.com/fatih/color vX.Y.Z
    github.com/google/uuid vA.B.C
)
```
After removing the `color` import and re-tidying, only the `uuid` line remains, and `go.sum`'s `color` entries are pruned.

### Solution 3
Tidy is idempotent — running it a second time on a clean tree changes nothing. Both `wc -l` results are identical.

### Solution 4
- `cobra` itself is direct.
- Lines like `github.com/inconshreveable/mousetrap vX // indirect` are dependencies of cobra that your own code does not import.
- They are required because the build graph includes them, but you never wrote `import "github.com/inconshreveable/mousetrap"` yourself.

### Solution 5
```
go: finding module for package github.com/foo/bar
go: found github.com/foo/bar in github.com/foo/bar v1.2.3
unused github.com/old/dep
```
Lines starting with `unused` indicate prunable modules; `found` indicates resolution.

### Solution 6
Without GOOS=linux, the `dbus` import is not seen by tidy because the file is excluded by build tags. With `GOOS=linux go mod tidy`, the `dbus` require appears. Tidy considers all GOOS/GOARCH combinations the toolchain knows about by default — but explicit env overrides narrow the scope.

### Solution 7
`-compat=1.17` forces tidy to keep all transitive modules listed in `go.mod` so a Go 1.17 toolchain can build the project without lazy loading. The indirect block grows because Go 1.18+ can omit modules that aren't needed by any build, but 1.17 cannot.

### Solution 8
```yaml
name: tidy-check
on: [pull_request]
jobs:
  tidy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version-file: go.mod
      - run: go mod tidy
      - run: git diff --exit-code go.mod go.sum
```

### Solution 9
- `go get cobra@latest` updates the require line and may change cobra's transitive deps.
- Tidy may add new `// indirect` lines for cobra's new transitive deps and remove old ones.
- `go.sum` typically grows because the new versions add `h1:` lines without immediately removing the old ones (those are kept for safety until the next tidy).

### Solution 10
```bash
cd ws/service && go mod tidy   # operates on service/go.mod only
cd ../lib && go mod tidy       # operates on lib/go.mod only
```
The `go.work` file is ignored by tidy. To resolve `example.com/lib` from `service`, tidy needs a `replace` or a tagged version — the workspace overlay is build-time only.

### Solution 11
```bash
go mod download all          # warm the cache
export GOPROXY=off
go mod tidy                   # succeeds using cache
rm -rf $(go env GOMODCACHE)/cache/download/github.com/google/uuid
go mod tidy                   # fails: cannot reach proxy
```

### Solution 12
```
replace github.com/spf13/cobra => /tmp/cobra-fork
require github.com/spf13/cobra v1.8.0   // version is still required
```
Tidy preserves the `replace` directive. Edits in `/tmp/cobra-fork` are picked up because the toolchain reads from that path.

### Solution 13
```
go: ambiguous import: found package github.com/foo/bar in multiple modules:
        github.com/foo/bar v1.0.0
        github.com/foo/bar/v2 v2.0.0
```
Fix: pick the version you actually want. Edit imports to use the corresponding path (e.g., `github.com/foo/bar/v2/sub`), then run tidy. The unused require line is pruned.

### Solution 14
After `go mod tidy && go mod vendor`, `vendor/modules.txt` lists exactly the modules in `go.mod`'s require blocks. Adding an unused import then re-running tidy + vendor adds an entry that gets pruned the moment the import is removed and tidy is re-run.

### Solution 15
```bash
#!/usr/bin/env bash
set -euo pipefail
roots=$(find . -name go.mod -not -path './vendor/*' -exec dirname {} \;)
for r in $roots; do
  (cd "$r" && go mod tidy)
done
if ! git diff --exit-code; then
  echo "Drift detected in:"
  git diff --name-only | xargs -n1 dirname | sort -u
  exit 1
fi
```

### Solution 16
```go
import (
    "go/parser"
    "go/token"
    "golang.org/x/mod/modfile"
)
// 1. Parse go.mod -> set of required modules
// 2. Walk *.go, parse, collect all import paths
// 3. Run `go list -m -json all`, decode to map[path]Module
// 4. For each import, find longest required-module prefix
// 5. Report missing (no module covers it) and unused (required but no import)
```

### Solution 17
```bash
gh pr diff --patch | \
  grep -E '^\+\s*[a-z]' | \
  grep -v 'indirect' | \
  awk '{print $2}' | \
  while read pkg; do
    echo "- new direct dep: [$pkg](https://pkg.go.dev/$pkg)"
  done | gh pr comment --body-file -
```

### Solution 18
Tidy does **not** automatically downgrade or upgrade the `go` directive based on language features in your code — it leaves the directive alone. The `go build` step is the one that fails. To fix, manually bump the `go` directive (or use `go mod edit -go=1.22`) and re-run tidy.

### Solution 19
- `go work sync` pushes the workspace's effective versions back into each member's `go.mod`.
- After `sync`, both members should have the same version line.
- Running `go mod tidy` in each member afterward usually preserves the synced version, *unless* a member's source code requires a newer one.

### Solution 20
```go
// pseudo-code
required := parseGoMod("go.mod").Requires        // map[modulePath]version
sumLines := parseGoSum("go.sum")                 // []sumLine
for _, l := range sumLines {
    if _, ok := required[l.Module]; !ok {
        fmt.Println("stale:", l)
    }
}
for path := range required {
    if !hasSumLine(sumLines, path) {
        fmt.Println("missing checksum:", path)
    }
}
```

---

## Checkpoints

After completing the easy tasks: you can confidently run tidy and read its output on any project.
After completing the medium tasks: you understand build tags, compat modes, CI integration, and workspace interaction.
After completing the hard tasks: you can run tidy in air-gapped environments, manage replaces, resolve ambiguous imports, and orchestrate tidy across a monorepo.
After completing the bonus tasks: you understand tidy at the implementation level and can build tooling that augments or replaces it.
