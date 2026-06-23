# Type Checking — Tasks

Hands-on exercises that build real `go/types` skills. Each task names the goal,
the key APIs, and a hint. Do them in order — later ones reuse the loading and
`Info`-map scaffolding from earlier ones. Verify each against `go build` /
`go vet` behavior so you trust your tool's verdicts.

## Task 1 — Type-check a snippet and print expression types

**Goal.** Parse a small source string, type-check it, and print the type of every
expression. **APIs.** `parser.ParseFile`, `types.Config.Check`, `types.Info.Types`,
`ast.Inspect`. **Hint.** Allocate `Info.Types` before `Check`; iterate the AST and
look up `info.Types[expr].Type`.

## Task 2 — Resolve a selector's type

**Goal.** For an expression like `r.Read` or `pkg.Func`, report what it resolves
to (field vs method, the receiver type, the result type). **APIs.**
`types.Info.Selections`, `types.Selection` (`Kind`, `Obj`, `Index`, `Indirect`).
**Hint.** Find the `*ast.SelectorExpr` in the AST and look it up in `Selections`;
print whether `Kind()` is `FieldVal`, `MethodVal`, or `MethodExpr`.

## Task 3 — Find all implementers of an interface

**Goal.** Given an interface in a package, list every named type that satisfies
it (test value and pointer receivers). **APIs.** `pkg.Scope().Names`,
`types.TypeName`, `types.Implements`, `types.NewPointer`, `iface.Complete`.
**Hint.** Skip interface types; for each concrete `T`, test
`Implements(T, iface) || Implements(NewPointer(T), iface)`.

## Task 4 — Detect untyped-constant truncation

**Goal.** Flag assignments/initializers where an untyped constant won't fit the
target integer type (the `var x uint16 = 1<<40` case). **APIs.** `types.Info.Types`
(`.Value`), `go/constant` (`Int64Val`/`Uint64Val` with the `exact` flag),
`constant.Compare`. **Hint.** When `tv.Value != nil`, compare it against the
target type's range; the `exact` return flag signals overflow.

## Task 5 — List the exported API of a package

**Goal.** Print every exported top-level object with its type/signature (a poor
man's `go doc`). **APIs.** `packages.Load`, `pkg.Scope().Names`, `obj.Exported`,
`types.ObjectString`. **Hint.** Iterate scope names, keep `obj.Exported()`, and
format with `types.ObjectString(obj, qualifier)`. Consider `IgnoreFuncBodies`
since you only need signatures.

## Task 6 — Write a tiny analyzer

**Goal.** Build a `go/analysis` analyzer that flags one pattern (e.g. comparing
two `error` values with `==`). **APIs.** `analysis.Analyzer`, `inspect.Analyzer`,
`inspector.Inspector`, `pass.Reportf`, `pass.TypesInfo`. **Hint.** Require
`inspect.Analyzer`, preorder over `*ast.BinaryExpr`, check both operands
implement `error`. Test with `analysistest.Run` and `// want` comments.

## Task 7 — Build a "find references" command

**Goal.** Given an identifier position, list its declaration and every use across
a package. **APIs.** `types.Info.Defs`, `types.Info.Uses`, `info.ObjectOf`.
**Hint.** Resolve the object at the cursor via `Uses`/`Defs`, then scan `Uses`
for every identifier mapping to that same `Object`.

## Task 8 — Inspect a generic instantiation

**Goal.** For a call like `Map[int, string](...)` or an inferred one, print the
type arguments and the instantiated signature. **APIs.** `types.Info.Instances`,
`types.Instance` (`TypeArgs`, `Type`), `Named.Origin`/`TypeArgs`. **Hint.** The
`Instances` map is keyed by the `*ast.Ident` naming the generic; print
`inst.TypeArgs` term by term.

## Task 9 — Report assignability vs convertibility

**Goal.** Given two types, print whether one is assignable to, convertible to, or
neither, with respect to the other. **APIs.** `types.AssignableTo`,
`types.ConvertibleTo`, `types.Identical`. **Hint.** Build a small matrix over
`int`, `int64`, `[]byte`, `string`, a defined type and its underlying, and verify
the results against what `go build` accepts.

## Task 10 — Dump method sets

**Goal.** For a type, print the method set of `T` and of `*T` side by side to make
the pointer-receiver rule visible. **APIs.** `types.NewMethodSet`,
`types.NewPointer`, `MethodSet.At`, `Selection.Obj`. **Hint.** Iterate
`ms.Len()`; show how pointer-receiver methods appear only in `*T`'s set.

## Task 11 — Compute and print a constraint's type set

**Goal.** For a constraint interface (e.g. `~int | ~string`), describe its type
set: the union terms, whether each is `~`, and the intersecting methods. **APIs.**
`Interface.IsMethodSet`, `Interface.EmbeddedType`, `*types.Union` (`Len`, `Term`),
`Term.Tilde`. **Hint.** Walk the interface's embedded type elements; a `*Union`'s
terms give the `~T`/`T` structure.

## Task 12 — Fold a constant expression with `go/constant`

**Goal.** Evaluate `(1<<20)/3 + 7` and `3.0/2` purely with `go/constant`, printing
kind and value, and demonstrate exact vs inexact extraction. **APIs.**
`constant.MakeInt64`, `BinaryOp`, `Shift`, `ToFloat`, `Int64Val`, `Float64Val`.
**Hint.** Note integer vs float division differs by operand kind, mirroring the
spec.

## Task 13 — Detect unused imports / params via the checker

**Goal.** Use `Info` to find package-level imports or function parameters that are
never referenced. **APIs.** `types.Info.Uses`, `types.PkgName`, `types.Var`,
`pkg.Imports`. **Hint.** Collect import `PkgName` objects, then check none appear
as values in `Uses` (the checker already errors on unused imports — compare your
result to confirm).

## Task 14 — Cross-package implementers scan

**Goal.** Extend Task 3 to scan an entire module (`./...`) and find every type in
any loaded package that implements a target interface. **APIs.** `packages.Load`
(with `NeedTypes|NeedTypesInfo|NeedDeps`), shared loader, `types.Implements`.
**Hint.** Iterate all `pkgs`, reuse the per-type check; rely on `packages.Load`
keeping cross-package types identical so the interface compares correctly.

## Stretch goals

- Add `-fix` (`analysis.SuggestedFix`) to your Task 6 analyzer so it rewrites the
  flagged code.
- Add a fact to Task 6 so it detects wrapper functions across packages.
- Build an SSA pass (`buildssa.Analyzer`) that flags an obviously-nil
  dereference.

Do these and you'll have touched scopes, objects, every important `Info` map,
method sets, constants, generics, the analysis framework, and multi-package
loading — the whole type-checking surface a tool author needs.

## Further reading

- [golang/example: gotypes tutorial](https://github.com/golang/example/tree/master/gotypes)
- [`go/analysis` skeleton & `analysistest`](https://pkg.go.dev/golang.org/x/tools/go/analysis/analysistest)
- [`golang.org/x/tools/go/packages` examples](https://pkg.go.dev/golang.org/x/tools/go/packages#example-Load)
- [`go/constant` examples](https://pkg.go.dev/go/constant#example-package)
- [`go/types#MethodSet`](https://pkg.go.dev/go/types#MethodSet)
