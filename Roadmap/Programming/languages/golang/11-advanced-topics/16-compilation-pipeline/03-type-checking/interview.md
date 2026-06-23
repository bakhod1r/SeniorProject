# Type Checking — Interview

Twenty questions on Go type checking, from "what does the stage do" through
untyped constants, method sets, interface satisfaction, generics inference, and
`go/types` vs `types2`. Each has a crisp answer you can deliver in an interview,
with the underlying mechanism so you can defend follow-ups.

## 1. What does the type-checking stage do, and where does it sit?

It's the third stage of `go build`: scan → parse → **type-check** → IR → SSA →
codegen. It takes the untyped AST from the parser, resolves every name to an
object, assigns a type to every expression, folds constants in arbitrary
precision, and enforces Go's typing rules (assignability, method sets, interface
satisfaction, constraint satisfaction). Output is a fully typed model the
back end builds on.

## 2. What's the difference between `go/types` and `types2`?

Two forks of the same algorithm. `go/types` (std lib, `src/go/types`) works on
`go/ast` and is what external tools use. `types2`
(`src/cmd/compile/internal/types2`) works on the compiler's faster `syntax` tree
and is what `gc` actually runs. Semantics are identical — large parts of
`go/types` are mechanically generated from `types2` — so a `go/types` experiment
predicts compiler behavior. They differ in positions, error reporting, and the
syntax tree, not in typing rules.

## 3. Why are there two type checkers at all?

History. `go/types` shipped in Go 1.5 as a library on the existing AST. When the
compiler was rewritten in Go and needed a faster front end, the team forked
`go/types` onto a new lightweight `syntax` package (→ `types2`) rather than bolt
the heavyweight `go/ast` onto the compiler. They're kept in sync by code
generation.

## 4. What's an untyped constant?

A constant literal (`42`, `3.14`, `"x"`, `true`) that carries a *kind* and an
arbitrary-precision value but **no concrete type** until a context forces one. So
`1 << 62` is a legal untyped constant even though it doesn't fit `int32`; it only
needs to fit when assigned into a typed slot.

## 5. What are default types and when do they apply?

When an untyped constant is used where no specific type is required (e.g.
`x := 5`, `fmt.Println(3.14)`), it takes its **default type**: int→`int`,
float→`float64`, rune→`rune`, complex→`complex128`, string→`string`, bool→`bool`.
`types.Default(t)` computes it.

## 6. Why does `var x int8 = 200` fail but `const c = 200` succeed?

`200` is an untyped constant with exact value 200; as a `const` it stays
untyped and arbitrary-precision, fine. Assigning it into `int8` requires it to be
*representable* in `int8` (range −128..127); 200 isn't, so the checker reports a
compile-time overflow. Constant folding and the representability check are the
whole reason such errors are caught at compile time.

## 7. What is a method set and why does it matter?

The set of methods callable on a value of a type — it determines which interfaces
the type satisfies. For type `T`: methods with **value** receivers. For `*T`:
methods with value **and** pointer receivers. So a pointer-receiver method is not
in `T`'s method set.

## 8. Why does `var s fmt.Stringer = MyType{}` fail when `String` has a pointer receiver?

Because `String` with receiver `*MyType` is in the method set of `*MyType`, not
of `MyType`. The value `MyType{}` therefore doesn't satisfy `Stringer`. Fix: use
`&MyType{}`, or give `String` a value receiver if it doesn't mutate.

## 9. How do you check interface satisfaction programmatically?

`types.Implements(T, iface)` for plain interfaces; `types.Satisfies(T, iface)`
when constraint type-sets are involved. Because of the pointer-receiver rule,
robust tools test both `T` and `types.NewPointer(T)`.

## 10. Assignability vs convertibility?

Assignability (`AssignableTo`) = can a value be used where a type is expected
*without* a conversion (identical types, same underlying with one side unnamed,
interface satisfaction, channel rules, `nil`, representable untyped constant).
Convertibility (`ConvertibleTo`) is broader: assignability plus explicit
conversions like numeric↔numeric and `[]byte`↔`string`. `int`→`int64` is
convertible but not assignable.

## 11. How does embedding affect method sets?

Embedding **promotes** the embedded type's methods into the outer type's method
set, with the pointer-receiver rule applied at each level. `go/types` resolves
the promotion; `Info.Selections[sel].Index()` exposes the embedding path used to
reach a promoted field or method.

## 12. What is the `Info` struct and what are its main maps?

The struct the checker fills with what it learned. Key maps: `Types`
(expr→type+value), `Defs` (declaring ident→object), `Uses` (referencing
ident→object), `Selections` (`x.f`→resolution), `Implicits` (implicit objects),
`Instances` (generic instantiations), `Scopes`, `InitOrder`. You allocate only
the maps you read; the checker skips nil ones.

## 13. Difference between `Defs` and `Uses`?

`Defs` records the *declaring* occurrence of each name (and maps blank `_` to
nil); `Uses` records every *referencing* occurrence. `info.ObjectOf(id)` returns
either. "Find references" walks `Uses`; "go to definition" uses `Defs`.

## 14. Why must you use `types.Identical` instead of `==`?

`types.Type` values compare by **pointer identity** under `==`. Two structurally
equal types (freshly constructed, or from two importers) are different pointers.
`types.Identical(a, b)` compares structure and is what you almost always want.

## 15. How does generic type inference work, at a high level?

It's staged unification (`infer.go`/`unify.go`). First, infer from **typed
function arguments** by unifying each argument against the parameter pattern,
binding type parameters. Then **constraint type inference** uses a constraint's
single core type to pin still-unbound parameters. Untyped constants contribute
their default types only after typed args. If any parameter stays unbound:
`cannot infer T`.

## 16. Why can't Go infer `T` from the result type, e.g. `var p *int = New()`?

Inference flows from **arguments**, not from the assignment's expected type.
`New[T any]() *T` has no arguments, so there's nothing to unify against — you must
write `New[int]()`. This is a deliberate design limitation.

## 17. What is a type set / constraint?

A constraint is a generalized interface that may contain **type elements**
(`~int | ~string`) in addition to methods. Its **type set** is the set of types
satisfying it: `~T` = all types whose underlying type is `T`; `A | B` = union;
methods intersect the set. A type argument is valid iff it's in the constraint's
type set and has the required methods. `any` = all types; `comparable` = all
strictly comparable types.

## 18. What is instantiation, and is it memoized?

Substituting concrete type arguments for a generic's type parameters, yielding a
non-generic `*Named`/`*Signature`. It validates each argument against its
constraint's type set, then substitutes. It's **memoized** through a
`types.Context`, so `List[int]` written many times produces one shared type.
Recorded in `Info.Instances`.

## 19. How does type information get from the checker into the compiler's IR?

In gc, `types2` produces the typed model, then `cmd/compile/internal/noder`'s
**writer** serializes it as unified IR / export data and the **reader** rebuilds
the back-end `ir`/`types` representation, re-instantiating generics (stenciling,
with GC-shape sharing) on import. So the back-end types are reconstructed from
export data, not shared pointers with the front end.

## 20. Why is import setup the trickiest part of using `go/types`?

A `nil` importer fails on any imported symbol; mismatched importers make
cross-package types non-identical; build tags/GOOS hide files; cgo files need
preprocessing; error packages return partial/`Invalid` types. `packages.Load`
gets all of this right (shells out to the toolchain), which is why production
tools use it instead of hand-rolling an importer.

## Quick-fire

- *Default type of `'a'`?* — `rune` (`int32`).
- *Does `T` satisfy an interface if a method has a pointer receiver?* — No, only
  `*T`.
- *Which `Info` map gives a constant's folded value?* — `Types[expr].Value`.
- *`int` assignable to `int64`?* — No; convertible, not assignable.
- *What does `Underlying()` do on a `*Named`?* — Strips the name to the
  underlying type.
- *Package backing arbitrary-precision constants?* — `go/constant`.
- *Map for generic instantiations?* — `Info.Instances`.
- *`comparable` expressible as a union?* — No; it's a special built-in constraint.

## Further reading

- [Go blog: "The go/types package"](https://go.dev/blog/go-types)
- [Go blog: type inference](https://go.dev/blog/type-inference)
- [Go spec: Constants, Method sets, Assignability, Type inference](https://go.dev/ref/spec)
- [`go/types` reference](https://pkg.go.dev/go/types)
- [Type parameters proposal](https://go.googlesource.com/proposal/+/refs/heads/master/design/43651-type-parameters.md)
