# Type Checking — Senior

The senior view connects the public `go/types` you use in tooling to the
`types2` the compiler actually runs, explains the gc compiler's mental model of
the type-checking stage, goes deep on generics inference and instantiation
(the hardest modern part), traces how type information crosses into the IR via
the unified noder, and looks at where checking spends its time.

## 1. `types2` vs `go/types`

They are **two forks of one algorithm**, kept deliberately close.

| | `go/types` | `types2` |
| --- | --- | --- |
| Path | `src/go/types` | `src/cmd/compile/internal/types2` |
| Syntax tree | `go/ast` | `cmd/compile/internal/syntax` |
| Positions | `token.Pos` (FileSet) | `syntax.Pos` (self-contained) |
| Consumer | external tools, `gopls`, vet | the `gc` compiler |
| Error style | accumulate or first | compiler-grade, with codes |

Why two? History: `go/types` shipped in Go 1.5 as a library on the existing AST.
When the compiler was rewritten in Go and needed its own faster front end, the
team forked it into `types2` on the new `syntax` package rather than bolt the
heavyweight `go/ast` onto the compiler. The two are **kept in sync by
mechanical translation** — large parts of `go/types` are generated from
`types2` sources (see `src/go/types/generator.go` and the `// Code generated`
headers). Practically: the typing *semantics* are identical, so a `go/types`
experiment faithfully predicts compiler behavior; only the surrounding API
(positions, error reporting, syntax tree) differs.

## 2. The gc mental model

Inside `cmd/compile`, type checking is one stage of the unified front end:

```text
source → scanner → parser (syntax tree)
       → noder/types2 type-check  ← THIS STAGE
       → unified IR export/import  (writer → reader)
       → IR (ir.Node) → SSA → machine code
```

The compiler does **not** type-check a package in isolation against textual
imports. Since the unified IR work (Go 1.20+), it:

1. Parses all files to `syntax` trees.
2. Type-checks with `types2`, producing typed objects and a `types2.Info`.
3. **Exports** a serialized form of the package (the "unified IR" / export data)
   via the *writer*, and immediately **re-imports** it via the *reader* to build
   the compiler's own `ir`/`types` representation.

That export/import round-trip is the bridge from front-end types to back-end IR
(§4). The cleanliness of having one real type checker means the export data is
authoritative and generics can be re-instantiated on demand at import time.

## 3. Generics: inference and instantiation in depth

Type parameters (Go 1.18+) are the deepest part of the checker. The relevant
`types2` files are `infer.go`, `unify.go`, `typeset.go`, `typeparam.go`,
`instantiate.go`, `subst.go`, and `union.go`.

**Type sets.** A constraint is an interface, but generalized: it may contain
*type elements* (`~int | ~string`) in addition to methods. Its **type set** is
the set of types satisfying it. `~T` means "all types whose underlying type is
`T`"; `A | B` is a union; methods intersect the set further. `typeset.go`
computes the *normalized* type set; a constraint is satisfiable only if its type
set is non-empty. `comparable` is a built-in constraint whose type set is "all
strictly comparable types."

**Instantiation** = substituting concrete type arguments for type parameters,
producing a non-generic type or function. Handled by `instantiate.go` +
`subst.go`. It validates each argument against the corresponding constraint's
type set, then `subst` walks the generic type replacing `*TypeParam`s.
Instantiation is **memoized** through a `types2.Context` (`context.go`) so
`List[int]` written in ten places yields one shared `*Named`. The result is
recorded in `Info.Instances` keyed by the identifier naming the generic.

**Inference** (`infer.go`) fills in type arguments you didn't write. It runs in
stages and is fundamentally a **unification** problem (`unify.go`):

1. *Type inference from typed arguments* — unify each argument's type against the
   parameter's type pattern, binding type parameters.
2. *Constraint type inference* — if a constraint has a single underlying *core
   type*, that pins still-unbound parameters (e.g. `[]E` core ⇒ `E` known).
3. *Untyped constant handling* — untyped args contribute their default type only
   after typed args, so `Max(1, 2.0)` infers `float64`, not a conflict.
4. *Function-argument inference* — defers inference for parameters that are
   themselves generic functions.

Unification maintains a substitution map and walks two types in parallel; a
`*TypeParam` unifies with whatever it meets (recording a binding), and a
mismatch of concrete structure fails. If any parameter is left unbound, you get
the familiar `cannot infer T`.

```go
func Map[S ~[]E, E, R any](s S, f func(E) R) []R { /* ... */ }

ns := Map([]int{1, 2}, func(x int) string { return "" })
// inference: arg1 []int unifies S=[]int; core type of ~[]E ⇒ E=int;
//            f's param int matches E; R=string from f's result. No args written.
```

A subtle senior point: inference does **not** flow information *out of* a result
type back into arguments in the general case, and it deliberately processes
typed arguments before untyped constants. Most "Go can't infer this" surprises
trace to one of those two facts.

## 4. How type info reaches the IR

The hand-off lives in `cmd/compile/internal/noder`:

- `writer.go` — serializes the type-checked package (objects, types, bodies,
  *instantiation info*) into the unified IR/export format.
- `reader.go` — reads it back, materializing `cmd/compile/internal/ir` nodes and
  `cmd/compile/internal/types` types. Generic functions are stored as templates
  and **re-instantiated** here for each needed type-argument set (stenciling),
  optionally sharing one shape-based implementation per *GC shape* to limit code
  bloat.
- `unified.go` / `irgen.go` — orchestrate: type-check, write, read, produce the
  `ir.Func`s the rest of the compiler consumes.

So the back-end `types.Type` is *not* the front-end `types2.Type` — it is rebuilt
from export data. This decoupling is why export data is the compiler's contract
between packages and why a `go/types` mental model maps cleanly onto it: the
front end finishes a complete, authoritative typed model before any IR exists.

## 5. Performance of checking

Type checking is usually a small fraction of a clean compile (codegen/SSA and
inlining dominate), but it is the bottleneck for *tools* that re-check
constantly (`gopls`).

- **Imports dominate at scale.** Resolving an import means loading and decoding
  export data for that package (transitively). Tools cut this with a shared
  importer/`packages` cache; the compiler caches per build action.
- **`Info` maps cost memory.** Each requested map allocates per-node entries.
  Request only what you use; for whole-program scans this is the difference
  between hundreds of MB and gigabytes.
- **Instantiation memoization matters.** Without a shared `Context`, repeated
  `List[int]` re-instantiates and re-checks; with it, work is shared.
- **Type-set computation** is the costly generics operation; large unions /
  deeply embedded constraints normalize repeatedly. `Interface.Complete()` /
  internal caching amortizes it.
- **Single-threaded per package.** A `Checker` run is sequential; parallelism
  comes from checking independent packages concurrently (what `packages.Load`
  and the build system do), not from parallelizing one package.

## 6. Summary

`go/types` and `types2` are the same algorithm on two syntax trees; the former
predicts the latter exactly. In gc, type checking sits between parsing and IR:
`types2` produces an authoritative typed model, the noder's writer/reader serialize
it as unified IR and rebuild the back-end `ir`/`types`, re-instantiating generics
(stenciling, GC-shape sharing) on import. Generics are the deep end: type sets
define constraint membership, instantiation substitutes and memoizes via a
`Context`, and inference is staged unification that handles typed args before
untyped constants. Performance-wise, import decoding and `Info`-map memory
dominate tool workloads; checking one package is sequential, so scale comes from
checking packages in parallel.

## Further reading

- [Go 1.18 type parameters proposal](https://go.googlesource.com/proposal/+/refs/heads/master/design/43651-type-parameters.md)
- [Type inference design notes](https://go.dev/blog/type-inference)
- [Source: `src/cmd/compile/internal/types2/infer.go`](https://github.com/golang/go/blob/master/src/cmd/compile/internal/types2/infer.go)
- [Source: `src/cmd/compile/internal/types2/unify.go`](https://github.com/golang/go/blob/master/src/cmd/compile/internal/types2/unify.go)
- [Source: `src/cmd/compile/internal/types2/typeset.go`](https://github.com/golang/go/blob/master/src/cmd/compile/internal/types2/typeset.go)
- [Source: `src/cmd/compile/internal/noder/` (writer/reader/unified)](https://github.com/golang/go/tree/master/src/cmd/compile/internal/noder)
- [Compiler README: front-end overview](https://github.com/golang/go/blob/master/src/cmd/compile/README.md)
