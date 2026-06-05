# Type Checking — Find the Bug

Fourteen realistic bugs in code that *uses* `go/types`, plus the classic Go
typing surprises the checker reports. Each entry gives the **code**, the
**symptom**, the **cause**, and the **fix**. These are the mistakes that cost
real debugging hours when writing analyzers, linters, and code-mods — read the
symptom first and try to spot the bug before the explanation.

## Bug 1 — nil importer

```go
conf := types.Config{} // no Importer set
pkg, err := conf.Check("demo", fset, files, nil)
```

**Symptom.** `Check` returns an error like
`demo.go:3:8: could not import fmt (Config.Importer not installed)`, even though
the code compiles fine with `go build`.

**Cause.** Any package that imports *anything* needs a way to resolve those
imports. With no `Importer`, the checker can't load `fmt`'s export data, so every
imported symbol is undefined.

**Fix.** Set an importer. For snippets, `importer.Default()`; for real tools,
let `packages.Load` do it.

```go
conf := types.Config{Importer: importer.Default()}
```

## Bug 2 — missing `Info` maps (nil map panic / empty results)

```go
info := &types.Info{} // no maps allocated
conf.Check("demo", fset, files, info)

for id, obj := range info.Defs { // always empty
	_ = id; _ = obj
}
```

**Symptom.** `info.Defs`/`info.Types` are empty and your tool reports nothing —
or, if you write to a map yourself, a `nil map` panic.

**Cause.** The checker only populates `Info` maps that are **non-nil**. An
unallocated map is left untouched (the checker writes nothing rather than
allocating for you).

**Fix.** Allocate exactly the maps you intend to read.

```go
info := &types.Info{
	Defs:  make(map[*ast.Ident]types.Object),
	Uses:  make(map[*ast.Ident]types.Object),
	Types: make(map[ast.Expr]types.TypeAndValue),
}
```

## Bug 3 — comparing types with `==` instead of `types.Identical`

```go
func isStringSlice(t types.Type) bool {
	return t == types.NewSlice(types.Typ[types.String]) // always false
}
```

**Symptom.** The function returns `false` even for `[]string`. Type-equality
checks across packages or freshly constructed types never match.

**Cause.** `types.Type` values are compared by **pointer identity** with `==`.
`types.NewSlice(...)` makes a *new* `*Slice` every call, and two importers
produce distinct pointers for the "same" type.

**Fix.** Use `types.Identical` (or `IdenticalIgnoreTags` for structs).

```go
func isStringSlice(t types.Type) bool {
	s, ok := t.(*types.Slice)
	return ok && types.Identical(s.Elem(), types.Typ[types.String])
}
```

## Bug 4 — interface satisfaction with a pointer receiver

```go
type Stringer interface{ String() string }

type Temp float64
func (t *Temp) String() string { return fmt.Sprintf("%.1f°", float64(*t)) }

var s Stringer = Temp(20) // COMPILE ERROR
```

**Symptom.** `cannot use Temp(20) (value of type Temp) as Stringer value:
Temp does not implement Stringer (method String has pointer receiver)`.

**Cause.** A method with receiver `*Temp` is in the method set of `*Temp` but
**not** of `Temp`. The value `Temp(20)` therefore doesn't satisfy `Stringer`.

**Fix.** Use a pointer, or make the receiver a value receiver if the method
doesn't mutate.

```go
var s Stringer = &t          // t is addressable *Temp
// or: func (t Temp) String() string { ... }
```

When checking this in a tool, test **both** `T` and `types.NewPointer(T)`:

```go
ok := types.Implements(T, iface) || types.Implements(types.NewPointer(T), iface)
```

## Bug 5 — untyped constant overflow

```go
const Mask = 1 << 40
var flags uint16 = Mask // COMPILE ERROR
```

**Symptom.** `constant 1099511627776 overflows uint16`.

**Cause.** `Mask` is an untyped constant with an exact, huge value. Assigning it
into a `uint16` requires it to be *representable* in `uint16`; it isn't.

**Fix.** Use a wide enough type, or intend the truncation explicitly.

```go
var flags uint64 = Mask
```

Detect this in a tool via `go/constant`'s exactness flag:

```go
v := info.Types[expr].Value
if x, exact := constant.Uint64Val(v); !exact || x > math.MaxUint16 {
	// does not fit the target
}
```

## Bug 6 — checking files of two packages together

```go
a, _ := parser.ParseFile(fset, "a.go", srcPkgFoo, 0)
b, _ := parser.ParseFile(fset, "b.go", srcPkgBar, 0) // different package clause!
conf.Check("foo", fset, []*ast.File{a, b}, nil)
```

**Symptom.** `b.go:1:9: found packages foo (a.go) and bar (b.go)` or garbled
cross-references.

**Cause.** `Check` type-checks **one** package: all `*ast.File`s passed must
share the same `package` clause. Mixing packages (or accidentally including a
`_test.go` external test package) breaks it.

**Fix.** Group files by package and call `Check` once per package — or use
`packages.Load`, which groups for you.

## Bug 7 — forgetting build tags / GOOS, so a file is missing

```go
cfg := &packages.Config{Mode: packages.LoadAllSyntax}
pkgs, _ := packages.Load(cfg, "./...")
// platform-specific file behind //go:build linux never appears on macOS
```

**Symptom.** A symbol defined only in `foo_linux.go` is "undefined" when the tool
runs on a Mac dev machine, but compiles fine in Linux CI (or vice versa).

**Cause.** `packages.Load` honors the *current* `GOOS`/`GOARCH` and build tags,
exactly like `go build`. Files for other platforms are excluded from the package.

**Fix.** Set the target environment explicitly when you must analyze another
platform.

```go
cfg.Env = append(os.Environ(), "GOOS=linux", "GOARCH=amd64")
// or cfg.BuildFlags = []string{"-tags=integration"}
```

## Bug 8 — generic instantiation with a non-satisfying type argument

```go
func Sum[T ~int | ~float64](xs []T) T { /* ... */ }

_ = Sum([]string{"a", "b"}) // COMPILE ERROR
```

**Symptom.** `string does not satisfy ~int | ~float64 (string missing in
~int | ~float64)`.

**Cause.** The inferred type argument `string` is not in the constraint's **type
set**. Inference succeeds in *finding* `T=string` from the slice, then
satisfaction *fails*.

**Fix.** Pass an argument whose element type is in the type set, or widen the
constraint. When instantiating manually in a tool, expect an error and check it:

```go
_, err := types.Instantiate(ctxt, genericType, []types.Type{argType}, true)
// validate==true ⇒ err is non-nil when the arg violates the constraint
```

## Bug 9 — assuming inference flows from the result type

```go
func New[T any]() *T { return new(T) }

p := New() // COMPILE ERROR: cannot infer T
var q *int = New()
```

**Symptom.** `cannot infer T` even though `q`'s declared type is `*int`.

**Cause.** Type inference works from **function arguments**, not from the
assignment's left-hand side / expected result type. `New` takes no arguments, so
there's nothing to infer from.

**Fix.** Supply the type argument explicitly.

```go
p := New[int]()
```

## Bug 10 — `Defs` vs `Uses` confusion (blank `_` and missing decls)

```go
// "find all uses of a symbol" walks Defs by mistake
for id, obj := range info.Defs {
	if obj == target { report(id) } // misses every actual use
}
```

**Symptom.** A "find references" feature highlights only the declaration, never
the uses; and panics-or-skips on `_` because `Defs[_]` is `nil`.

**Cause.** `Defs` records *declaring* identifiers (and maps the blank identifier
to `nil`); *uses* live in `Uses`. They're different maps for a reason.

**Fix.** Iterate `Uses` for references; guard against nil objects; use
`info.ObjectOf` when you want either.

```go
for id, obj := range info.Uses {
	if obj == target { report(id) }
}
```

## Bug 11 — reading `info.TypeOf` on an `Invalid` / error package

```go
pkgs, _ := packages.Load(cfg, "./...") // some package has errors
t := pkgs[0].TypesInfo.TypeOf(expr)
fmt.Println(t.Underlying()) // nil pointer panic or "invalid type"
```

**Symptom.** `nil` from `TypeOf`, or `t` is `types.Typ[types.Invalid]`, leading
to a panic when you call methods on it.

**Cause.** When a package fails to type-check, the checker still returns a
*partial* model; expressions involving the error get the `Invalid` basic type or
no entry at all. You forgot to check load errors and nil.

**Fix.** Gate on errors and skip invalid types.

```go
if packages.PrintErrors(pkgs) > 0 { return }
t := info.TypeOf(expr)
if t == nil || t == types.Typ[types.Invalid] { return }
```

## Bug 12 — `Interface` queried before `Complete()`

```go
iface := types.NewInterfaceType(methods, embeddeds) // not completed
fmt.Println(iface.NumMethods()) // may not include embedded methods
types.Implements(T, iface)      // unreliable
```

**Symptom.** Method-set / `Implements` queries on a hand-built interface miss
methods promoted from embedded interfaces.

**Cause.** A freshly constructed `*Interface` hasn't computed its full method set
until `Complete()` runs. (Interfaces produced by the checker are already
complete; only ones you build need this.)

**Fix.**

```go
iface := types.NewInterfaceType(methods, embeddeds)
iface.Complete()
```

## Bug 13 — mixing importers, so cross-package types aren't identical

```go
impA := importer.Default()
impB := importer.Default()
pkgFoo, _ := types.Config{Importer: impA}.Check("foo", fset, fooFiles, infoFoo)
pkgBar, _ := types.Config{Importer: impB}.Check("bar", fset, barFiles, infoBar)
// foo.Reader and bar.Reader (both io.Reader) compare non-identical
```

**Symptom.** Two references to the same `io.Reader` from two packages fail
`types.Identical`, breaking dedup / assignability checks across packages.

**Cause.** Each importer instance builds its *own* `*types.Package` for `io`, so
`io.Reader` is two different pointers with two different (but structurally equal)
types — and `Named` types are compared by identity of their `*TypeName`.

**Fix.** Share **one** importer across all packages, or use `packages.Load`,
which guarantees a single consistent type universe.

```go
imp := importer.Default()
cfgFoo := types.Config{Importer: imp}
cfgBar := types.Config{Importer: imp}
```

## Bug 14 — assuming `AssignableTo` covers conversions

```go
// "can the user write target(x)?"
if types.AssignableTo(srcType, dstType) {
	suggestConversion()
}
```

**Symptom.** The tool fails to offer a valid conversion like `int64(x)` from an
`int`, because `AssignableTo(int, int64)` is `false`.

**Cause.** Assignability is *narrower* than convertibility. `int` is convertible
to `int64` but not assignable to it.

**Fix.** Use the right predicate for the question.

```go
if types.ConvertibleTo(srcType, dstType) { suggestConversion() }
if types.AssignableTo(srcType, dstType)  { directAssignmentOK() }
```

## Bonus — untyped nil in a type switch loses its type

```go
func describe(x any) {
	switch v := x.(type) {
	case nil:
		fmt.Println(v) // v is `any`, not a useful concrete type
	}
}
```

**Symptom (analysis side).** In `info.Types`, the `case nil:` binding's type is
the switch operand's static type, not a concrete type — tools that assume each
type-switch case narrows to a concrete type mishandle the `nil` case.

**Cause.** `nil` is not a type; the `nil` case matches absence of a dynamic
type, so the implicit binding keeps the operand's interface type. The implicit
object is recorded in `Info.Implicits`, not as a normal `Defs` entry.

**Fix.** Special-case `nil`; read per-case implicit objects from
`info.Implicits[caseClause]` and skip the `nil` clause when reasoning about
concrete dynamic types.

## Bug 15 — `types.Identical` on structs with different tags

```go
type A struct{ Name string `json:"name"` }
type B struct{ Name string `json:"name_x"` }
// expecting these "shapes" to match for a code-mod
same := types.Identical(structA, structB) // false
```

**Symptom.** Two structs you consider the "same shape" report non-identical, so
a conversion you expected to be legal is rejected.

**Cause.** `types.Identical` treats **struct tags as significant** — two structs
with different tags are *not* identical, which mirrors the language: you cannot
assign between them without a conversion.

**Fix.** Use `types.IdenticalIgnoreTags` when tags shouldn't matter (e.g.
checking convertibility of struct shapes).

```go
same := types.IdenticalIgnoreTags(structA, structB) // true
```

## Bug 16 — assuming `Underlying()` strips named types recursively

```go
type Celsius float64
type Temp Celsius
t := tempType.Underlying() // *Basic float64, NOT Celsius
```

**Symptom.** Code expecting `Temp`'s underlying to be `Celsius` gets `float64`
and a chain-walking algorithm terminates one step early.

**Cause.** `Underlying()` returns the *fully unwound* underlying type in one
step — it is not "the next named type up." The underlying of any defined type is
never itself a defined type.

**Fix.** If you want the *immediate* definition target, that's a different
question — inspect the `*TypeName`'s declaration or use `types.Unalias` for
aliases; don't expect `Underlying()` to step one level.

## Summary

The recurring root causes across these bugs:

- **Setup**: forgotten `Importer` (Bug 1), unallocated `Info` maps (Bug 2),
  mixed packages in one `Check` (Bug 6), build-tag/GOOS skew (Bug 7), error
  packages read blindly (Bug 11), incomplete interfaces (Bug 12), mismatched
  importers (Bug 13).
- **Identity**: `==` instead of `types.Identical` (Bug 3, Bug 13).
- **Method sets**: pointer-receiver satisfaction (Bug 4) — always test `T` *and*
  `*T`.
- **Constants**: untyped overflow and the exactness flag (Bug 5).
- **Generics**: constraint type-set violations (Bug 8), no result-type inference
  (Bug 9).
- **`Info` semantics**: `Defs` vs `Uses` (Bug 10), `Implicits` for type-switch
  `nil` (Bonus).
- **Rules**: assignability ≠ convertibility (Bug 14).

The meta-lesson: ask the API the *exact* question (Identical / AssignableTo /
ConvertibleTo / Implements / Satisfies) rather than re-deriving Go's rules, and
treat importer/loader setup as the part most likely to be silently wrong.

## Further reading

- [`go/types` common mistakes (gotypes tutorial)](https://github.com/golang/example/tree/master/gotypes)
- [`go/types#Identical` vs `==`](https://pkg.go.dev/go/types#Identical)
- [`go/packages` error handling](https://pkg.go.dev/golang.org/x/tools/go/packages#PrintErrors)
- [Go spec: Method sets](https://go.dev/ref/spec#Method_sets)
- [Go spec: Type inference](https://go.dev/ref/spec#Type_inference)
- [`go/constant` exactness flags](https://pkg.go.dev/go/constant#Int64Val)
