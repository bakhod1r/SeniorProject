# Package Import Rules — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Import Path Resolution Algorithm in Detail](#the-import-path-resolution-algorithm-in-detail)
3. [The `go/build` and `golang.org/x/tools/go/packages` APIs](#the-gobuild-and-golangorgxtoolsgopackages-apis)
4. [The Type-Checker's View of Imports](#the-type-checkers-view-of-imports)
5. [Dependency-Graph Walking with `go list -deps`](#dependency-graph-walking-with-go-list-deps)
6. [Init-Function Ordering: The Real Algorithm](#init-function-ordering-the-real-algorithm)
7. [Plugin Architecture: How Blank Imports Drive Registries](#plugin-architecture-how-blank-imports-drive-registries)
8. [The Compile Cache and Imports](#the-compile-cache-and-imports)
9. [Linker's Role (Dead-Code Elimination Across Imports)](#linkers-role-dead-code-elimination-across-imports)
10. [Programmatic Import Manipulation](#programmatic-import-manipulation)
11. [Cross-Build-Configuration Imports](#cross-build-configuration-imports)
12. [Edge Cases the Source Reveals](#edge-cases-the-source-reveals)
13. [Performance: Compile Time as a Function of Imports](#performance-compile-time-as-a-function-of-imports)
14. [Operational Playbook](#operational-playbook)
15. [Summary](#summary)

---

## Introduction

The professional level treats imports not as an editor convenience but as a contract between the compiler, the linker, the build cache, and the toolchain ecosystem. Every `import` statement is a directed edge in a dependency graph that the toolchain must resolve, hash, type-check, link, and (eventually) cache. The semantics of "import" therefore touch nine subsystems: lexer, parser, build-context evaluator, package loader, type checker, init-order analyser, code generator, linker, and module resolver.

This file is for engineers who maintain Go infrastructure, write static analysis or codegen tooling, run private module registries, debug build-time pathologies in monorepos, or design plugin systems that depend on init-time registration semantics.

After reading this you will:
- Trace an import path from text token to resolved package directory through the toolchain.
- Use `go/build` and `golang.org/x/tools/go/packages` to load, inspect, and rewrite import graphs programmatically.
- Reason about init order at the level the spec actually defines.
- Build registry-style plugin systems with confidence and audit blank imports for footguns.
- Predict when the compile cache will hit or miss based on import topology.
- Diagnose mysterious imports that resolve "to the wrong package" by reading the build configuration.

---

## The Import Path Resolution Algorithm in Detail

When the compiler encounters `import "foo/bar"`, the toolchain converts that *path* into a *directory on disk* before any source file is parsed. The lookup order is fixed and well-defined.

### The lookup order

1. **Standard library.** If the path is a stdlib path (`fmt`, `net/http`, `crypto/sha256`), it resolves to `$GOROOT/src/<path>`. The list of stdlib paths is hard-coded into the toolchain (see `go/build.IsLocalImport` and the stdlib package list in `go list std`).
2. **Vendor directory (if active).** If a `vendor/` directory exists at the module root *and* `-mod=vendor` is in effect (default in modules with `vendor/` since Go 1.14), the path is sought at `<module-root>/vendor/<import-path>`.
3. **Module cache.** Otherwise, the path is mapped to a module via the build list: the toolchain finds the longest-prefix module path that covers the import, then resolves to `$GOPATH/pkg/mod/<module>@<version>/<remainder>`.
4. **GOPATH (legacy).** If modules are off (`GO111MODULE=off`), the path resolves to `$GOPATH/src/<path>`. This is now rarely encountered.

The first match wins. There is no merging. There is no overlay across layers. A path that exists in vendor and in the module cache resolves to the vendor copy, full stop.

### Where the algorithm lives

The canonical implementation is split between `go/build` (legacy, GOPATH-aware) and `cmd/go/internal/modload` plus `cmd/go/internal/modindex` (modules-aware). When you call `go build`, the modules-aware path is taken; when you call `go/build.Import` directly, you get the legacy path unless you supply a `BuildContext` explicitly.

### Replace and exclude

`replace` directives in `go.mod` rewrite the resolution: `replace foo.com/x => ./local/x` causes the import path `foo.com/x` to resolve to `<module-root>/local/x` regardless of what the cache contains. `exclude` is narrower — it removes a specific *version* from MVS consideration but does not change path resolution.

### The single-package invariant

Two imports of the same path within a single build always resolve to the same directory. The toolchain enforces this; it is impossible for `package A` and `package B` in the same build to import "different versions" of `foo/bar` simultaneously. This is what `go.sum` and MVS are for.

---

## The `go/build` and `golang.org/x/tools/go/packages` APIs

The Go ecosystem exposes two APIs for loading package metadata programmatically. They occupy different layers of abstraction.

### `go/build` — the legacy, low-level API

```go
import "go/build"

ctx := build.Default
pkg, err := ctx.Import("net/http", "", build.FindOnly)
if err != nil { return err }
fmt.Println(pkg.Dir, pkg.GoFiles, pkg.Imports)
```

`build.Context` controls `GOOS`, `GOARCH`, `BuildTags`, `CgoEnabled`, and the file-system view (`OpenFile`, `ReadDir`). It does not understand modules natively. For module-aware loading from a `build.Context`, you must shell out to `go list` or use the higher-level `packages` API.

### `golang.org/x/tools/go/packages` — the modern, modules-aware API

```go
import "golang.org/x/tools/go/packages"

cfg := &packages.Config{
    Mode: packages.NeedName | packages.NeedFiles |
          packages.NeedImports | packages.NeedTypes |
          packages.NeedSyntax | packages.NeedTypesInfo,
}
pkgs, err := packages.Load(cfg, "./...")
```

`packages.Load` shells out to `go list -json` under the hood, ingests the JSON, and (when requested) parses the source and runs the type checker. Modes are bit flags that control how much work is done. Higher modes cost more.

`Mode` flags worth knowing:
- `NeedName` — import path and package name only.
- `NeedFiles` — file paths.
- `NeedImports` — import edges.
- `NeedTypes` — runs the type checker.
- `NeedSyntax` — parses source into `*ast.File`.
- `NeedTypesInfo` — populates `types.Info` (uses, defs, types of expressions).
- `NeedDeps` — load all transitive dependencies.

This is the API that `go vet`, `staticcheck`, `gopls`, and the rest of the modern tooling ecosystem builds on.

---

## The Type-Checker's View of Imports

Once the toolchain has produced ASTs for a package, the type checker (`go/types`) needs to resolve every cross-package identifier. Imports are how it does so.

### The `Importer` interface

```go
package types

type Importer interface {
    Import(path string) (*Package, error)
}
```

A type checker is configured with an `Importer`. When it encounters `pkg.Foo`, it asks the importer for the `*types.Package` corresponding to `pkg`'s import path. The importer is expected to return a fully type-checked package — recursively type-checked, transitively.

### Sources of importers

- `importer.Default()` — reads compiled `.a` archives (export data). Fast, but requires the package to have already been compiled.
- `importer.For("source", nil)` — type-checks from source. Slower but does not require pre-compilation.
- `golang.org/x/tools/go/packages` — provides its own importer that handles modules and build constraints correctly. This is what most modern tools use.

### Export data

Every compiled `.a` archive contains *export data*: a compact serialised form of the package's exported types. The type checker reads this data instead of re-parsing source for already-compiled dependencies. This is the same mechanism that makes incremental builds fast — and why every import you add is paid for once at compile time and once per type-checking pass downstream.

---

## Dependency-Graph Walking with `go list -deps`

The single most useful command for understanding what a program actually pulls in:

```
go list -deps ./...
```

It prints the transitive set of import paths your code reaches. Add `-json` for full structured output:

```
go list -deps -json ./...
```

### What it shows

For each package: its import path, files, direct imports, build tags, module, and whether it is in stdlib, vendor, or the module cache. The output is a stream of JSON objects, not an array — each is a `cmd/go/internal/load.PackagePublic` value.

### Common audit patterns

Find every non-stdlib import in a project:

```
go list -deps -f '{{if not .Standard}}{{.ImportPath}}{{end}}' ./...
```

Find all packages that import `database/sql`:

```
go list -f '{{.ImportPath}}{{"\n"}}{{range .Imports}}  {{.}}{{"\n"}}{{end}}' ./... \
  | grep -B1 'database/sql'
```

Compute the dependency-graph size:

```
go list -deps ./... | wc -l
```

A typical microservice produces 100–400 lines. A CLI that imports `kubernetes/client-go` produces 1500+. This number directly correlates with cold-build time.

### Module-level dependency graph

```
go mod graph
```

prints the edges of the *module* graph (one line per edge, `consumer requirer@version`). Contrast this with `go list -deps`, which prints the *package* graph. They are not the same — one module typically contains many packages, and you may import only a subset.

---

## Init-Function Ordering: The Real Algorithm

The Go spec defines a precise algorithm for initialisation. Most programmers know it as "init runs first" — the truth is more interesting.

### Within a single package

1. **Package-level variables** are initialised in *declaration order*, subject to dependencies. If `var x = f(y)` and `var y = 1` are in the same package, `y` is initialised before `x`, regardless of source order.
2. **`init` functions** run after all package-level variables of that package are initialised. There may be multiple `init` functions per package — they run in the order the *files* are presented to the compiler. The compiler presents files in alphabetical order by filename.

### Across packages

The init order across packages is determined by the *import dependency graph*:

1. Compute the topological order of the package graph.
2. For each package in topological order, initialise its variables, then run its `init` functions.
3. A package is initialised exactly once even if it is imported through multiple paths.

Effectively: depth-first, post-order traversal of the import DAG, with deterministic per-package ordering.

### What this guarantees

When `package main`'s `init` runs, every transitively imported package has finished initialising. Within a package, the `init` functions of file `aaa.go` precede those of `zzz.go`.

### What this does *not* guarantee

- The order of two `init` functions in *unrelated* packages is unspecified beyond "both before main."
- The order of init functions across files in the same package is alphabetical *by filename*, not by some logical grouping. Renaming a file can change init order.
- Goroutines started in `init` may run before `main` — but the language gives no scheduling guarantees about them.

### Reading the spec

The authoritative source is the "Package initialization" section of the Go language specification. The compiler's implementation lives in `cmd/compile/internal/pkginit`.

---

## Plugin Architecture: How Blank Imports Drive Registries

The blank import `import _ "path"` runs the imported package's init code *for its side effects* but does not bind any name. This is the canonical mechanism for plugin/driver registries.

### The registry pattern

A base package defines a registration function:

```go
// package sql
package sql

var drivers = map[string]Driver{}

func Register(name string, d Driver) {
    drivers[name] = d
}
```

Each implementation registers itself in its own `init`:

```go
// package sqlite
package sqlite

import "database/sql"

func init() {
    sql.Register("sqlite", &sqliteDriver{})
}
```

Consumers blank-import the implementation:

```go
import (
    "database/sql"
    _ "github.com/mattn/go-sqlite3"
)
```

The blank import causes `init` to run, which calls `sql.Register`, which makes the driver available by name. The consumer never refers to the implementation package directly.

### Why this matters

It cleanly separates the *interface* (database/sql) from the *implementations* (mysql, postgres, sqlite). The same pattern drives `image` codecs, `crypto/x509` root certificates, profiler initialisers in `net/http/pprof`, and most middleware ecosystems.

### Footguns

- **Order-dependence.** If two drivers register the same name, the last init wins — and "last" depends on alphabetical filename order, which is a fragile invariant.
- **Hidden dependencies.** `_ "path"` imports do not appear in identifier usage, so naive removal-of-unused-imports can silently break the program.
- **Cyclic init.** Registry packages cannot import implementations (cycle); implementations import the registry. Always one-way.

---

## The Compile Cache and Imports

The Go build cache lives at `$GOCACHE` (default `$HOME/Library/Caches/go-build` on macOS, `$HOME/.cache/go-build` on Linux). Its keying scheme is what makes incremental builds fast — and imports are part of every key.

### What the cache key includes

For each compilation unit, the cache key is a hash of:
- The Go toolchain version.
- The package's source files (content hashes).
- The build configuration (`GOOS`, `GOARCH`, build tags, cgo flags).
- The export-data hashes of every directly imported package.

That last point is critical: *changing an exported API in package A invalidates every package that imports A*. The cache propagates invalidation along the same edges as compilation.

### Why this matters for imports

- Adding an import never invalidates downstream caches *if* it does not change exported types.
- Changing a function signature in a widely imported package invalidates everything downstream.
- Reorganising a package into sub-packages can dramatically reduce cache invalidation surface.

### Inspecting the cache

```
go build -x ./... 2>&1 | grep -E 'compile|link'
```

The `-x` flag prints every command. Cached compilations are skipped; you can see directly how many packages are actually re-compiled.

---

## Linker's Role (Dead-Code Elimination Across Imports)

The Go linker performs *cross-package* dead-code elimination. An imported function that is never reachable from `main` is not included in the final binary.

### Mechanics

1. The linker constructs a reachability graph rooted at `main.main`, runtime entry points, and exported symbols (for `-buildmode=plugin`).
2. Symbols not reachable through this graph are dropped.
3. Type information for unused types may also be dropped (subject to reflection considerations — see below).

### What this means in practice

Importing a package with hundreds of functions is fine if you only use a few — the unused ones are gone after linking. This is the reason Go binaries are smaller than naive accounting would predict.

### Best-effort and reflection

Reflection (`reflect.TypeOf`, `reflect.New`) prevents the linker from concluding a type is unreachable, because the type might be looked up by name at runtime. Heavy reflection users (encoding libraries, ORMs) tend to have larger binaries because the linker conservatively keeps everything. The `-ldflags="-s -w"` flag strips the symbol and DWARF tables but does not change reachability.

### Init functions are always kept

A package's `init` is always reachable if the package is imported. The linker treats init as a root. This is why blank imports work: the registration side-effect cannot be eliminated.

---

## Programmatic Import Manipulation

Tools that rewrite imports (goimports, gopls organize-imports, codemod tools) operate on the AST, not on text.

### `go/ast` and `go/parser`

```go
import (
    "go/parser"
    "go/token"
)

fset := token.NewFileSet()
file, err := parser.ParseFile(fset, "main.go", nil, parser.ImportsOnly)
```

`parser.ImportsOnly` is a fast mode that stops after the import declaration. Use it when you only care about imports.

### `golang.org/x/tools/go/ast/astutil`

The standard tool for editing imports:

```go
import "golang.org/x/tools/go/ast/astutil"

astutil.AddImport(fset, file, "fmt")
astutil.AddNamedImport(fset, file, "myalias", "long/path/here")
astutil.DeleteImport(fset, file, "fmt")
```

`astutil` handles the bookkeeping correctly: maintaining the import block, sort order, group separators (stdlib vs third-party), and named imports.

### `goimports` itself

`goimports` (in `golang.org/x/tools/cmd/goimports`) goes one step further. It scans the file for *unresolved identifiers*, looks for matching package paths in the GOPATH/module-cache index, and adds the appropriate imports. This is the index that `gopls` also uses for autocomplete.

### Re-printing

After AST modification, write back with `go/printer` or `go/format`:

```go
import "go/format"

var buf bytes.Buffer
if err := format.Node(&buf, fset, file); err != nil { return err }
return os.WriteFile(path, buf.Bytes(), 0644)
```

`format.Node` produces canonical Go formatting — equivalent to running `gofmt`.

---

## Cross-Build-Configuration Imports

Imports are not unconditional. Build tags, OS/arch suffixes, and cgo gates determine *which files* contribute imports.

### File-level build constraints

```go
//go:build linux && amd64

package foo

import "syscall"
```

This file's import of `syscall` is only compiled into Linux/amd64 builds. On Windows, the file is silently skipped, and that import is *not* part of the package on Windows.

### Filename-based constraints

`foo_linux.go`, `foo_amd64.go`, `foo_linux_amd64.go` are auto-tagged by suffix. `foo_test.go` is for tests. These are recognised by `go/build.MatchFile`.

### Cgo

`import "C"` is special: it triggers the cgo preprocessor. The pseudo-package "C" exposes the C namespace described in the preceding `// #include` comment. Cgo files are only compiled when `CGO_ENABLED=1`; otherwise they are excluded as if by build tag.

### Implications for tools

`golang.org/x/tools/go/packages` evaluates build tags correctly when you supply `Env` and `BuildFlags`. `go/build` requires you to populate `Context.BuildTags` and `Context.GOOS`/`GOARCH` manually. Forgetting this is a common source of "but it compiles for me" tool bugs.

---

## Edge Cases the Source Reveals

A close reading of the toolchain reveals corners most users never hit:

- **Underscore-prefixed directories are skipped.** `_internal/`, `_vendor/` — anything starting with `_` is ignored by the package loader. This is a convention for "scratch" code that you do not want compiled.
- **`testdata/` directories are skipped.** Reserved for test fixtures. Imports from inside `testdata/` are not resolved.
- **Dot-prefixed directories are skipped.** `.hidden/`, `.git/`, etc.
- **Self-imports are forbidden.** A package cannot import itself, even transitively. The compiler rejects cycles.
- **Imports under `internal/` enforce the visibility rule.** A package at path `a/b/internal/c` is importable only from `a/b/...`. Violating this is a compile error.
- **Multiple toolchain versions can resolve the same path differently.** If a developer machine runs `go1.21` and CI runs `go1.22`, the same import path may have different stdlib behaviour (e.g., new stdlib symbols available, MVS algorithm tweaks). Pin the toolchain via `toolchain` directive.
- **Vendor takes precedence even when stale.** A vendored dependency that is older than what `go.mod` requires is still used in `-mod=vendor`. The discrepancy is a common source of "but go.sum says X" confusion.
- **Blank imports in tests do not transfer to non-test builds.** `import _ "..."` in a `_test.go` file only registers during `go test`, not `go build`.
- **Aliased imports do not change resolution.** `import f "fmt"` resolves the same as `import "fmt"`; the alias is purely a local-scope rename.

These edges are documented (sometimes obliquely) in the "Go command" reference and the spec, but the source of truth is the toolchain code.

---

## Performance: Compile Time as a Function of Imports

The cold-cache compile time of a Go program scales roughly linearly with the *transitive* number of packages imported, with constants determined by per-package cost.

### The empirical relationship

```
cold-compile-time ≈ Σ (parse + type-check + codegen) per package
                  + linker pass over union of object files
```

Per-package cost ranges from a few milliseconds (small leaf package) to hundreds of milliseconds (large package with cgo or heavy generics).

### Profiling

```
go build -x ./... 2>&1 | wc -l
```

approximates the number of compilation actions. For finer detail:

```
go build -toolexec='time -v' ./...
```

invokes `time` for every compilation, surfacing per-package wall clock and memory.

```
go build -gcflags='-m' ./...
```

prints inlining and escape-analysis decisions, which dominate generation time for some packages.

### Reducing import count

- **Split monoliths.** A package that does five things forces every consumer to compile all five.
- **Avoid leaky imports in interfaces.** Defining an interface in package A that uses types from package B forces every consumer of A to also resolve B.
- **Use interface decoupling for plugins.** The `database/sql` pattern: small interface package, registry, separate implementations. Consumers only import what they use.
- **Audit `go list -deps`.** If a util package transitively pulls 200 dependencies, *something* is wrong — likely a stray import that an alternative path could avoid.

### Generics caveat

A package that defines generic functions costs more to compile per *instantiation* in downstream packages. The compiler must specialise the generic code per type. Heavy generic libraries can therefore make consumers slower without the consumer importing more packages.

---

## Operational Playbook

A condensed reference for common operational scenarios.

| Scenario | Recipe |
|----------|--------|
| Audit a project's dependency surface | `go list -deps -f '{{if not .Standard}}{{.ImportPath}}{{end}}' ./... \| sort -u` |
| Find the longest import chain | `go mod graph \| awk '{print $2}' \| sort -u \| wc -l` |
| Identify slowest-compiling packages | `go build -toolexec='/usr/bin/time -l' ./...` (macOS) or `-v` on GNU |
| Detect unused imports across a repo | `go vet ./...` (catches the common cases); `staticcheck -checks=U1000` |
| Replace a dependency for local development | `replace mod.example/x => ../local/x` in `go.mod` |
| Inspect what is actually compiled | `go build -x -a ./... 2>&1 \| grep '^compile'` |
| Trace a single import resolution | `go list -m -json all \| jq 'select(.Path=="<path>")'` |
| Programmatically add an import | `astutil.AddImport(fset, file, "<path>")` then `format.Node` |
| Detect blank imports (audit registries) | `grep -RnE 'import\s+_\s+"' --include='*.go'` |
| Force re-evaluation of build constraints | `go build -tags=customtag ./...` |
| Vendor a dependency | `go mod vendor` (creates `vendor/` and `vendor/modules.txt`) |
| Verify cache key sensitivity | Modify a comment in package A; rebuild — A and consumers should *not* re-compile (export data unchanged) |
| Force a clean re-build | `go clean -cache && go build ./...` |
| Inspect linker dead-code stats | `go build -ldflags='-v' ./...` (verbose linker output) |
| Identify cgo-driven cost | `CGO_ENABLED=0 go build ./... && time` then compare with cgo on |

---

## Summary

`import` is the surface; underneath, every import statement is a directed edge processed by nine subsystems. The professional engineer's view of imports includes path resolution (stdlib → vendor → cache → GOPATH), the `go/build` and `packages` APIs that load this graph programmatically, the `Importer` interface that drives type-checking, the `init` ordering algorithm that the spec actually defines, the compile-cache key that makes incremental builds fast, the linker's dead-code elimination that keeps binaries small, the AST utilities that let tools rewrite imports correctly, and the build-configuration system that makes imports conditional on OS, architecture, and cgo state.

Master these layers and you can predict — without measurement — why a build is slow, why a registry-based plugin fails to load, why an import resolves to the wrong copy, and why your binary is twice as large as it should be. The simplicity of the `import` keyword is, as elsewhere in Go, a result of careful design that pushes the complexity into well-bounded subsystems. Knowing those boundaries is the senior insight.
