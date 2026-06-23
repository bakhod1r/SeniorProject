# Project Layout — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [How `go build` Discovers Packages](#how-go-build-discovers-packages)
3. [Module Path → Directory Mapping](#module-path--directory-mapping)
4. [The `internal/` Rule, Implemented](#the-internal-rule-implemented)
5. [`vendor/` and Its Effects on Layout](#vendor-and-its-effects-on-layout)
6. [Build Tags and Conditional Files](#build-tags-and-conditional-files)
7. [How `go list` Walks the Tree](#how-go-list-walks-the-tree)
8. [`gopls` and Layout-Aware Tooling](#gopls-and-layout-aware-tooling)
9. [Workspaces (`go.work`) Under the Hood](#workspaces-gowork-under-the-hood)
10. [Edge Cases the Toolchain Source Reveals](#edge-cases-the-toolchain-source-reveals)
11. [Operational Implications](#operational-implications)
12. [Summary](#summary)

---

## Introduction

The professional-level treatment of project layout is not about *choosing* a layout — it is about *understanding why the layout works*. Why does `go build ./...` skip directories starting with `.` or `_`? How does the toolchain decide that `internal/` blocks an import? What exactly does `vendor/` do to the package resolver? When `gopls` opens a multi-module workspace, what does it index and in what order?

The answers live in the Go toolchain source, primarily under `cmd/go/internal/modload/`, `cmd/go/internal/load/`, `cmd/go/internal/work/`, and `golang.org/x/mod/module`. This file traces the relevant rules and shows where to look in the source when behaviour surprises you.

After reading this you will:
- Predict which files `go build` will compile for any given package and target.
- Read a stack trace from `cmd/go` and connect it to a layout decision.
- Reason about `vendor/` mode vs module-cache mode at the level of file lookups.
- Use build tags to express layout that depends on platform or feature flags.
- Diagnose why `gopls` is slow or why an import fails to resolve.

---

## How `go build` Discovers Packages

`go build pkg` follows a deterministic, well-documented pipeline. The high-level flow:

1. **Parse the build target.** Each argument is a package pattern: a relative directory (`./cmd/server`), an absolute import path (`example.com/myapp/cmd/server`), or a wildcard (`./...`).
2. **Resolve to package directories.** The toolchain walks the file tree under the matched roots and produces the set of directories that contain `.go` files.
3. **For each directory, read the files.** It collects all `.go`, `.s`, `.c` files, parses each for its `package` clause and import list, and applies build tag and filename suffix rules to filter out files that do not apply to the current build.
4. **Compute the dependency closure.** For each imported path, repeat (recursively) the resolution step.
5. **Verify import constraints.** This is where `internal/`, `vendor/`, and module path rules are checked.
6. **Compile.** Each package is compiled to an object; the linker combines them.

The implementation is in `cmd/go/internal/load/pkg.go` and `cmd/go/internal/modload/load.go`.

### Filename suffix filters

The file collector applies filters based on filename:

- `_test.go` files are included only when running `go test`.
- Files with OS suffixes (`_linux.go`, `_darwin.go`, `_windows.go`) are included only on the matching `GOOS`.
- Files with arch suffixes (`_amd64.go`, `_arm64.go`) are included only on the matching `GOARCH`.
- Files with combined suffixes (`_linux_amd64.go`) require both to match.
- Files starting with `.` or `_` are *ignored*. This is why you cannot have a file named `_main.go` in your project.
- Files in directories starting with `.`, `_`, or named `testdata` are ignored.

The full rule set is in `cmd/go/internal/imports/build.go`. A file's eligibility is the AND of: filename suffix matches the target, filename does not start with `.` or `_`, the file is in an eligible directory, and any `//go:build` directive evaluates to true for the build context.

### The `testdata/` exception

Any directory named `testdata/` (anywhere in the tree) is excluded from package discovery. This is why test fixtures live there:

```
internal/store/
├── store.go
├── store_test.go
└── testdata/
    ├── input.json
    └── golden.txt
```

`testdata/` is not a Go package, no matter what `.go` files lurk inside (and they should not). The exclusion rule is hard-coded in `cmd/go/internal/load/pkg.go`.

---

## Module Path → Directory Mapping

Go's import-path-to-directory mapping has two phases.

### Phase 1: which module owns this import?

Given an import like `example.com/myapp/internal/store`, the toolchain answers: which module on disk does this resolve to?

1. Read the `module` directive of the current `go.mod`. If the import path has that module's path as a prefix, the package lives inside the current module.
2. Otherwise, read the `require` directives. Match the longest prefix among them.
3. The matched module's source is in the module cache: `$GOPATH/pkg/mod/<module-path>@<version>/`.
4. If `vendor/` mode is active and the module appears in `vendor/modules.txt`, source is in `vendor/<module-path>/` instead.

The "longest prefix" rule is what makes `example.com/foo/bar/baz` resolve correctly when both `example.com/foo` and `example.com/foo/bar` are `require`d.

### Phase 2: which directory inside the module?

Once the owning module is identified, the rest of the import path is a directory under the module root. So `example.com/myapp/internal/store` becomes `<myapp-root>/internal/store/`. This is the part that makes Go's layout transparent: the file system is the import graph.

The mapping has zero ambiguity. There is no `mod.rs`, no `__init__.py`, no module manifest beyond `go.mod`. If a directory exists with `.go` files in it, it is a package; if not, the import fails.

### Case sensitivity and path encoding

Module paths in the cache are case-encoded: uppercase letters are written as `!` plus the lowercase letter. So `github.com/Masterminds/semver` lives at `pkg/mod/github.com/!masterminds/semver@vX.Y.Z/`. This avoids collisions on case-insensitive filesystems (macOS HFS+, Windows NTFS by default).

Inside your own module, directories are interpreted exactly as they appear on disk. `internal/Auth` and `internal/auth` are different directories, and on a case-insensitive filesystem `go build` may be inconsistent. Senior layouts always use lowercase directory names.

---

## The `internal/` Rule, Implemented

The `internal/` rule is implemented in `cmd/go/internal/load/pkg.go`, function `disallowInternal`. The check is:

> A package whose import path contains the element `internal` may be imported only by packages whose import path is rooted at the parent of that `internal` element.

Concretely: an import of `a/b/c/internal/d/e/f` is allowed only when the importer's path begins with `a/b/c`. Otherwise the build fails:

```
package example.com/myapp/internal/store: cannot use package outside ".../myapp"
```

The rule applies to the *importer's* path, not its file location. A test file in `cmd/server/main_test.go` is at path `example.com/myapp/cmd/server`, which is a descendant of `example.com/myapp`, so it can import `internal/store`. A test file inside an external module cannot.

### Multiple `internal/` segments

The rule applies to *any* `internal` element in the import path:

```
example.com/myapp/internal/billing/internal/store
```

Here, `store` has two `internal/` ancestors. The check applies to *both*: the importer must be a descendant of `example.com/myapp` (because of the first `internal/`) *and* a descendant of `example.com/myapp/internal/billing` (because of the second). The intersection is "anything under `myapp/internal/billing`."

### `internal/` and tests

`go test ./...` includes `_test.go` files that may live outside the package:

```
internal/store/store.go         (package store)
internal/store/store_test.go    (package store)         ← whitebox
internal/store/store_ext_test.go (package store_test)   ← blackbox
```

Both test packages have the same import path resolution as `store`, so they can import `internal/...` packages without restriction. External test packages (`package store_test`) are allowed to import `internal/store` because the test binary is built as if it were inside the module.

### `internal/` and `vendor/`

When a build is in `vendor/` mode, the rules still apply: a vendored module under `vendor/example.com/myapp/internal/...` is reachable only by code rooted at `example.com/myapp`. The vendoring layout preserves the `internal/` semantics.

---

## `vendor/` and Its Effects on Layout

A `vendor/` directory at the module root tells `go build` to use vendored sources instead of the module cache. The toolchain enters vendor mode when:

1. A directory named `vendor/` exists at the module root, *and*
2. The `go` directive in `go.mod` is 1.14 or higher (or `-mod=vendor` is passed explicitly).

Vendor mode is documented at `go.dev/ref/mod#vendoring`.

### What `go mod vendor` produces

Running `go mod vendor` produces:

```
vendor/
├── modules.txt              ← inventory of vendored modules and the packages they contribute
├── github.com/dep1/lib1/    ← copies of imported packages from each dep
│   └── ...
└── golang.org/x/sys/        ← (only the packages your build actually uses)
```

`modules.txt` is the manifest. Each line names a module and version, followed by the import paths that module contributes:

```
# github.com/dep1/lib1 v1.5.0
## explicit
github.com/dep1/lib1
github.com/dep1/lib1/sub
```

The toolchain consults `modules.txt` first. If an import is missing from it but appears in `go.mod`, the build fails with "inconsistent vendoring." This forces vendor and module to agree.

### Effects on layout

- The repo grows by megabytes (sometimes hundreds). Decide whether to commit `vendor/` based on your build environment's network reliability.
- `go build` skips network access entirely when `vendor/` is present. This is the main reason organizations vendor: reproducibility in offline or air-gapped builds.
- The internal `internal/` rule still applies *within* vendored modules. A vendored `github.com/foo/bar/internal/baz` is reachable only by code rooted at `github.com/foo/bar`. This means most vendored `internal/` packages are unusable to your code, exactly as intended.

### When to vendor

- Air-gapped CI/CD pipelines.
- Industries with strict supply-chain controls (defense, finance, regulated healthcare).
- Releases where you must guarantee the exact bytes that built a binary, even if `proxy.golang.org` disappears.

For most modern Go projects, vendoring is unnecessary. The module proxy + checksum database give comparable reproducibility without bloating the repo.

---

## Build Tags and Conditional Files

A `//go:build` directive at the top of a file makes its inclusion conditional:

```go
//go:build linux && amd64

package fs

func native() { /* Linux amd64 only */ }
```

Build tags interact with layout in important ways.

### File suffixes are sugar

`fs_linux.go` is equivalent to a file with `//go:build linux`. The compiler treats them identically. The suffix form is older; the `//go:build` form is preferred since Go 1.17.

### Tags can split a feature across files

A package with platform-specific implementations:

```
internal/fs/
├── fs.go             (interface and platform-agnostic)
├── fs_linux.go
├── fs_darwin.go
└── fs_windows.go
```

`go build` for `linux/amd64` compiles `fs.go` and `fs_linux.go`. The other files are skipped silently. Each file declares the same `package fs`; the union of compiled files forms the package's contents on that target.

### Tags for optional features

```go
//go:build experimental

package metrics

func enableExperimentalSampler() { ... }
```

`go build -tags experimental ./...` includes the file; without the tag, it is skipped. Use this for features under feature flag, debug instrumentation, or expensive optional checks.

### Tags and layout: the integration tests pattern

```
internal/store/
├── store.go
├── store_test.go            (unit tests)
└── store_integration_test.go
```

`store_integration_test.go`:

```go
//go:build integration

package store_test

func TestAgainstRealPostgres(t *testing.T) { /* uses a real DB */ }
```

`go test ./...` skips the integration test. `go test -tags integration ./...` includes it. CI runs unit tests on every PR and integration tests on a schedule.

### The `tools.go` convention (and why it is dead)

Pre-1.16, projects used a `tools.go` file with `//go:build tools` to record tool dependencies in `go.mod`. Since 1.16, `go install pkg@version` installs tools without affecting `go.mod`. Newer projects do not need `tools.go`; if you see one, it is a relic.

---

## How `go list` Walks the Tree

`go list ./...` is the most useful tool for understanding what packages your layout produces. It is also a window into the toolchain's view of your code.

### `go list -json ./internal/store`

```json
{
    "Dir": "/path/to/myapp/internal/store",
    "ImportPath": "example.com/myapp/internal/store",
    "Name": "store",
    "GoFiles": ["pg.go", "store.go"],
    "TestGoFiles": ["store_test.go"],
    "Imports": ["context", "database/sql", "..."],
    "Deps": ["context", "database/sql", "errors", "..."],
    "Module": {"Path": "example.com/myapp", "Main": true}
}
```

Every field is computed from the layout: `Dir` from the file system, `ImportPath` from `Dir` minus the module root plus the module path, `Name` from the `package` clause, `Imports` from each file's import list filtered by build tags, `Deps` from a transitive walk.

### `go list -deps ./...`

Lists every package transitively imported by anything in your tree. A long output is a big binary; a short output is a focused one. Compare two services to see where the dependency growth is.

### `go list -m all`

Lists every module in your build, including transitive ones. The number of lines is a rough proxy for your supply-chain surface. If it doubles after a single `go get`, ask why.

### Build context for `go list`

`go list` respects build tags and OS/arch:

```bash
GOOS=linux GOARCH=arm64 go list ./...
```

Lists packages as they would compile for `linux/arm64`. A platform-specific layout (`fs_linux.go`) produces different `GoFiles` per target.

---

## `gopls` and Layout-Aware Tooling

`gopls` is the language server most editors use for Go. Its performance and correctness depend on layout.

### How `gopls` indexes a workspace

On startup, `gopls`:

1. Locates the nearest `go.mod` (or `go.work` if present).
2. Loads the module's package set via `golang.org/x/tools/go/packages`.
3. Type-checks every package, building an in-memory representation.
4. Watches the file system for changes and re-checks affected packages.

The cost is roughly linear in the number of packages and the number of types. Large monorepos (5,000+ packages) can take tens of seconds to fully index.

### Workspaces help, modules help more

A `go.work` workspace tells `gopls` to load multiple modules at once. Each module is indexed independently. A change in one does not require re-checking the others. This is why splitting a monolith into modules speeds up the editor as well as the build.

### `gopls rename` and `gopls organizeImports`

These operations rely on the import graph. `gopls rename` updates every importer when you move or rename a symbol. The tool needs the full graph in memory; a flat layout with one giant package is harder for `gopls` than the same code split into focused packages.

### When `gopls` lies

If `gopls` reports an import error but `go build` succeeds (or vice versa), the cause is almost always:
- Stale `go.mod` (run `go mod tidy`).
- Outdated `gopls` cache (restart the language server).
- A `//go:build` tag that affects loading (set the build environment in the editor).

These are layout-adjacent issues; they reveal that `gopls` and `go build` use the same rules but maintain separate caches.

---

## Workspaces (`go.work`) Under the Hood

A workspace stitches multiple modules into a single build context. Documented at `go.dev/ref/mod#workspaces`.

### `go.work` syntax

```
go 1.22

use (
    ./service-a
    ./service-b
    ./shared
)
```

The `use` directives list paths to modules participating in the workspace. The toolchain treats imports across these modules as if all the modules were available at their on-disk paths, ignoring `require` versions.

### How the toolchain resolves imports

When the workspace mode is active:

1. Each `use` path is scanned for its `go.mod`.
2. The union of modules is the workspace's logical module set.
3. An import that resolves to a workspace module uses the on-disk source, not the cache.
4. `internal/` rules still apply *between* workspace modules. A sibling module cannot import another's `internal/`.

This is the magic that makes monorepo refactors atomic across modules. Edit `shared/types.go`, save, and `service-a/main.go` sees the new code on the next build — no `go get` needed.

### `go.work.sum`

The workspace can require modules that are *not* in any `use` module's `go.mod`. Those go in `go.work.sum`. In practice, you rarely touch this file; the toolchain manages it.

### Workspace mode and `vendor/`

The two are mutually exclusive. A workspace cannot use vendored sources. If you need both reproducibility (vendor) and atomic refactors (workspace), you have to choose: refactor with the workspace, then re-vendor before release.

### When workspaces help and when they hurt

Help: multi-module monorepo, especially when a refactor crosses module boundaries.

Hurt: when committed `go.work` files affect production builds. CI must `unset GOFLAGS` and explicitly enter each module's directory to build it without workspace influence. Otherwise you risk shipping code that diverged from `go.mod`.

The standard advice: commit `go.work` for development, but ensure CI builds without it. Some teams use `go.work.sum` exclusion and a `.gitignore` line for `go.work` to keep it strictly local.

---

## Edge Cases the Toolchain Source Reveals

Reading `cmd/go/internal/load/pkg.go` reveals corner cases not always documented:

### `_` and `.` directories

A directory whose name starts with `_` or `.` is invisible to `go build ./...`. Common uses:
- `_examples/` — sample code that should not be compiled.
- `_legacy/` — old code preserved for reference.
- `.git/`, `.idea/` — tool directories.

This is a pure layout convenience. Putting a file in `_old/main.go` excludes it from every build without deleting it.

### `cmd/<bin>/` is not magic

The toolchain does not know about `cmd/`. A `package main` directory anywhere in the tree produces a binary. The `cmd/` convention is purely a convention. You can verify this:

```bash
mkdir -p tools/checker
cat > tools/checker/main.go <<EOF
package main

func main() {}
EOF
go build ./tools/checker   # works fine; produces a binary
```

The `cmd/` placement is for human readers, not the toolchain.

### Multiple `main` packages in the same directory

Forbidden:

```
cmd/server/
├── main.go      (package main, func main())
└── admin.go     (package main, func main())
```

Two `func main()` declarations in one package: compile error. Two `main` packages in different directories: fine (they are different packages).

### A directory with no `.go` files

Not a package. `go build ./internal/empty/` fails with "no Go files in /path/to/empty." This is the rule that lets you have `configs/`, `scripts/`, `testdata/`, `assets/` next to Go code without confusing the build.

### Cgo and assembly

If a package contains `.c` or `.s` files, the cgo machinery kicks in and the file set expands. Layout-wise, `.c` and `.s` files live next to `.go` files in the same package directory; there is no separate `c/` folder.

---

## Operational Implications

Layout has effects you only notice in operations.

### Container image size

Each binary in `cmd/<bin>/` is its own container image. A multi-binary repo can produce a small image per binary by building only that one:

```dockerfile
FROM golang:1.22 AS build
WORKDIR /src
COPY . .
RUN go build -o /out/server ./cmd/server

FROM gcr.io/distroless/static
COPY --from=build /out/server /server
ENTRYPOINT ["/server"]
```

Each binary's image is sized to its own dependencies, not the union of every binary in the repo.

### CI cache behaviour

GitHub Actions and similar tools cache `$GOMODCACHE` keyed on `go.sum`. A monorepo with many `go.mod` files (multi-module) needs separate caches per module — otherwise updates in one module invalidate the cache for all. Multi-module monorepos that share one cache often see worse cache hit rates than well-managed polyrepos.

### `go vet`, `go test`, `golangci-lint` scoping

All three accept package patterns. `golangci-lint run ./internal/billing/...` lints just billing. CI can split lint runs across teams; each team's CI step lints its own subtree. Layout aligned with team ownership makes this painless.

### Diagnostics and traces

A panic stack trace shows package paths: `example.com/myapp/internal/store.(*PG).GetUser`. A consistent layout makes the path readable. A messy layout (`internal/util/dbhelpers/dbutil.GetUser`) makes debugging from a stack trace harder.

---

## Summary

- `go build` discovers packages by walking the file system, filtering by name and build tag, then verifying import constraints.
- The module path plus the relative directory equals the import path. There is no separate manifest.
- The `internal/` rule is enforced in `cmd/go/internal/load/pkg.go`'s `disallowInternal` function. It applies to importer's path, not file location.
- `vendor/` mode is opt-in via the directory's existence and the `go` directive. It preserves `internal/` semantics within vendored modules.
- Build tags (`//go:build`) and filename suffixes are equivalent ways to make a file conditional. They allow platform-specific layout within a single package.
- `go list` is the toolchain's view of your layout. Use it to verify what `go build` will see.
- `gopls` indexes per-module; workspaces speed up editing by partitioning the index.
- `go.work` makes cross-module refactors atomic but must not influence production builds.
- Directories starting with `_` or `.`, plus `testdata/`, are invisible to package discovery — useful for keeping non-source content next to source.
- Multi-binary layout produces multi-image container builds, finer-grained caches, and finer-grained lint scopes — a layout decision with operational consequences.
