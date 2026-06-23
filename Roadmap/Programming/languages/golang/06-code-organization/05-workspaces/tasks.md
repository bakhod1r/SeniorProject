# Workspaces — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are sketched at the end of each task.

---

## Easy

### Task 1 — Your first workspace

Create two empty modules side by side, then group them in a workspace:

```bash
mkdir -p ~/work/lab1 && cd ~/work/lab1
mkdir libfoo && cd libfoo && go mod init example.com/lab1/libfoo && cd ..
mkdir app    && cd app    && go mod init example.com/lab1/app    && cd ..
go work init ./libfoo ./app
cat go.work
```

**Success:** `go.work` exists with a `go` directive and a `use ( ./libfoo ./app )` block.

**Goal.** Walk the smallest possible workspace setup end-to-end.

**Solution sketch.** The output of `cat go.work` should be:

```
go 1.22

use (
    ./libfoo
    ./app
)
```

(Your `go` line will reflect your installed toolchain.)

---

### Task 2 — Cross-module import via workspace

Continuing from Task 1. In `libfoo/`, write:

```go
// libfoo/foo.go
package libfoo

func Hello() string { return "hello from libfoo" }
```

In `app/`, write:

```go
// app/main.go
package main

import (
    "fmt"

    "example.com/lab1/libfoo"
)

func main() { fmt.Println(libfoo.Hello()) }
```

Run from `app/`:

```bash
go run .
```

**Success:** prints `hello from libfoo`. Note that `app/go.mod` does **not** require `example.com/lab1/libfoo` and you did **not** run `go get`.

**Goal.** Feel the difference: a workspace lets a module import an unpublished sibling.

---

### Task 3 — Disable the workspace and observe the failure

Run from `app/`:

```bash
GOWORK=off go run .
```

**Success:** the build fails with `no required module provides package example.com/lab1/libfoo`.

**Goal.** See what consumers will see. The workspace was hiding a real missing requirement.

---

### Task 4 — Add the require properly, then re-run with workspace off

Edit `app/go.mod` to add the requirement:

```
require example.com/lab1/libfoo v0.0.0
```

Try the workspace-off build again:

```bash
GOWORK=off go run .
```

**Expected:** it still fails — there is no published version `v0.0.0` of `example.com/lab1/libfoo` on any proxy. This is the realistic situation: you cannot ship `app` until you publish `libfoo`. The workspace lets you develop both at once anyway.

**Goal.** Internalise the workspace's role as a developer convenience that does not replace publishing.

---

### Task 5 — Inspect `go env GOWORK`

Run, from inside the workspace:

```bash
go env GOWORK
```

**Success:** prints the absolute path to the `go.work` file.

Then:

```bash
GOWORK=off go env GOWORK
```

**Success:** prints `off`.

**Goal.** Know how to ask the toolchain "am I in a workspace?"

---

## Medium

### Task 6 — Add a third module with `go work use`

Continuing from earlier tasks. Add a `cli/` module:

```bash
cd ~/work/lab1
mkdir cli && cd cli && go mod init example.com/lab1/cli && cd ..
go work use ./cli
```

**Success:** `go.work` now lists three modules. Verify with `cat go.work`.

**Goal.** Practise the `go work use` subcommand and watch `go.work` update.

---

### Task 7 — Drop a module with `go work edit`

Remove `cli` from the workspace without deleting the folder:

```bash
go work edit -dropuse=./cli
```

**Success:** `go.work` no longer mentions `cli`, but `cli/` still exists on disk.

**Goal.** The `go work edit` flags. Run `go help work edit` to see the rest.

---

### Task 8 — Workspace-wide `replace` for a fork

Imagine you depend on `github.com/upstream/lib` and need a temporary fork. Without actually downloading anything, simulate the workflow:

```bash
go work edit -replace=github.com/upstream/lib=github.com/me/lib@v1.4.0-fix1
cat go.work
```

**Success:** `go.work` ends with a `replace github.com/upstream/lib => github.com/me/lib v1.4.0-fix1` line.

Drop it again:

```bash
go work edit -dropreplace=github.com/upstream/lib
```

**Goal.** Understand that `replace` in `go.work` is a single switch affecting every listed module.

---

### Task 9 — `go work sync` in a contrived setup

Make `libfoo` import `golang.org/x/text v0.14.0`. Run from `libfoo/`:

```bash
go get golang.org/x/text@v0.14.0
```

In `app/go.mod`, manually downgrade (or pin) `golang.org/x/text` to an older version, e.g. `v0.10.0`. Now from the workspace root:

```bash
go work sync
cat app/go.mod
```

**Expected:** `app/go.mod` now requires `golang.org/x/text v0.14.0` (the workspace's resolved version), promoted from `v0.10.0`.

**Goal.** Watch `go work sync` in action: it propagates resolved versions across modules.

---

### Task 10 — Recursive `use`

Create a sub-tree of modules:

```bash
mkdir -p ~/work/lab10/{tools/a,tools/b,tools/c}
for d in tools/a tools/b tools/c; do (cd ~/work/lab10/$d && go mod init example.com/lab10/$d); done
cd ~/work/lab10
go work init
go work use -r .
cat go.work
```

**Success:** all three modules appear under `use (...)`.

**Goal.** Fast bootstrapping of a multi-module repo with `go work use -r`.

---

### Task 11 — Test isolation with `GOWORK=off`

Continuing in `~/work/lab1`. Write a tiny test in `app/`:

```go
// app/main_test.go
package main

import (
    "testing"

    "example.com/lab1/libfoo"
)

func TestHello(t *testing.T) {
    if libfoo.Hello() == "" {
        t.Fatal("empty")
    }
}
```

Run with the workspace:

```bash
go test ./app
```

**Expected:** passes.

Run without:

```bash
GOWORK=off go test ./app
```

**Expected:** fails because `libfoo` is not really published yet.

**Goal.** Recognise the symmetry: every workspace-on success has a workspace-off equivalent worth checking.

---

### Task 12 — Build a Makefile target for `release-check`

Write a `Makefile` at `~/work/lab1` with a target that runs:

```makefile
release-check:
	for m in libfoo app cli; do (cd $$m && GOWORK=off go build ./... && GOWORK=off go test ./...); done
```

**Success:** `make release-check` runs the workspace-off build and tests for each module. (For now it will fail because nothing is published; that is the *point* — the failure is real.)

**Goal.** Bake the `GOWORK=off` discipline into your tooling.

---

## Hard

### Task 13 — Migrate a `replace` from `go.mod` to `go.work`

Set up a deliberately broken layout:

```bash
mkdir -p ~/work/lab13/{lib,svc}
cd ~/work/lab13/lib && go mod init example.com/lab13/lib && cd ..
cd ~/work/lab13/svc && go mod init example.com/lab13/svc && cd ..

# in svc/go.mod, manually add:
#   require example.com/lab13/lib v0.0.0
#   replace example.com/lab13/lib => ../lib
```

In `lib/lib.go`:

```go
package lib

func Greet() string { return "hello" }
```

In `svc/main.go`:

```go
package main
import (
    "fmt"
    "example.com/lab13/lib"
)
func main() { fmt.Println(lib.Greet()) }
```

Verify it builds:

```bash
cd ~/work/lab13/svc && go run .
```

Now migrate. Remove the `replace` from `svc/go.mod`. Build — it fails. Add a `go.work`:

```bash
cd ~/work/lab13
go work init ./lib ./svc
cd svc && go run .
```

**Expected:** prints `hello`. The `go.mod` no longer carries a release-poisoning `replace`, and the workspace handles the dev-time substitution cleanly.

**Goal.** Practise the most common real-world migration.

---

### Task 14 — Workspace + git ignore strategy

Continuing from any earlier task. Create `~/work/lab14/.gitignore`:

```
go.work
go.work.sum
go.work.example
```

Wait — `go.work.example` *is* meant to be checked in. Fix the `.gitignore`:

```
go.work
go.work.sum
!go.work.example
```

Copy `go.work` to `go.work.example` and check it in. Document a one-line README:

> New contributors: `cp go.work.example go.work`.

**Goal.** A clean pattern for "share the workspace skeleton, but each contributor owns their copy."

---

### Task 15 — Topological release simulation

Three modules: `db`, `auth`, `api`. `auth` requires `db`; `api` requires `auth` and `db`. Set them up in a workspace.

Imagine a feature change in `db` that breaks `auth`'s build. Walk through the release sequence:

1. `db`: bump major version, tag `db/v2.0.0`.
2. `auth`: update import to `example.com/.../db/v2`, fix breakage, `go get example.com/.../db/v2@v2.0.0`, tag `auth/v0.4.0`.
3. `api`: bump `auth` to v0.4.0, bump `db` to /v2, tag `api/v1.0.0`.

Verify each step with `GOWORK=off go build ./...` from the relevant module.

**Goal.** Internalise the rule: lower modules tag first.

---

### Task 16 — CI matrix for workspace

Sketch a GitHub Actions workflow with two jobs:

1. `workspace-build`: runs `go test ./...` from the repo root.
2. `isolated-build`: a matrix over `[libfoo, app, cli]` running `GOWORK=off go build ./...` and `GOWORK=off go test ./...` per module.

Both must pass for the PR to merge.

**Solution sketch.**

```yaml
name: ci
on: [pull_request]
jobs:
  workspace-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.22' }
      - run: go test ./...

  isolated-build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        module: [libfoo, app, cli]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.22' }
      - run: GOWORK=off go build ./...
        working-directory: ${{ matrix.module }}
      - run: GOWORK=off go test ./...
        working-directory: ${{ matrix.module }}
```

**Goal.** Build the muscle for "two CIs, two views."

---

### Task 17 — Workspace-level vendor (Go 1.22+)

In any workspace from earlier tasks, run:

```bash
go work vendor
ls vendor
cat vendor/modules.txt | head
```

**Expected:** a top-level `vendor/` containing every dependency, plus a `modules.txt` manifest. Subsequent builds with `-mod=vendor` work at the workspace level:

```bash
go build -mod=vendor ./...
```

Disable workspace and try again:

```bash
GOWORK=off go build -mod=vendor ./libfoo
```

**Expected:** fails because `libfoo` does not have its own `vendor/`. The workspace vendor is workspace-scoped only.

**Goal.** Understand the trade-off of workspace-level vendoring.

---

### Task 18 — Detect and forbid workspace `replace` lines in CI

Add a CI step that fails when `go.work` contains any `replace` line:

```bash
if grep -qE '^[[:space:]]*replace' go.work; then
    echo "ERROR: workspace replace directives are forbidden in main"
    exit 1
fi
```

Test it:

```bash
go work edit -replace=github.com/foo/bar=github.com/me/bar@v1.0.0
sh ./check-no-replace.sh   # should fail
go work edit -dropreplace=github.com/foo/bar
sh ./check-no-replace.sh   # should pass
```

**Goal.** Enforce the policy "workspace replaces require explicit reviewer approval."

---

### Task 19 — Diagnose a "phantom build" mystery

Set up a workspace where `app` imports a function from `libfoo`. Verify `go run` works. Then:

1. `cd ~/work/lab1/app`
2. Delete `libfoo/foo.go`'s exported function (or rename it).
3. Run `GOWORK=off go build .` — it fails immediately.
4. Run `go build .` (workspace on) — it also fails, just with different filenames in the error.

Question: how can you tell which mode the build is using just from the error output? Look for clues:

- Workspace mode: errors reference paths like `../libfoo/foo.go`.
- Module mode: errors reference paths like `~/go/pkg/mod/example.com/lab1/libfoo@v0.0.0/foo.go` (read-only cache path).

**Goal.** Read a `go build` error and know whether the workspace is active, without checking `go env`.

---

### Task 20 — Two workspaces in the same repo

Create a layout with two distinct workspaces:

```
~/work/lab20/
├── frontend/
│   ├── go.work
│   ├── ui/
│   └── widgets/
└── backend/
    ├── go.work
    ├── api/
    └── auth/
```

Each `go.work` lists only the sibling modules in its directory. From `frontend/ui`, only `ui` and `widgets` are visible. From `backend/api`, only `api` and `auth`.

Verify:

```bash
cd ~/work/lab20/frontend/ui
go env GOWORK    # prints frontend/go.work

cd ~/work/lab20/backend/api
go env GOWORK    # prints backend/go.work
```

**Goal.** Practise the multi-workspace pattern that keeps team boundaries clean.

---

## Master Tasks

### Task 21 — Build a `release-cascade` script

Write a Bash script that takes a topological order file:

```yaml
# release-order.yaml
- db
- auth
- api
```

For each module in order:

1. Run `cd $module && GOWORK=off go build ./... && GOWORK=off go test ./...`.
2. Read the next version from `release-versions.yaml` (e.g., `db: v2.0.0`).
3. Tag `$module/$version`, push.
4. In the next module, run `go get example.com/.../$module@$version`.
5. Repeat.

**Goal.** Mechanise the topological release. Edge cases to handle: failed test → abort; uncommitted changes → abort; missing version in config → abort.

---

### Task 22 — Coverage across the workspace

Workspace-wide test coverage:

```bash
cd ~/work/lab1
go test -coverprofile=coverage.out -coverpkg=./... ./...
go tool cover -html=coverage.out
```

`-coverpkg=./...` includes coverage from cross-module packages. Without it, coverage is per-module-only.

**Goal.** A practical workspace-aware coverage workflow.

---

### Task 23 — Detect drift between `go.work` and `go.mod`

Write a script that flags drift:

```bash
go work sync
if ! git diff --exit-code '*/go.mod' >/dev/null; then
    echo "go.mod files are out of sync with go.work; run 'go work sync'"
    exit 1
fi
```

Add this as a CI step. The next time someone forgets to sync before pushing, CI fails loudly.

**Goal.** Make drift visible.

---

### Task 24 — Private monorepo bootstrap

A new contributor clones a private monorepo. Write the README's "first 60 seconds" section:

```
# First-time setup
git clone git@example.com:org/mono.git
cd mono
cp go.work.example go.work     # or: go work init ./module1 ./module2 ./module3
go work sync
go test ./...
```

Optional: a `make bootstrap` target that does all of the above.

**Goal.** Onboarding friction destroyed by a six-line README.

---

## Solutions and Hints

Most tasks have inline solutions. Where the task says "expected" or "success", that is the verification step. Two general hints:

- **Always check `go env GOWORK`** when something behaves surprisingly. Half of "weird" workspace bugs are "I am in a workspace I forgot about."
- **`GOWORK=off` is your X-ray vision.** If a build behaves differently with and without it, you know exactly what the workspace is doing.

These tasks intentionally avoid network operations; you can complete them offline. For network-aware tasks (real `go get`, real proxy interactions), see the topics on third-party packages and module proxies.
