# Type Checking — Professional

At the professional level you build, ship, and operate analysis tooling on top of
`go/types`: real linters, vet-style analyzers, code-mod engines, and SSA-based
checks. The hard parts are no longer the typing rules — they are *loading real
packages correctly* (build constraints, cgo, modules), wiring the
`go/analysis` framework, getting facts to flow across package boundaries, and
avoiding the footguns that silently produce wrong results. This tier is the
production playbook.

## 1. Load real packages with `go/packages`

`importer.Default()` and manual `parser.ParseFile` are fine for snippets; they
fall apart on modules, build tags, generated code, and cgo. The supported,
build-system-aware loader is `golang.org/x/tools/go/packages`. It shells out to
the Go toolchain (`go list`), so it sees the *exact* same view as `go build`.

```go
import "golang.org/x/tools/go/packages"

cfg := &packages.Config{
	Mode: packages.NeedName | packages.NeedFiles | packages.NeedSyntax |
		packages.NeedTypes | packages.NeedTypesInfo | packages.NeedDeps |
		packages.NeedImports,
	Tests: false,
	// BuildFlags: []string{"-tags=integration"},
}
pkgs, err := packages.Load(cfg, "./...")
if err != nil {
	log.Fatal(err)
}
if packages.PrintErrors(pkgs) > 0 { // type/parse/load errors
	os.Exit(1)
}
for _, p := range pkgs {
	fmt.Println(p.PkgPath, p.Types, p.TypesInfo) // typed & ready
}
```

`Load` type-checks for you and hands back `p.Types` (`*types.Package`) and
`p.TypesInfo` (`*types.Info`) per package, with imports already resolved and
cross-package types *identical-comparable* (same pointers). **The `Mode`
bitmask is load-bearing**: forget `NeedDeps`/`NeedImports` and imported types
come back incomplete; forget `NeedTypesInfo` and `TypesInfo` is nil. Request the
*minimum* mode you need — each flag costs time and memory across a big module.

## 2. The `go/analysis` framework

Don't write a bespoke main loop. `golang.org/x/tools/go/analysis` is the
contract that `go vet`, `staticcheck`, and CI linters share. An `Analyzer` is a
self-contained pass with declared dependencies; the driver runs it over every
package, handles caching, and feeds it pre-built results.

```go
import (
	"go/ast"
	"go/types"
	"golang.org/x/tools/go/analysis"
	"golang.org/x/tools/go/analysis/passes/inspect"
	"golang.org/x/tools/go/ast/inspector"
)

var Analyzer = &analysis.Analyzer{
	Name:     "noerrcompare",
	Doc:      "flag comparing errors with == instead of errors.Is",
	Requires: []*analysis.Analyzer{inspect.Analyzer},
	Run:      run,
}

func run(pass *analysis.Pass) (any, error) {
	insp := pass.ResultOf[inspect.Analyzer].(*inspector.Inspector)
	insp.Preorder([]ast.Node{(*ast.BinaryExpr)(nil)}, func(n ast.Node) {
		be := n.(*ast.BinaryExpr)
		if be.Op != token.EQL && be.Op != token.NEQ {
			return
		}
		if isErr(pass.TypesInfo, be.X) && isErr(pass.TypesInfo, be.Y) {
			pass.Reportf(be.Pos(), "compare errors with errors.Is, not %s", be.Op)
		}
	})
	return nil, nil
}

func isErr(info *types.Info, e ast.Expr) bool {
	t := info.TypeOf(e)
	return t != nil && types.Implements(t, errorType) // errorType = the error interface
}
```

Inside `Run` you get a fully typed `pass`: `pass.Pkg` (`*types.Package`),
`pass.TypesInfo`, `pass.Fset`, `pass.Files`. Ship it with
`singlechecker.Main(Analyzer)` (one analyzer) or `multichecker.Main(...)` (a
suite), and test it with `analysistest.Run` against `testdata` packages
annotated with `// want "..."` comments.

Use `inspect.Analyzer` + `inspector.Inspector` rather than `ast.Inspect`: the
inspector indexes nodes once and is reused across analyzers in the same pass,
which matters for performance on large suites.

## 3. Facts: cross-package analysis

Many real checks need information about *other* packages — "is this function a
printf wrapper?", "is this field a sensitive credential?". A single pass only
sees one package's syntax, so `go/analysis` provides **facts**: typed values an
analyzer attaches to an `Object` (or package) in one pass and reads back when a
*downstream* package is analyzed. The driver serializes facts alongside the
build cache, so they survive across package boundaries and incremental builds.

```go
type isWrapper struct{} // must be gob-encodable
func (*isWrapper) AFact() {}

// producing package: pass.ExportObjectFact(fnObj, &isWrapper{})
// consuming package: var f isWrapper; if pass.ImportObjectFact(obj, &f) { ... }
```

This fact mechanism is exactly how `printf` analysis tracks wrapper functions
transitively. Register fact types via `Analyzer.FactTypes` so the driver knows
to persist them.

## 4. SSA from x/tools

For flow-sensitive checks (nil-deref, taint, unreachable code) the AST + types
aren't enough; you want SSA. `golang.org/x/tools/go/ssa` builds a separate SSA
form from the typed packages (distinct from the compiler's internal SSA).

```go
import (
	"golang.org/x/tools/go/ssa"
	"golang.org/x/tools/go/ssa/ssautil"
)

prog, ssaPkgs := ssautil.AllPackages(pkgs, ssa.BuilderMode(0))
prog.Build()
// Walk functions, basic blocks, instructions; inspect *ssa.Call, *ssa.Phi, etc.
```

Pair it with `pointer` (Andersen-style pointer analysis) or `callgraph` for
reachability. There's also `buildssa.Analyzer` so an SSA-based analyzer slots
into the `go/analysis` driver like any other pass. SSA construction is
expensive — only build the packages you actually analyze, and prefer
`ssautil.BuildPackage`/whole-program modes deliberately.

## 5. Footguns (the ones that cost real hours)

- **Importer setup / mismatched importers.** If you wire your own checker, every
  package in a load *must* share one importer, or `types.Identical` across
  packages returns false (two `io.Reader`s from two importers aren't the same
  pointer). `packages.Load` gets this right; hand-rolled importers usually don't.
- **Build constraints / tags.** A file behind `//go:build linux` or
  `//go:build integration` is *invisible* unless you set `Config.BuildFlags` /
  `Env` (`GOOS`, `GOARCH`). Linters that "miss" code on CI are usually running
  under a different GOOS than the developer.
- **cgo.** Files importing `"C"` are preprocessed by the cgo tool. With
  `NeedSyntax` + `NeedTypes`, `packages` handles cgo translation, but the syntax
  you get is the *generated* form; positions and identifiers differ from source.
  Naive parsers choke entirely on `import "C"`.
- **Generated & vendored code.** `_test.go`, `*.pb.go`, mocks — decide
  explicitly whether to skip them (`ast.IsGenerated`, path filters). Reporting on
  generated code is a classic false-positive source.
- **Partial / error packages.** With load errors, `p.Types` may be non-nil but
  *incomplete*; `info.TypeOf(e)` can return nil or `types.Typ[types.Invalid]`.
  Always nil-check and skip `Invalid` before drawing conclusions.
- **Comparing types with `==`.** Pervasive bug. `t1 == t2` compares pointers;
  use `types.Identical`. (See `find-bug.md`.)
- **Module mode & working directory.** `packages.Load` resolves patterns
  relative to `Config.Dir` under the module there. Running your tool from the
  wrong dir silently loads a different (or empty) package set.

## 6. War stories

- **The vet printf wrapper.** Detecting `myLogf(format, args...)` as a printf-like
  function across packages is impossible without facts; the analyzer exports an
  `isWrapper` fact per qualifying function and imports it downstream. This is the
  canonical reason facts exist.
- **"It passes locally, fails in CI."** Almost always GOOS/GOARCH/build-tag skew:
  the dev machine compiles the `darwin` file, CI the `linux` one, and the
  analyzer only ever saw one. Pin `Env`/`BuildFlags` in the linter config.
- **The 4 GB linter.** A whole-repo analyzer OOMing because it requested every
  `Info` map and built SSA for the entire dependency graph. Fix: trim `Mode`,
  request only the needed `Info` fields, and build SSA for the target packages
  only, not `AllPackages`.
- **Identical-but-not-equal.** A code-mod that deduped types with `==` quietly
  merged distinct `Config` types from two import paths because two importer
  instances produced two pointers. Switching to `types.Identical` (and a single
  loader) fixed it.

## 7. Summary

Production type-checking tooling is built on `go/packages` for correct,
build-aware loading and on `go/analysis` for a cached, composable pass framework
with cross-package facts. SSA from `x/tools` adds flow sensitivity when AST +
types aren't enough. The recurring failures are not about typing rules — they're
about *environment*: importer sharing, build tags, GOOS/GOARCH, cgo, generated
code, incomplete error-packages, and the perennial `==`-vs-`types.Identical`
trap. Request the minimum `packages.Mode` and minimum `Info` maps, share one
loader, pin the build environment, and your analyzer will be correct *and* fit
in memory.

## Further reading

- [`golang.org/x/tools/go/packages` docs](https://pkg.go.dev/golang.org/x/tools/go/packages)
- [`golang.org/x/tools/go/analysis` docs](https://pkg.go.dev/golang.org/x/tools/go/analysis)
- [Analyzer authoring guide (`go/analysis` README)](https://github.com/golang/tools/blob/master/go/analysis/doc/analysis.md)
- [`go/analysis/analysistest`](https://pkg.go.dev/golang.org/x/tools/go/analysis/analysistest)
- [`golang.org/x/tools/go/ssa`](https://pkg.go.dev/golang.org/x/tools/go/ssa)
- [Source: `passes/printf` (facts in practice)](https://github.com/golang/tools/tree/master/go/analysis/passes/printf)
- [staticcheck — large real analyzer suite](https://github.com/dominikh/go-tools)
