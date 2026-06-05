# Type Checking — Middle

At the middle level you stop treating the type checker as a black box that says
yes/no and start using its *outputs* — scopes, objects, the `Info` maps,
assignability/convertibility verdicts, method sets — to build real tooling. This
tier walks through name resolution, the `Info` maps in anger, the difference
between assignability and convertibility, method-set and interface-satisfaction
rules, a working "find all implementers" tool, and constant evaluation.

## 1. Scopes and name resolution

A `*types.Scope` is a lexical block mapping names to `Object`s, chained to its
parent. The chain mirrors the language: `Universe` (built-ins like `int`,
`len`, `nil`) → package scope → file scope (imports live here) → function body →
nested blocks.

```text
Universe
  └─ Package scope        (top-level decls)
       └─ File scope       (per-file imports)
            └─ Func scope   (params, results)
                 └─ Block   (if/for/{} bodies)
```

Name resolution = walk *outward* from the current scope until a name is found
(`Scope.LookupParent`), which is exactly how shadowing works. The checker
records the result so you don't re-implement it:

```go
// Where is this identifier declared, and where is it used?
obj := info.ObjectOf(ident) // = Uses[ident], falling back to Defs[ident]
fmt.Println(obj.Name(), obj.Type(), obj.Pos())

// Walk a scope tree manually:
pkg.Scope().Lookup("Foo")          // top-level object or nil
inner, _ := pkg.Scope().Innermost(pos).LookupParent("x", pos)
```

Key objects (all implement `types.Object`): `*types.Var`, `*types.Const`,
`*types.Func`, `*types.TypeName`, `*types.PkgName`, `*types.Label`,
`*types.Builtin`, `*types.Nil`. An `Object` knows its `Name()`, `Type()`,
`Pkg()`, `Pos()`, and whether it's `Exported()`.

## 2. The `Info` maps in practice

`types.Info` is how the checker reports *everything it learned*. You opt in to
each map by allocating it before `Check`. The full set:

| Map | Key → Value | Use it for |
| --- | --- | --- |
| `Types` | `ast.Expr` → `TypeAndValue` | type & constant value of any expression |
| `Instances` | `*ast.Ident` → `Instance` | type args + result of a generic instantiation |
| `Defs` | `*ast.Ident` → `Object` | the declaring occurrence of a name |
| `Uses` | `*ast.Ident` → `Object` | every referencing occurrence |
| `Implicits` | `ast.Node` → `Object` | implicit objects (e.g. `case T:` in type switch, embedded fields) |
| `Selections` | `*ast.SelectorExpr` → `*Selection` | what `x.f` resolves to (field vs method, indices, indirect) |
| `Scopes` | `ast.Node` → `*Scope` | the scope a node introduces |
| `InitOrder` | `[]*Initializer` | dependency-correct package-var init order |
| `FileVersions` | `*ast.File` → string | per-file Go language version (`//go:build go1.21`) |

`Defs` vs `Uses` is the distinction that powers rename/“find references”:
`Defs[id]` is non-nil only at the *declaring* identifier (and is `nil` for the
blank `_`); `Uses[id]` is set at every *use*. `ObjectOf` unifies them.

`Selections` is the one people forget. For `x.Method()` it tells you whether you
hit a field or method, the index path through embedded structs, and whether an
implicit `&`/`*` (`Indirect()`) was inserted:

```go
sel := info.Selections[selExpr] // *types.Selection
switch sel.Kind() {
case types.FieldVal:    // x.f is a field
case types.MethodVal:   // x.m() bound method value
case types.MethodExpr:  // T.m method expression
}
sel.Obj()      // the field/method object
sel.Index()    // []int path through embeddings
sel.Indirect() // was a pointer indirection needed?
```

## 3. Assignability vs convertibility

These are different rules and tools constantly confuse them.

- **Assignable** (`types.AssignableTo(V, T)`): can a value of `V` be used where a
  `T` is expected *without a conversion* — `var t T = v`, passing an argument,
  returning a value, sending on a channel.
- **Convertible** (`types.ConvertibleTo(V, T)`): is `T(v)` legal. A superset of
  assignability plus explicit conversions (numeric ↔ numeric, `[]byte` ↔
  `string`, pointer ↔ `unsafe.Pointer`, etc.).

```go
intT  := types.Typ[types.Int]
i64T  := types.Typ[types.Int64]
types.AssignableTo(intT, i64T)   // false — different numeric types
types.ConvertibleTo(intT, i64T)  // true  — int64(i) is legal
```

Assignability has subtle cases that are exactly the language rules: identical
types; same underlying type when at least one side isn't a named type; interface
satisfaction; bidirectional/directional channel compatibility; untyped constant
representable in the target; the `nil` exception. When in doubt, **ask the API**
rather than re-deriving the rule — it is the same code the compiler runs.

## 4. Method sets, embedding, interface satisfaction

The method set determines what interfaces a type satisfies.

| Receiver in source | In method set of `T` | In method set of `*T` |
| --- | --- | --- |
| `func (T) M()`  | yes | yes |
| `func (*T) M()` | **no** | yes |

So if any method has a *pointer* receiver, only `*T` satisfies an interface
requiring it. This is the #1 "but it has the method!" bug:

```go
type Stringer interface{ String() string }
type Money struct{}
func (m *Money) String() string { return "$" } // pointer receiver

var _ Stringer = &Money{} // OK
var _ Stringer = Money{}   // COMPILE ERROR: Money does not implement Stringer
                           // (String has pointer receiver)
```

Query it programmatically:

```go
types.NewMethodSet(T)          // *types.MethodSet for a value of T
types.NewMethodSet(types.NewPointer(T))
types.Implements(T, iface)     // does T satisfy iface?
types.Satisfies(T, iface)      // like Implements but honors constraint type-sets
```

**Embedding** promotes methods. If `S` embeds `Reader`, `S`'s method set
includes `Reader`'s methods (the embedded field contributes them, with the
pointer-receiver rule applied at each level). `go/types` resolves all of this;
`Selections` exposes the embedding path via `Index()`.

## 5. A tool that finds implementers

A genuinely useful exercise: given an interface, list every named type in a
package that implements it. This is the core of `gopls`'s "Implementations".

```go
func findImplementers(pkg *types.Package, iface *types.Interface) []types.Type {
	var out []types.Type
	scope := pkg.Scope()
	for _, name := range scope.Names() {
		tn, ok := scope.Lookup(name).(*types.TypeName)
		if !ok {
			continue
		}
		T := tn.Type()
		if types.IsInterface(T) {
			continue // skip interfaces themselves
		}
		// Check both T and *T (pointer method sets differ).
		if types.Implements(T, iface) {
			out = append(out, T)
		} else if pt := types.NewPointer(T); types.Implements(pt, iface) {
			out = append(out, pt)
		}
	}
	return out
}
```

Get the interface to test against from the same package:

```go
obj := pkg.Scope().Lookup("Stringer").(*types.TypeName)
iface := obj.Type().Underlying().(*types.Interface)
iface.Complete() // ensure method set is finalized before querying
```

For cross-package scans, iterate the loaded `[]*packages.Package` (see
`professional.md`) and reuse the same per-type check.

## 6. Constant evaluation

`go/constant` is the arbitrary-precision value engine. The checker uses it to
fold every constant expression *before* type rules apply, which is why
overflow is caught at compile time.

```go
import (
	"go/constant"
	"go/token"
)

x := constant.MakeInt64(7)
y := constant.MakeInt64(2)
constant.BinaryOp(x, token.QUO, y)        // 3   (integer division)
constant.BinaryOp(constant.ToFloat(x), token.QUO, y) // 3.5
constant.Compare(x, token.GTR, y)         // true
constant.Shift(constant.MakeInt64(1), token.SHL, 62)  // 1<<62, exact
```

Kinds are `Bool`, `String`, `Int`, `Float`, `Complex`, `Unknown`.
`constant.Int64Val`/`Uint64Val`/`Float64Val` extract Go values and return an
`exact bool` telling you whether the conversion was lossless — that flag is how
you detect truncation/overflow when a constant lands in a narrow typed slot:

```go
v, exact := constant.Int64Val(big) // exact==false ⇒ does not fit int64
```

From the checker side you read folded values straight out of `Info.Types`:

```go
if tv, ok := info.Types[expr]; ok && tv.Value != nil {
	fmt.Println("constant value:", tv.Value) // already folded
}
```

## 7. Summary

The middle-tier skill is *reading the checker's output*. Scopes and `ObjectOf`
give you resolution and shadowing for free. The `Info` maps — especially `Defs`,
`Uses`, `Selections`, and `Types` — are the data layer for refactoring and
analysis tools. `AssignableTo`/`ConvertibleTo` answer the two distinct
"can this value go there?" questions; `Implements`/`NewMethodSet` plus the
value-vs-pointer method-set rule answer interface questions and explain the
classic pointer-receiver surprise. And `go/constant` is the exact-precision
engine behind constant folding and overflow detection. Build the
find-implementers tool — it touches scopes, objects, method sets, and pointer
receivers all at once.

## Further reading

- [`go/types` API: `Info`](https://pkg.go.dev/go/types#Info)
- [`go/types`: `AssignableTo`, `ConvertibleTo`, `Implements`](https://pkg.go.dev/go/types#AssignableTo)
- [`go/types`: `Selection` & `MethodSet`](https://pkg.go.dev/go/types#Selection)
- [`go/constant` package docs](https://pkg.go.dev/go/constant)
- [golang/example: gotypes tutorial](https://github.com/golang/example/tree/master/gotypes)
- [Go spec: Assignability](https://go.dev/ref/spec#Assignability) · [Method sets](https://go.dev/ref/spec#Method_sets)
- [Source: `src/go/types/methodset.go`](https://github.com/golang/go/blob/master/src/go/types/methodset.go)
