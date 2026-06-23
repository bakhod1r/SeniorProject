# Internal Packages — Professional Level

## Table of Contents
1. [Introduction](#introduction)
2. [Where the Rule Lives in `cmd/go`](#where-the-rule-lives-in-cmdgo)
3. [The "Is This Import Allowed?" Algorithm](#the-is-this-import-allowed-algorithm)
4. [Module-Path Resolution and the Boundary](#module-path-resolution-and-the-boundary)
5. [Interaction With the Build Cache and Package Loading](#interaction-with-the-build-cache-and-package-loading)
6. [Historical Evolution of the Rule](#historical-evolution-of-the-rule)
7. [Edge Cases the Toolchain Source Reveals](#edge-cases-the-toolchain-source-reveals)
8. [Diagnosing Forbidden-Import Errors at Scale](#diagnosing-forbidden-import-errors-at-scale)
9. [Operational Notes](#operational-notes)
10. [Summary](#summary)

---

## Introduction

The professional-level treatment of `internal/` is not about *using* it — it is about *understanding the toolchain that enforces it*. At infrastructure scale, every `go build` decision involving an internal package is a check implemented in `cmd/go`, executed many times per build, on a corpus of import paths whose shape you do not control directly.

This file is for engineers who maintain large Go monorepos, build their own analysis tools on top of `go list`, port the rule into custom build systems (Bazel, Buck2), or diagnose forbidden-import errors that look puzzling at first glance.

After reading this you will:
- Locate the canonical implementation of the rule in the `cmd/go` source
- Restate the "is this import allowed" algorithm as ten lines of pseudo-code
- Predict how the rule interacts with module-path resolution, vendoring, and `replace`
- Trace the rule's evolution from Go 1.4 (experimental) to current Go
- Diagnose the half-dozen edge cases where the rule appears to misbehave
- Decide what behaviour your own tooling should mirror

The rule itself is small. The implementation is small too. The corner cases — and the consequences for adjacent tooling — are where the engineering content lives.

---

## Where the Rule Lives in `cmd/go`

The `internal/` enforcement is implemented in the standard Go toolchain, in the `cmd/go` source tree. The relevant logic is in two places:

1. **`cmd/go/internal/load`** — when a package is loaded, its imports are resolved and each is checked against the rule.
2. **`cmd/go/internal/modload`** — when a module's package graph is computed, the rule is applied at the module-path level.

The function name to remember is conceptually "`disallowInternal`" (the actual name has shifted across releases). It is invoked once per import edge during package loading. The signature in spirit:

```go
// disallowInternal reports an error for any imports of internal packages
// that are not from a package or test in a directory rooted at the parent
// of the "internal" directory.
func disallowInternal(srcDir string, importerPath string, importerIsCmd bool,
    importedPkg *Package, position token.Position) *Package
```

The toolchain calls this for every import in every package it loads. If the import is internal *and* the importer is not under the parent of the `internal/` element, the toolchain attaches an error to the importer and continues loading (so multiple errors can be reported in one build).

Browsing `cmd/go/internal/load/pkg.go` (search for "disallowInternal" or "internal package") is the fastest way to read the actual implementation. It is a few dozen lines of straightforward path manipulation; there is no hidden complexity.

---

## The "Is This Import Allowed?" Algorithm

In words and then in pseudo-code.

### In words

Given:
- `imported`: the import path of the package being imported (e.g. `example.com/lib/internal/x/y`).
- `importer`: the import path of the package doing the importing (e.g. `example.com/lib/cmd/foo`).

Decide whether the import is allowed:

1. Find the *last* occurrence of `internal` as a path *element* in `imported`. If there is no such element, allow the import — it is not internal.
2. Compute the parent of that `internal` element by truncating the path at it. Call this `parent`.
3. If `importer` is exactly `parent` *or* has `parent` as a path prefix followed by a `/` *or* is empty (the command line case), allow the import.
4. Otherwise reject.

### In pseudo-code

```go
func allowed(imported, importer string) bool {
    // 1. find the last "internal" path element
    elems := strings.Split(imported, "/")
    last := -1
    for i, e := range elems {
        if e == "internal" {
            last = i
        }
    }
    if last == -1 {
        return true                      // not an internal package
    }
    // 2. parent = everything before the "internal" element
    parent := strings.Join(elems[:last], "/")

    // 3. importer must be inside parent
    if importer == parent {
        return true
    }
    if strings.HasPrefix(importer, parent+"/") {
        return true
    }
    return false
}
```

### Why "the last `internal`"?

A path may contain more than one `internal` element. The rule is enforced *at every `internal/` boundary*: the importer must be inside the parent of *each* such boundary. In practice, it is sufficient to check the *deepest* (last) boundary, because:

- If the importer is inside the deepest parent, it is also inside all shallower parents (deeper directories are subdirectories of shallower ones).
- If the importer is not inside the deepest parent, it cannot be inside any shallower one either... actually no — a deeper boundary may be more restrictive while a shallower one allows. Read the Go source carefully if you are porting this rule: the implementation walks all `internal` elements and checks each.

For most production code, "check the last `internal`" gives the right answer because directory structures are properly nested. The toolchain's actual implementation walks every `internal` element to be safe.

### Edge: the importer is a command-line argument

When you run `go build path/to/file.go`, the importer is conceptually "the command line." The toolchain treats this case specially: imports from the command-line position can sometimes reach internal packages within the same module. This is implemented as a special boolean flag passed into the loader, not as a separate import path.

---

## Module-Path Resolution and the Boundary

The `internal/` rule talks about *import paths*, not *file paths*. The two diverge in a few places worth understanding.

### Import path = module path + path within module

A module declares its path in `go.mod`:

```
module example.com/group/lib
```

A package whose source is at `<module-root>/foo/bar/` has the import path `example.com/group/lib/foo/bar`. The `internal/` rule operates on this import path.

### Vendoring does not change the boundary

If a module is vendored under `vendor/example.com/group/lib/`, the import path is still `example.com/group/lib`. The vendor directory is a *resolution mechanism*, not a path namespace. The rule fires on the import path, which is unchanged.

### `replace` does not change the boundary

A `replace` directive substitutes the *content* of a module, not the import path that other code uses. The rule still fires on the original import path, before `replace` is consulted. This is one reason why `replace` cannot be used to bypass `internal/` — the check happens earlier.

### Sub-modules are foreign modules

A nested `go.mod` introduces a separate module:

```
project/
├── go.mod                     ← module example.com/project
├── internal/x/
└── tools/
    └── go.mod                 ← module example.com/project/tools
```

`example.com/project/tools` is a different module. Its packages are *not* "rooted at the parent" of `example.com/project/internal/x` from the toolchain's point of view, because the rule is about importer position relative to the parent — and the parent is interpreted as a path prefix, not as an inclusive ancestor. In practice the rule rejects the import because the importer's module path differs.

### The case of a deceptive layout

```
project/
├── go.mod                          ← module example.com/foo
└── internal/
    └── x/
        └── x.go                    ← package x
```

A second module elsewhere has `module example.com/foo/internal/x`. A consumer of the second module imports `example.com/foo/internal/x`. The rule sees `internal` as a path element and asks: is the importer rooted at `example.com/foo/`? If the importer is in a third module, no. The rule rejects.

What if a consumer imports `example.com/foo/internal/x` and the toolchain happens to resolve it via the *second* module (because the first module is not in `go.mod`)? Then the resolution succeeds, but the rule still fires on the import path: `internal` is in the path, and the importer is not inside `example.com/foo/`. Rejected.

The toolchain treats `internal` as a *syntactic* property of the import path. It does not matter which module supplies the bytes; what matters is the path itself.

---

## Interaction With the Build Cache and Package Loading

The rule is checked once per package load, not per build action. This has consequences:

### Caching

`go build` caches package compilations under `$GOCACHE`. The cache key includes the package's source contents, the imports' compiled forms, and build flags — but not the rule check. The rule is evaluated during *loading*, not during compilation. A rule violation aborts loading; nothing reaches the cache.

### Errors are accumulated

When the loader sees a rule violation, it records the error and continues. This lets `go build ./...` report all violations at once instead of bailing on the first. The errors surface as `*PackageError` values attached to the importing package.

### Test files are loaded with the same rules

`*_test.go` files are loaded as part of their package or as `_test` packages. The rule applies to their imports the same way it applies to ordinary source. The "command line" special case does not extend to test files.

### Package loading is the unit of measurement

For very large codebases, package loading is a measurable cost. Adding more `internal/` directories does not measurably slow loading — the rule check is `O(import edges)` and trivially cheap per check. The cost of `internal/` is in human effort, not toolchain effort.

---

## Historical Evolution of the Rule

The rule has been mostly stable. The few changes are worth knowing.

### Go 1.4 (December 2014) — experimental introduction

`internal/` was added as an experimental feature in Go 1.4. It was honoured by the toolchain when applied to packages within the Go standard library (`runtime/internal`, `crypto/internal`). It was *not* honoured for user packages by default.

The rationale: the Go team needed a way to mark `runtime/internal/atomic` and similar packages as "do not import this from user code, ever." Before 1.4, that was a documentation-only request. After 1.4, the toolchain enforced it for the standard library.

### Go 1.5 (August 2015) — extended to user code

In Go 1.5, the rule was extended to apply to user code as well. Any `internal/` directory under any project root produces the same compiler error. This is the version most engineers think of as "when `internal/` was added."

The extension was mechanically simple — the rule was already implemented; it just needed to be invoked for non-standard-library packages too.

### Go 1.11 (August 2018) — modules and the rule

When modules were introduced, the rule was reformulated in terms of *module paths* rather than `GOPATH` source roots. The semantics were preserved: importing code must be in the subtree rooted at the parent of `internal/`, where "subtree" is now relative to the importing package's module path.

### Go 1.16 (February 2021) — modules become the default

`GOPATH`-mode largely retires. The rule continues to apply, now in a module-aware codebase. Behaviour is unchanged, but the *interpretation* of "rooted at the parent" is now consistently module-based.

### Go 1.18+ (March 2022 onward) — workspaces

`go.work` allows multiple modules to share a build context. The rule is *not* relaxed — modules in a workspace cannot reach into each other's `internal/`. The rationale: workspaces are a build-time convenience for local development; they should not change the public API of any module.

### Future stability

The rule is considered mature. The Go team is unlikely to change its semantics. Tooling can rely on the algorithm above for the foreseeable future.

---

## Edge Cases the Toolchain Source Reveals

Reading the source produces a handful of "huh, I would not have guessed" cases. The most useful for production engineers:

### Edge 1 — `internal` as a *substring*, not an *element*

```
example.com/myinternal/x
example.com/internalstuff/x
```

Neither is internal. The rule matches on full path elements, not substring. Nobody is fooled by this in code review, but tooling that grep-matches `internal` in import paths must use `\binternal\b` or similar.

### Edge 2 — Multiple `internal` elements

```
example.com/lib/internal/a/internal/b
```

The deepest `internal` boundary is at `example.com/lib/internal/a/`. The shallowest is at `example.com/lib/`. Both apply. The strictest one (deepest) determines the actual visibility, because it is necessarily nested inside the shallower one.

### Edge 3 — `internal` at the root of a module

```
module example.com/internal/lib
```

The `internal` here is part of the module path itself, not a path element introduced by an `internal/` directory. The toolchain treats it as `internal/` — the module is internal to the parent of the path, which is `example.com/`. In practice this is rare; it would require the module's authors to deliberately publish at a path beginning with `internal`.

### Edge 4 — A `vendor/` tree containing `internal/` of another module

```
vendor/
└── example.com/upstream/
    ├── pub.go
    └── internal/
        └── helper/
            └── helper.go
```

The vendored copy is reachable on disk, but the import path remains `example.com/upstream/internal/helper`. Your code is not in `example.com/upstream/`. Rule fires; import rejected. The `vendor/` tree is for *resolution*, not for *boundary changes*.

### Edge 5 — Test imports via `go test ./...`

The rule applies to tests. A test in `pkg-a/pkg_test.go` cannot import `pkg-b/internal/...`. The "command line" exception does not extend to tests. Some teams discover this when they organise tests in a top-level `tests/` directory and find they cannot test internal packages from there — they must move the tests into the package itself, or accept that internal packages need their own tests in the same directory.

### Edge 6 — `go run` with a single file

Running `go run main.go` from a directory inside the parent of `internal/` is allowed: the file is in the subtree. Running `go run main.go` from outside is not — even if `main.go` itself is sitting in the right directory, the working directory matters for what the toolchain considers the "command line" position.

### Edge 7 — Toolchain modules can ignore the rule

The Go standard library is itself a module (`std`). The standard library's own internal packages (`runtime/internal/atomic`, `crypto/internal/...`) are visible to other parts of the standard library. Third-party code, even though it lives in user modules, cannot import them. This is the rule applied to the stdlib's module path.

### Edge 8 — Forks of an upstream module

If you fork upstream `example.com/lib` to `example.com/myfork/lib`, the `internal/` packages move with it but their import path becomes `example.com/myfork/lib/internal/...`. Your fork's parent is `example.com/myfork/lib`, not `example.com/lib`. Importers from the fork repo can use the helpers; importers from anywhere else still cannot.

---

## Diagnosing Forbidden-Import Errors at Scale

In a large codebase you will sometimes see surprising rejections. The diagnosis flow:

### Step 1 — Read the message carefully

```
package example.com/x/y
        imports example.com/upstream/internal/helper:
        use of internal package example.com/upstream/internal/helper not allowed
```

The message tells you:
- The importing package: `example.com/x/y`.
- The imported package: `example.com/upstream/internal/helper`.
- The verdict: not allowed.

### Step 2 — Find the parent of the deepest `internal/`

`example.com/upstream/internal/helper` → parent is `example.com/upstream`.

### Step 3 — Check whether the importer is inside the parent

`example.com/x/y` does *not* have `example.com/upstream` as a prefix. Therefore the import is correctly rejected by the rule.

### Step 4 — If the importer should be inside the parent, find the divergence

If you expected `example.com/x/y` to be inside `example.com/upstream`, something is wrong. Possibilities:

- **Module rename.** The module was renamed and the importing module's `go.mod` still says the old name. Run `head go.mod` and confirm.
- **Sub-module surprise.** You expected the importer to be in the same module as the imported. It is not — there is a nested `go.mod`. Find it: `find . -name go.mod`.
- **Forked upstream.** You depend on a fork that retains the original `internal/` paths. The fork's importers are `example.com/myfork/...`, not `example.com/upstream/...`.

### Step 5 — Tooling that lints internal imports

For monorepos, build a small tool that walks `go list -json ./...` output, identifies internal imports, and reports who imports what. This is more useful than waiting for `go build` to fail; it surfaces gradual drift before it breaks CI.

```go
// pseudo-code
for each pkg in go list -json ./...:
    for each import in pkg.Imports:
        if hasInternalElement(import):
            if !isInsideParentOfInternal(pkg.ImportPath, import):
                emit ERROR
```

This is a one-day project for a senior or staff engineer; the code from `cmd/go/internal/load` is the reference implementation.

### Step 6 — Bazel and Buck2

Custom build systems must reimplement the rule when they handle Go. Bazel's `rules_go` does so; Buck2's Go support does too. If you are writing Go rules for a third build system, port the algorithm above. The unit tests of `rules_go` are a good source of corner cases to copy.

---

## Operational Notes

A few notes for engineers operating Go tooling at scale.

### `go list -deps` and `internal/`

`go list -deps ./...` prints all dependencies, including internal packages. They are not hidden from `go list`. They are only hidden from cross-module *imports*.

### IDE and language-server behaviour

`gopls` enforces the same rule the toolchain does, but it sometimes shows a "use of internal package not allowed" red squiggly slightly after the build would catch it (because `gopls` re-runs incrementally). When you fix the offending import, save the file; the squiggly clears within a second.

### CI signals

Configure CI to run `go vet ./...` (which exercises package loading) and `go build ./...` (which goes further). Both will fail on internal-import violations. Add `go list ./...` to your pipeline if you want a third, lighter pass.

### Tooling ecosystems that respect the rule

- `go build`, `go test`, `go vet` — yes.
- `go list` — yes.
- `gopls` — yes.
- `staticcheck` and `golangci-lint` — yes (they use the standard package loader).
- Custom code-generation tools that use `golang.org/x/tools/go/packages` — yes, by inheritance.
- `find` and `grep` — no. They will happily show you internal source. They have nothing to do with imports.

### Tools that *can* bypass the rule

There is no flag in the official toolchain to bypass `internal/`. Forks of `cmd/go` could remove the check. So could a third-party builder that compiles Go without using `cmd/go`. In practice, every real-world build system enforces the rule.

---

## Summary

The `internal/` rule is implemented as a small, syntactic check on import paths inside `cmd/go`. The algorithm is roughly ten lines: find the last `internal` element, compute its parent, verify the importer is inside that parent. The check fires during package loading; rejections are accumulated and reported.

The rule is purely about import paths. It does not interact with `vendor/`, `replace`, `go.work`, or the build cache except as those features change paths or supply bytes — and none of them change the path the rule examines. Sub-modules are foreign modules; the rule respects module boundaries.

Historically, the rule has been stable since Go 1.5. Go 1.4 introduced it for the standard library; 1.5 extended it to user code; 1.11 reformulated it for modules; 1.16 made modules the default. Workspaces in 1.18 do not relax it.

The corner cases — `internal` as substring, multiple `internal` elements in one path, vendoring — are explained by the algorithm. There are no surprises if you run the check by hand. The toolchain implementation is small enough to read in one sitting and ports cleanly into Bazel, Buck2, and any custom Go build system.

For production engineers, the rule is a stable load-bearing assumption. Build tooling on top of it; trust it to hold; do not try to bypass it.
