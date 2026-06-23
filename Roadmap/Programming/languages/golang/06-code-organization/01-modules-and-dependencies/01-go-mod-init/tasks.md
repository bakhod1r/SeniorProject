# `go mod init` — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are at the end.

---

## Easy

### Task 1 — Hello module

Create a fresh directory `hello-mod`. Initialise it as a module with the path `example.com/hello`. Confirm:

- `go.mod` exists.
- It contains exactly one `module` line and one `go` line.
- `go env GOMOD` prints the absolute path of your `go.mod`.

**Goal.** Run the command, read the output.

---

### Task 2 — Failing intentionally

In a directory that already contains a `go.mod`, run `go mod init` again. Capture the error message verbatim. Then explain in one sentence why it fails.

**Goal.** Build muscle memory for the most common error.

---

### Task 3 — Picking a path

For each of the following project descriptions, propose a module path:

1. A personal CLI tool you will publish on your GitHub `alice`.
2. A team library at `gitlab.example.com` under group `acme/back-office`.
3. A throwaway script for a single-day investigation.
4. A library that you might host on multiple VCS hosts over its lifetime.

**Goal.** Internalise the conventions.

---

### Task 4 — One folder, one `go.mod`

Create a directory `try`. Inside, create a sub-folder `inner`. Run `go mod init example.com/try` in `try/`. Then run `go mod init example.com/try/inner` in `inner/`. Verify both succeed and confirm: how does the toolchain treat `inner` now? (Run `go env GOMOD` from each directory.)

**Goal.** Learn that nested modules are allowed and how to detect them.

---

### Task 5 — Local-only module

Create a module with the path `myscratch` (no dot). Confirm it works for `go run .` with a trivial `main.go`. Then attempt `go get myscratch` from a *different* module. Capture the error.

**Goal.** Understand the dot-rule's practical consequence.

---

## Medium

### Task 6 — Migrating a flat folder

Imagine you have this layout:

```
oldproj/
├── main.go        package main
└── store/
    └── store.go   package store
```

`main.go` imports `store` like this:

```go
import "oldproj/store"
```

Run `go mod init` to make this a real module, choosing a path. Observe what you must change in the imports to compile. Run `go build .` to verify.

**Goal.** Understand the relationship between module path and import path.

---

### Task 7 — Sub-folder package, real import

Initialise a module `example.com/calc`. Create a sub-folder `mathx` with a function `Add(a, b int) int`. Then write `cmd/calculator/main.go` that imports `example.com/calc/mathx` and prints `Add(2, 3)`.

**Goal.** Practise the canonical Go layout: `cmd/<binary>/main.go` + `<feature>/`.

---

### Task 8 — Bumping to v2

Initialise a module `example.com/lib`. Add a single function. Make a `git` repo, commit, and tag `v1.0.0`. Now you decide v2 needs a breaking API change. Walk through:

- Editing `go.mod`.
- Updating any internal imports.
- Tagging `v2.0.0`.

Confirm with `go list -m` that the module path is now `example.com/lib/v2`.

**Goal.** Master the major-version-bump procedure.

---

### Task 9 — Workspace setup

Create three directories: `core`, `cli`, and `web`. Each gets its own `go mod init` (paths: `example.com/core`, `example.com/cli`, `example.com/web`). Then create a parent `go.work` that includes all three using `go work init ./core ./cli ./web`.

Inside `cli`, import a function from `example.com/core` (which you must add to `core` first). Confirm the build works *without* having published `core` anywhere.

**Goal.** Understand workspaces by hands-on use.

---

### Task 10 — Vanity URL

Pretend you control `example.com/csvkit`. Set up a static HTML page (locally) at `csvkit/index.html` with the proper `go-import` meta tag pointing to a real GitHub repo. Confirm you can read it with `curl`. (You do not need to actually serve it on `example.com` — this is about the file format.)

**Goal.** Read the meta-tag protocol and produce a valid file.

---

## Hard

### Task 11 — Multi-module monorepo

Set up a repository:

```
mono/
├── go.work                       (workspace, optional)
├── service-api/
│   └── go.mod                    (module: example.com/mono/service-api)
├── service-worker/
│   └── go.mod                    (module: example.com/mono/service-worker)
└── shared/
    └── go.mod                    (module: example.com/mono/shared)
```

`service-api` and `service-worker` both depend on `shared`. Demonstrate:

1. Local development with `go.work` (no version tags).
2. Releasing `shared` at `v0.1.0`, then having `service-api` and `service-worker` depend on it via tagged version (without `go.work`).

**Goal.** Master the workspace-vs-tagged trade-off.

---

### Task 12 — Building a scaffolding CLI

Write a Go program that takes a directory and a module path, then:

1. Validates the module path using `golang.org/x/mod/module.CheckPath`.
2. Refuses if `go.mod` already exists.
3. Creates `go.mod` with `module` and `go` directives.
4. Creates `cmd/<n>/main.go` and `internal/<n>/<n>.go` skeletons (where `<n>` is derived from the module path's last component).

Run it. Confirm the produced project builds with `go build ./...`.

**Goal.** Practise the programmatic-init API.

---

### Task 13 — Converting a GOPATH repo

Find an open-source project that still uses GOPATH-style layout (no `go.mod`). Fork it. Migrate it to modules:

1. `go mod init <path>` in the project root.
2. `go mod tidy` and resolve any dependency errors.
3. `go build ./... && go test ./...`.
4. Commit `go.mod`, `go.sum`.

If you cannot find a real one, simulate one by deleting `go.mod` from a small modern project and reversing the migration.

**Goal.** Internalise the migration steps under realistic conditions.

---

### Task 14 — CI tidy-check

Set up a tiny Go project. Add a GitHub Actions workflow that:

1. Sets up Go using the version from `go.mod`.
2. Runs `go mod tidy`.
3. Fails the build if `git diff --exit-code go.mod go.sum` is non-empty.

Push a deliberate `import` of a new dependency *without* running `go mod tidy`. Confirm CI catches it.

**Goal.** Build the most important CI gate around modules.

---

### Task 15 — Reproducible build verification

Build the same Go binary twice in sequence, with `go clean -modcache` in between. Use `sha256sum` (or platform equivalent) to confirm both binaries are byte-identical.

If they differ, identify the source of non-determinism. Common culprits: build IDs, embedded timestamps, embedded git commit hashes via `-ldflags`.

**Goal.** Probe the limits of reproducibility.

---

## Bonus / Stretch

### Task 16 — Writing your own `go mod init`

Implement a tiny CLI that performs the same job as `go mod init` *without* shelling out to `go`. Use `golang.org/x/mod/modfile` to construct the file. Validate paths. Refuse on existing `go.mod`. Test against tricky inputs (uppercase, no dot, with `/v2` suffix without the major).

**Goal.** Reach the implementation level — understand by re-implementing.

---

### Task 17 — A `replace` for local fork

You depend on a popular library (e.g., `github.com/spf13/cobra`). Clone it locally to `/tmp/cobra-fork`. In your project's `go.mod`, add a `replace` directive pointing to the local path. Confirm the toolchain uses your local copy by adding a deliberate compile error to `cobra` and watching your project fail.

**Goal.** Understand `replace` as a development-time tool.

---

### Task 18 — The retraction dance

Tag a release of your module as `v0.2.0`. Realize it has a bug. Add a `retract v0.2.0` directive and tag `v0.2.1`. Confirm that consumers running `go get yourmodule@latest` skip `v0.2.0`.

**Goal.** Practise the retract workflow.

---

### Task 19 — Per-module CI in a multi-module repo

Set up a multi-module repo (like Task 11). Build CI that:

1. Detects which modules' files changed in a PR.
2. Runs `go test ./...` *only* in those modules.
3. Fails if any of the changed modules have failing tests.

**Goal.** Build CI that scales beyond `go test ./...`.

---

### Task 20 — Module path forensics

Given an unfamiliar Go binary built somewhere unknown, use `go version -m <binary>` to extract the module path and dependency list. Verify it against the binary's source repo.

**Goal.** Read modules via the runtime debug interface.

---

## Solutions (sketched)

### Solution 1
```bash
mkdir hello-mod && cd hello-mod
go mod init example.com/hello
cat go.mod         # two lines
go env GOMOD       # absolute path of go.mod
```

### Solution 2
```
go: ./go.mod already exists
```
Reason: `go mod init` refuses to overwrite. The check is the first thing the command does.

### Solution 3
1. `github.com/alice/<tool-name>`.
2. `gitlab.example.com/acme/back-office/<lib-name>`.
3. `scratch` — single-segment local-only is acceptable for throwaways.
4. A vanity path under a domain you control.

### Solution 4
Both `go mod init`s succeed. From `try/`, `GOMOD` points to `try/go.mod`. From `try/inner/`, it points to `try/inner/go.mod`. The two are independent modules.

### Solution 5
`go run .` works locally. `go get myscratch` from elsewhere fails:
```
go: malformed module path "myscratch": missing dot in first path element
```

### Solution 6
After `go mod init example.com/oldproj`, change `import "oldproj/store"` to `import "example.com/oldproj/store"`. Build succeeds.

### Solution 7
```
calc/
├── go.mod                   (module example.com/calc)
├── mathx/
│   └── mathx.go             (package mathx, func Add)
└── cmd/
    └── calculator/
        └── main.go          (imports example.com/calc/mathx)
```

### Solution 8
Edit `go.mod` to `module example.com/lib/v2`. Update internal imports. Tag `v2.0.0`. `go list -m` confirms.

### Solution 9
After `go work init`, in `cli`'s code: `import "example.com/core"`. Build succeeds because the workspace stitches modules together — no version tag, no proxy lookup.

### Solution 10
HTML file:
```html
<!DOCTYPE html>
<html><head>
<meta name="go-import" content="example.com/csvkit git https://github.com/alice/csvkit">
</head></html>
```
Verify with `curl localhost/csvkit/`.

### Solution 11
Phase 1: use `go.work`. Phase 2: tag `shared@v0.1.0`, then `service-api/go.mod` and `service-worker/go.mod` `require example.com/mono/shared v0.1.0`.

### Solution 12
Use `golang.org/x/mod/module.CheckPath` and `golang.org/x/mod/modfile`. Skeleton:
```go
import "golang.org/x/mod/modfile"
f := &modfile.File{}
f.AddModuleStmt(path)
f.AddGoStmt("1.22")
data, _ := f.Format()
os.WriteFile("go.mod", data, 0644)
```

### Solution 13
Project-specific. Common pitfalls: archived dependencies require forks via `replace`; vendored code may need to be deleted before `go mod tidy`.

### Solution 14
```yaml
- uses: actions/setup-go@v5
  with:
    go-version-file: go.mod
- run: |
    go mod tidy
    git diff --exit-code go.mod go.sum
```

### Solution 15
If the binary differs across runs, common causes:
- `runtime/debug.ReadBuildInfo` includes a build ID — strip with `-buildid=` ldflag.
- `-ldflags "-X main.commitHash=$(git rev-parse HEAD)"` differs across machines unless pinned.

### Solution 16
Use `module.CheckPath` for validation. Refuse with a clear error if `go.mod` exists. Use `modfile.File` to construct the output. Edge cases: empty path, non-ASCII, version-suffix mismatches.

### Solution 17
```
replace github.com/spf13/cobra => /tmp/cobra-fork
```
Local edits to `cobra-fork` affect builds.

### Solution 18
```
retract v0.2.0
```
in the latest `go.mod`. Tag `v0.2.1` *after* adding the line.

### Solution 19
A `git diff --name-only` against the merge-base, group by module root, then `go test ./...` per group.

### Solution 20
```bash
go version -m ./binary
```
Prints module path, version, and `require` list embedded in the binary.

---

## Checkpoints

After completing the easy tasks: you can confidently start any new Go project.
After completing the medium tasks: you can migrate, restructure, and version-bump real codebases.
After completing the hard tasks: you can build CI, scaffolding tools, and monorepo infrastructure that withstands a team.
After completing the bonus tasks: you understand the module system at the level of writing your own tooling against it.
