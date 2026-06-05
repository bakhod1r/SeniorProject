# Type Checking — Optimize

Type checking itself is fast; what gets slow is *re-type-checking large
programs* — linters, `gopls`, code-mods, CI gates running across a whole module
or monorepo. The cost is dominated by package **loading** (decoding export data),
`Info`-map **memory**, redundant **re-checking**, and SSA construction. This tier
is the performance playbook: load modes, caching, fact-based analyzers,
parallelism, memory discipline, and a checklist.

## 1. `packages.Load` modes — request the minimum

`packages.Config.Mode` is a bitmask. Each bit pulls in more work *and more
transitive loading*. The single biggest perf lever in any go/types tool is not
over-requesting.

| Mode bit | Pulls in | Cost |
| --- | --- | --- |
| `NeedName` | import path, package name | cheap (`go list` metadata) |
| `NeedFiles` | file paths | cheap |
| `NeedSyntax` | parsed ASTs | parse cost per file |
| `NeedTypes` | type-checked `*types.Package` | full type check |
| `NeedTypesInfo` | the `*types.Info` maps | type check + per-node memory |
| `NeedDeps` | type info for dependencies too | recursive, often the bulk |
| `NeedImports` | import graph | needed for typed deps |

```go
// Metadata only — listing packages, building a graph: fast, low memory.
cfg := &packages.Config{Mode: packages.NeedName | packages.NeedImports}

// Full typed analysis of a target — request deps, but nothing extra.
cfg := &packages.Config{Mode: packages.NeedName | packages.NeedFiles |
	packages.NeedSyntax | packages.NeedTypes | packages.NeedTypesInfo |
	packages.NeedImports | packages.NeedDeps}
```

`packages.LoadAllSyntax` is convenient but maximal — it type-checks *and* keeps
syntax + info for the whole transitive closure. On a big module that is hundreds
of MB to multiple GB. Prefer building the exact bitmask you need.

## 2. Caching: export data and the build cache

The expensive part of loading a dependency is decoding its **export data** (the
serialized type info). Two layers of cache help:

- **The Go build cache** (`$GOCACHE`). `packages.Load` shells out to the toolchain,
  which reuses compiled/export artifacts. A warm cache turns a cold multi-minute
  load into seconds. **Never** wipe `GOCACHE` in CI between related steps.
- **In-process importer cache.** If you hand-roll a checker, a *single shared*
  importer caches each `*types.Package` so transitive `io`, `fmt`, etc. are
  decoded once, not per dependent. (It also keeps cross-package types identical —
  see `find-bug.md`.) `packages.Load` does this internally.

For repeated runs (a watch-mode linter, `gopls`), keep loaded packages
in-memory and reload only the packages whose files changed plus their reverse
dependencies — don't reload `./...` on every keystroke.

## 3. Fact-based analyzers and the analysis cache

The `go/analysis` framework is built for incremental scale:

- Each analyzer runs **once per package** and its result is **cached** keyed on
  the package's content hash + analyzer version. Unchanged packages are skipped
  on the next run.
- **Facts** let one package's analysis result feed a downstream package *without
  re-analyzing the upstream one*. This replaces whole-program re-scans with an
  incremental, package-local pass plus serialized facts. (E.g. printf-wrapper
  detection is package-local + a fact, not a global walk.)
- Declare dependencies via `Requires` so shared work (parsing into an
  `inspector.Inspector`, building SSA) happens **once** and is reused by every
  analyzer in the pass via `pass.ResultOf`.

```go
var A = &analysis.Analyzer{
	Name:     "mycheck",
	Requires: []*analysis.Analyzer{inspect.Analyzer}, // share the inspector
	Run:      run,
	FactTypes: []analysis.Fact{(*myFact)(nil)},        // enable incremental facts
}
```

Use `inspector.Inspector` (from `inspect.Analyzer`) instead of `ast.Inspect`: it
indexes nodes once and filters by node type, which is markedly faster across a
suite that walks the same trees repeatedly.

## 4. Parallelism

- **Across packages.** A single `Checker` run is sequential, but independent
  packages type-check independently. `packages.Load` and the `go/analysis`
  driver already parallelize across packages (bounded by GOMAXPROCS). Your own
  multi-package tool should fan out per package with a worker pool, not check
  serially.
- **Respect the dependency DAG.** A package can't be checked before its imports
  are available, so parallelism is limited by the import graph's critical path;
  topologically order and process ready packages concurrently.
- **Within a package: don't.** There's no safe way to parallelize one package's
  type check; the `Checker` mutates shared state. Spend the effort on
  package-level concurrency instead.
- **Share a `types.Context`** across instantiations when checking many packages
  that use the same generics, so `List[int]` is instantiated and checked once.

## 5. Memory

Memory, not CPU, is what kills whole-repo tools (OOMs in CI).

- **Trim `Info` maps.** Each requested map stores an entry per relevant node.
  Need only `Uses`? Allocate only `Uses`. On a large package, dropping unused
  maps saves a lot.
- **Drop ASTs you no longer need.** After extracting facts from a package's
  syntax, you usually don't need to retain the `*ast.File`s; let them be GC'd
  (don't hold the whole `[]*packages.Package` if you only need results).
- **`IgnoreFuncBodies`** when you only need signatures/exported API: it skips
  body checking entirely — far less work and memory. Great for API-surface tools.
- **Don't build SSA for the world.** `ssa` is heavy. Build only target packages,
  not `ssautil.AllPackages` over the full dependency closure, unless you truly
  need whole-program flow.
- **Stream, don't accumulate.** Report findings as you go rather than buffering
  every diagnostic plus the data structures that produced them.

## 6. Measuring

Profile before optimizing — guesses about where checking spends time are usually
wrong.

```go
import "runtime/pprof"

f, _ := os.Create("cpu.prof")
pprof.StartCPUProfile(f)
defer pprof.StopCPUProfile()
// ... run load + analysis ...

mf, _ := os.Create("mem.prof")
defer func() { runtime.GC(); pprof.WriteHeapProfile(mf) }()
```

`go tool pprof cpu.prof` typically shows time in `gcimporter`/export-data
decoding (⇒ caching / fewer deps) or in `types.(*Checker)` (⇒ trim work,
`IgnoreFuncBodies`). For analyzer suites, `-debug=t` on the vet driver and
the `gopls` `serverStats`/profiling endpoints reveal per-analyzer cost.

## 7. Checklist

- [ ] `packages.Mode` set to the **minimum** bits needed (not `LoadAllSyntax`).
- [ ] One shared importer / loader; cross-package types stay identical.
- [ ] `GOCACHE` warm and preserved between CI steps.
- [ ] Only the `Info` maps you read are allocated.
- [ ] `IgnoreFuncBodies` when you only need signatures / exported API.
- [ ] Analyzers use `inspect.Analyzer` + shared `Requires`, not ad-hoc walks.
- [ ] Cross-package logic uses **facts**, not whole-program re-scans.
- [ ] Fan out across packages (respecting the import DAG), not within a package.
- [ ] Shared `types.Context` for repeated generic instantiations.
- [ ] SSA built only for target packages.
- [ ] CPU + heap profiled; hotspots confirmed before changes.

## Summary

Fast type-checking tooling is mostly about *not doing redundant work*: request
the minimum `packages.Mode`, allocate only the `Info` maps you read, keep the
build cache warm, share a single importer and `types.Context`, and use
`IgnoreFuncBodies` when bodies don't matter. Scale comes from package-level
parallelism (the import DAG bounds it) and from the `go/analysis` cache + facts
turning whole-program scans into incremental package-local passes. Memory, not
CPU, is the usual failure mode — trim maps, drop ASTs, and don't build SSA for
the entire dependency closure. Always profile to confirm the hotspot is loading
versus checking before you optimize.

## Further reading

- [`go/packages` load modes](https://pkg.go.dev/golang.org/x/tools/go/packages#LoadMode)
- [`go/analysis` caching & facts](https://pkg.go.dev/golang.org/x/tools/go/analysis#Fact)
- [`go/ast/inspector`](https://pkg.go.dev/golang.org/x/tools/go/ast/inspector)
- [`gopls` performance documentation](https://github.com/golang/tools/tree/master/gopls/doc)
- [Go build cache (`go help cache`)](https://pkg.go.dev/cmd/go#hdr-Build_and_test_caching)
- [`runtime/pprof`](https://pkg.go.dev/runtime/pprof)
