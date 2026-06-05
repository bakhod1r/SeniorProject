# Type Checking — Specification

A reference for the `go/types` API surface, the `Type` hierarchy, and the
language rules the checker enforces. The standard library `go/types` and the
compiler's `cmd/compile/internal/types2` expose parallel APIs; names below are
`go/types` unless noted.

## 1. Driving the checker: `Config`, `Info`, `Checker`

### `types.Config`

```go
type Config struct {
	Context            *Context              // shares instantiations
	GoVersion          string                // e.g. "go1.21"; gates features
	IgnoreFuncBodies   bool                  // type-check signatures only (faster)
	FakeImportC        bool                  // treat `import "C"` as a blank package
	Importer           Importer              // resolves import paths — REQUIRED if imports exist
	Sizes              Sizes                 // platform sizes (StdSizes / SizesFor)
	DisableUnusedImportCheck bool
	Error              func(err error)       // called per error; nil ⇒ stop at first
}
```

Entry points:

| Call | Purpose |
| --- | --- |
| `conf.Check(path, fset, files, info) (*Package, error)` | type-check a package |
| `NewChecker(conf, fset, pkg, info)` then `.Files(files)` | incremental checking |
| `(*Package).Scope()` | top-level object scope |
| `types.Eval(fset, pkg, pos, expr)` | type-check a standalone expression in context |
| `types.CheckExpr(...)` | check an expression against an existing package |

### `types.Info`

```go
type Info struct {
	Types        map[ast.Expr]TypeAndValue
	Instances    map[*ast.Ident]Instance      // generics
	Defs         map[*ast.Ident]Object
	Uses         map[*ast.Ident]Object
	Implicits    map[ast.Node]Object
	Selections   map[*ast.SelectorExpr]*Selection
	Scopes       map[ast.Node]*Scope
	InitOrder    []*Initializer
	FileVersions map[*ast.File]string
}
```

Helpers: `info.TypeOf(expr) Type`, `info.ObjectOf(ident) Object`. Allocate only
the maps you read.

`TypeAndValue` (value of `Types`):

```go
type TypeAndValue struct {
	Type  Type
	Value constant.Value // non-nil iff a constant
}
// predicates: IsValue, IsType, IsBuiltin, IsNil, Addressable, Assignable, HasOk
```

`Instance` (value of `Instances`): `{ TypeArgs *TypeList; Type Type }`.

## 2. The `Type` interface hierarchy

`Type` has exactly two methods: `Underlying() Type` and `String() string`. A
**named** type's `Underlying()` strips the name; a composite literal type returns
itself. Concrete implementations:

| Type | Represents | Key accessors |
| --- | --- | --- |
| `*Basic` | predeclared (`int`, `string`, `untyped int`, `Invalid`…) | `Kind()`, `Info()`, `Name()` |
| `*Named` | defined type (`type T …`) incl. instantiated generics | `Obj()`, `Underlying()`, `NumMethods()`, `Method(i)`, `TypeParams()`, `TypeArgs()`, `Origin()` |
| `*Alias` | type alias (`type A = B`) | `Obj()`, `Rhs()`, `Underlying()` |
| `*Pointer` | `*T` | `Elem()` |
| `*Slice` | `[]T` | `Elem()` |
| `*Array` | `[N]T` | `Elem()`, `Len()` |
| `*Map` | `map[K]V` | `Key()`, `Elem()` |
| `*Chan` | channel | `Dir()`, `Elem()` |
| `*Struct` | struct | `NumFields()`, `Field(i)`, `Tag(i)` |
| `*Tuple` | parameter/result lists (not a real value type) | `Len()`, `At(i)` |
| `*Signature` | func type | `Params()`, `Results()`, `Recv()`, `Variadic()`, `TypeParams()`, `RecvTypeParams()` |
| `*Interface` | interface (methods + type elements) | `NumMethods()`, `Method(i)`, `IsComparable()`, `IsMethodSet()`, `Complete()` |
| `*TypeParam` | a generic type parameter | `Constraint()`, `Index()`, `Obj()` |
| `*Union` | constraint union `A | B` | `Len()`, `Term(i)` |

`*Term` (in a union): `Type()` and `Tilde()` (whether it was `~T`).

Predicates / helpers:

```go
types.Identical(a, b Type) bool        // structural identity — USE THIS, not ==
types.IdenticalIgnoreTags(a, b) bool
types.AssignableTo(V, T) bool
types.ConvertibleTo(V, T) bool
types.Implements(V, *Interface) bool
types.Satisfies(V, *Interface) bool    // constraint satisfaction (type sets)
types.Comparable(T) bool
types.IsInterface(T) bool
types.Default(T) Type                  // default type of an untyped type
types.Unalias(T) Type                  // strip alias wrappers
```

## 3. Assignability rules (spec summary)

A value `x` of type `V` is assignable to type `T` if **any** holds:

1. `V` and `T` are identical (`types.Identical`).
2. `V` and `T` have identical underlying types and at least one of `V`, `T` is
   **not** a named/defined type.
3. `T` is an interface (not a type parameter) and `x` implements `T`.
4. `x` is a bidirectional channel value, `T` is a channel type, they have
   identical element types, and at least one isn't a defined type.
5. `x` is the predeclared `nil` and `T` is a pointer, func, slice, map, channel,
   or interface type.
6. `x` is an untyped constant **representable** by a value of type `T`.

(With type parameters, "implements" generalizes to constraint satisfaction.)

**Convertibility** = assignability ∪ explicit conversions: numeric↔numeric,
`string`↔`[]byte`/`[]rune`, integer→string (rune), pointer↔`unsafe.Pointer`,
identical-underlying defined types, and the slice↔array-pointer conversions.
Query with `ConvertibleTo`.

## 4. Generics: constraints and type sets

- A **constraint** is an interface that may contain **type elements** alongside
  methods. Its **type set** is the set of types satisfying it (`Interface`'s
  internal `typeSet`).
- **Type term** `T`: the single type `T`. **`~T`**: every type whose *underlying*
  type is `T` (`T` must itself be an unnamed/underlying type). **Union**
  `T1 | T2 | …`: set union of the terms.
- Methods in the constraint **intersect** the set: only types in the union that
  also have those methods qualify.
- **`any`** = the empty interface = the set of all types. **`comparable`** = the
  set of all strictly comparable types (special; not expressible as a union).
- A type argument `A` satisfies constraint `C` iff `A` is in `C`'s type set
  *and* `A` implements `C`'s methods. The blanket rule is `types.Satisfies`.
- **Instantiation**: substituting type arguments yields a `*Named` (or
  `*Signature`) whose `Origin()` is the generic and whose `TypeArgs()` are the
  arguments. Memoized per `Context`.
- **Core type**: if all types in a type set share one underlying structure, that
  is the *core type*; constraint type inference uses it to pin parameters.

## 5. Constant kinds (`go/constant`)

```go
type Kind int
const (
	Unknown Kind = iota
	Bool
	String
	Int
	Float
	Complex
)
```

| Operation | Function |
| --- | --- |
| construct | `MakeInt64`, `MakeUint64`, `MakeFloat64`, `MakeString`, `MakeBool`, `MakeImag`, `MakeFromLiteral` |
| arithmetic | `BinaryOp`, `UnaryOp`, `Shift` |
| compare | `Compare` |
| convert kind | `ToInt`, `ToFloat`, `ToComplex` |
| extract | `Int64Val`, `Uint64Val`, `Float64Val`, `BoolVal`, `StringVal` (each returns an `exact` flag where lossy) |
| inspect | `Val`, `BitLen`, `Sign`, `Bytes` |

**Untyped default types** (applied by `types.Default`):

| Untyped kind | Default type |
| --- | --- |
| bool | `bool` |
| rune | `rune` (`int32`) |
| int | `int` |
| float | `float64` |
| complex | `complex128` |
| string | `string` |

A `*Basic` with the `IsUntyped` flag in its `Info()` is an untyped type; the
checker keeps constants untyped (arbitrary precision) until a typed context
forces a default or a target type, then verifies representability.

## Further reading

- [`go/types` API reference](https://pkg.go.dev/go/types)
- [`go/types#Type` and concrete types](https://pkg.go.dev/go/types#Type)
- [`go/constant` reference](https://pkg.go.dev/go/constant)
- [Go spec: Assignability](https://go.dev/ref/spec#Assignability)
- [Go spec: Conversions](https://go.dev/ref/spec#Conversions)
- [Go spec: Type constraints & type sets](https://go.dev/ref/spec#Type_constraints)
- [Go spec: Type inference](https://go.dev/ref/spec#Type_inference)
