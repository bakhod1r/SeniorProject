# Method Sets Deep — Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) — §Method_sets, §Address_operators, §Selectors, §Calls, §Index_expressions, §For_statements

---

## Table of Contents

1. [Spec Reference](#1-spec-reference)
2. [Formal Grammar (EBNF)](#2-formal-grammar-ebnf)
3. [Method Set Definition](#3-method-set-definition)
4. [Addressability Rules](#4-addressability-rules)
5. [Map Element Non-Addressability](#5-map-element-non-addressability)
6. [Selector and Auto-Address Rules](#6-selector-and-auto-address-rules)
7. [Embedding and Promoted Method Sets](#7-embedding-and-promoted-method-sets)
8. [Interface Satisfaction Rules](#8-interface-satisfaction-rules)
9. [For-Range Loop Variable Semantics (Go 1.22)](#9-for-range-loop-variable-semantics-go-122)
10. [Edge Cases from Spec](#10-edge-cases-from-spec)
11. [Spec Compliance Checklist](#11-spec-compliance-checklist)

---

## 1. Spec Reference

### Method Sets — Official Text

> The method set of a type determines the interfaces that the type implements.
> The **method set of a defined type T** consists of all methods declared with
> receiver type T.
> The **method set of a pointer to a defined type T** (where T is neither a
> pointer nor an interface) is the set of all methods declared with receiver
> *T or T.
> Further rules apply to structs containing **embedded fields**, as described
> in the section on struct types.
> The method set of any other type is empty.

Source: https://go.dev/ref/spec#Method_sets

### Address Operators — Official Text

> The operand must be **addressable**, that is, either a variable, pointer
> indirection, or slice indexing operation; or a field selector of an
> addressable struct operand; or an array indexing operation of an addressable
> array. As an exception to the addressability requirement, x may also be a
> (possibly parenthesized) **composite literal**.

Source: https://go.dev/ref/spec#Address_operators

### Selectors — Official Text

> A selector f may denote a field or method f of type T, or it may refer to a
> field or method f of a nested embedded field of T. The number of embedded
> fields traversed to reach f is called its **depth in T**.
> [...] For a value x of type T or *T where T is not a pointer or interface
> type, x.f denotes the field or method at the shallowest depth in T where
> there is such an f. If there is not exactly one f with shallowest depth,
> the selector expression is illegal.

Source: https://go.dev/ref/spec#Selectors

### Method Call Auto-Address — Official Text

> A method call x.m() is valid if the method set of (the type of) x contains
> m and the argument list can be assigned to the parameter list of m. **If x
> is addressable and &x's method set contains m**, x.m() is shorthand for
> (&x).m().

Source: https://go.dev/ref/spec#Calls

### Map Index Expressions — Official Text

> An index expression on a map a of type map[K]V used in an assignment
> statement or initialization of the special form
> `v, ok = a[x]` ...
> [Map index expressions are not addressable in the spec's definition of
> addressable expressions.]

Source: https://go.dev/ref/spec#Index_expressions

### For Range — Official Text (Go 1.22)

> Each iteration has its own separate **declared** variable (or variables).
> [Behaviour change effective when go.mod specifies `go 1.22` or later.]

Source: https://go.dev/ref/spec#For_range

---

## 2. Formal Grammar (EBNF)

### Address Operator

```ebnf
UnaryExpr  = PrimaryExpr | unary_op UnaryExpr .
unary_op   = "+" | "-" | "!" | "^" | "*" | "&" | "<-" .
```

The grammar accepts `&` on any UnaryExpr; the **type system** then rejects non-addressable operands.

### Selector

```ebnf
Selector = "." identifier .
```

Combined with PrimaryExpr to give `x.f`. The lookup rule (above, in Selectors) governs which `f` is selected.

### Method Set (informal — the spec defines this in prose, not grammar)

Pseudo-rules:

```
methodSet(T)  = { M | M declared with receiver of type T }
methodSet(*T) = { M | M declared with receiver of type T or *T }
methodSet(I) = methods declared in I + methods of embedded interfaces
methodSet(other) = ∅
```

### For-Range Statement

```ebnf
ForStmt    = "for" [ Condition | ForClause | RangeClause ] Block .
RangeClause = [ ExpressionList "=" | IdentifierList ":=" ] "range" Expression .
```

The `:=` form declares fresh per-iteration variables in Go 1.22+ when `go.mod` is at version 1.22+.

---

## 3. Method Set Definition

### Defined types

```go
type T struct{}
func (t T)  V() {}    // value receiver
func (t *T) P() {}    // pointer receiver
```

| Type | Method set |
|------|------------|
| `T`  | `{V}`      |
| `*T` | `{V, P}`   |

### Interface types

The method set of an interface is the set of methods declared in it (plus methods of embedded interfaces).

```go
type I interface { M() }
type J interface { I; N() }
// methodSet(J) = {M, N}
```

### Other types

> The method set of any other type is empty.

This includes:
- Predeclared types (`int`, `string`, `bool`, ...)
- Type aliases (`type X = Y` — methodSet of X equals methodSet of Y)
- Channel/map/slice types not declared as named types

---

## 4. Addressability Rules

Addressable expressions, per the spec:

| Form | Addressable? |
|------|--------------|
| Identifier referring to a variable | yes |
| `*p` | yes |
| `s[i]` (s is a slice) | yes |
| `a[i]` (a is an addressable array) | yes |
| `x.f` (x is addressable struct value) | yes |
| Composite literal `&T{...}` (only with explicit `&`) | yes — special exception |
| Function return value | **no** |
| Map index `m[k]` | **no** |
| Type assertion result `i.(T)` | **no** |
| Constant | **no** |
| Method call result | **no** |
| String index | **no** (immutable bytes) |
| Channel receive `<-c` | **no** |

The exception: `&T{...}` is legal as a primary expression (the spec carves this out in Address operators), but the *value* `T{...}` outside `&` is not addressable for selector or method-call purposes.

```go
&Point{X: 1}.X         // ❌ — Point{}.X is not addressable; & does not save it
(&Point{X: 1}).X       // ✅ — explicit & creates a *Point, then .X via deref
p := &Point{X: 1}
p.X                    // ✅ — *p is addressable
```

---

## 5. Map Element Non-Addressability

The spec explicitly excludes `m[k]` from addressable expressions. The implementation reason:

> The map's underlying hash table may be reallocated when entries are added,
> rendering any saved address stale.

Consequences for method calls:

```go
type T struct{ n int }
func (t *T) Inc() { t.n++ }

m := map[string]T{"k": {}}
m["k"].Inc()   // compile error: cannot take address of m["k"]
```

The compiler's "auto-address" rewrite (`x.m()` → `(&x).m()`) requires `x` addressable. Since `m["k"]` is not addressable, the rewrite fails — and the compile error is the intended outcome.

Workarounds:

```go
// 1. Read-modify-write
v := m["k"]; v.Inc(); m["k"] = v

// 2. Store pointers
m2 := map[string]*T{"k": new(T)}
m2["k"].Inc()    // m2["k"] has type *T, which directly carries Inc
```

The second approach works because the **map element itself** is the pointer value (`*T`), and that pointer value is what gets addressed (or rather, dereferenced) by `Inc`'s body.

---

## 6. Selector and Auto-Address Rules

The selector rule for method calls is:

```
Given x.m() where m has receiver type T or *T:

1. Compute the method set of (type of x).
   - If type is *T or T (where T is not pointer/interface), method set follows
     the rules above.
   - If type is interface I, method set is I's declared methods.

2. If m ∈ methodSet(type of x), call directly.

3. Else if x is addressable AND m ∈ methodSet(*x's type), implicitly take &x:
   x.m() ≡ (&x).m()

4. Else if x is *T and m ∈ methodSet(T), implicitly dereference:
   x.m() ≡ (*x).m()      [always allowed — no addressability needed]

5. Else: compile error.
```

### Auto-dereference is unconditional

```go
type T struct{}
func (t T) M() {}

p := &T{}
p.M()       // OK — p.M() ≡ (*p).M()
```

Always works, no addressability check.

### Auto-address requires addressability

```go
type T struct{}
func (t *T) M() {}

t := T{}    // addressable variable
t.M()       // OK — t.M() ≡ (&t).M()

m := map[string]T{"k": {}}
m["k"].M()  // compile error — m["k"] not addressable
```

---

## 7. Embedding and Promoted Method Sets

Spec text from §[Struct types](https://go.dev/ref/spec#Struct_types):

> A field declared with a type but no explicit field name is called an
> **embedded field**. An embedded field must be specified as a type name T or
> as a pointer to a non-interface type name *T, and T itself may not be a
> pointer type.

### Promotion rules

For a struct `S` with embedded field of type `T`:

1. Methods of `T` (i.e., methodSet(T)) are promoted to S — i.e., `s.M()` is shorthand for `s.T.M()`.
2. If `*T` is embedded (or `S` has an embedded `T` and `s` is addressable), methods of `*T` are also promoted.
3. Method set of `S` (value) = methodSet(T) (always) + methodSet(*T) (only if `S` is itself addressable, computed at the call site)
4. Method set of `*S` = methodSet(T) + methodSet(*T) — always

Pseudo-formulation from §Method sets:

```
For S = struct{ T }:
  methodSet(S)  ⊇ methodSet(T)
  methodSet(*S) = methodSet(T) ∪ methodSet(*T)

For S = struct{ *T }:
  methodSet(S)  = methodSet(T) ∪ methodSet(*T)    // *T embedded, fully addressable
  methodSet(*S) = methodSet(T) ∪ methodSet(*T)
```

### Selector ambiguity

> A selector expression x.f refers to the field or method at the **shallowest
> depth in T** where there is such an f. If there is not exactly one f with
> shallowest depth, the selector expression is illegal.

```go
type A struct{}; func (A) M() {}
type B struct{}; func (B) M() {}
type C struct{ A; B }
var c C
// c.M()    // illegal — both A.M and B.M at depth 1
```

### Shadowing

A method declared on the outer struct shadows any promoted method:

```go
type Inner struct{}
func (Inner) M() string { return "inner" }

type Outer struct{ Inner }
func (Outer) M() string { return "outer" }

var o Outer
o.M()         // "outer" — outer's M shadows Inner.M
```

---

## 8. Interface Satisfaction Rules

A type `T` satisfies interface `I` iff:

```
methodSet(I) ⊆ methodSet(T)
```

For a value-vs-pointer assignment:

```
var i I = v        // requires methodSet(I) ⊆ methodSet(typeof(v))
                   // typeof(v) is T if v is a T variable
                   //          is *T if v is &someT or returned as *T
```

Common consequences:

```go
type Cat struct{}
func (c *Cat) Rename(string) {}

type R interface { Rename(string) }

var _ R = &Cat{}    // OK — methodSet(*Cat) ⊇ {Rename}
var _ R = Cat{}     // ❌ — methodSet(Cat) ⊉ {Rename}
```

### Interface-to-interface assignment

```go
var i I = ...
var j J = i      // requires methodSet(J) ⊆ methodSet(I)
```

The runtime checks this at the assignment point. If it fails, the assignment panics (not a compile error, because `i`'s dynamic type isn't known at compile time).

For the compile-time form (`i.(J)`), the check occurs at the assertion site.

---

## 9. For-Range Loop Variable Semantics (Go 1.22)

Spec change in Go 1.22:

> In a `for ... := range` statement, each iteration has its **own separate
> declared variable** (or variables). The variables created in one iteration do
> not coexist with those of another iteration.

Effective only if `go.mod` declares `go 1.22` or later.

### Pre-1.22 behaviour

```go
for _, x := range xs {
    fns = append(fns, func() { use(x) })   // closes over shared x
}
// All closures see the final value of x
```

### Post-1.22 behaviour

```go
for _, x := range xs {
    fns = append(fns, func() { use(x) })   // closes over per-iteration x
}
// Each closure sees its own x
```

### Method-value implication

A method value `x.M` evaluates the receiver expression at expression time. With value receivers, the receiver value is captured. With pointer receivers, the address of `x` is captured.

```go
for _, x := range xs {
    fns = append(fns, x.M)     // M is *T-receiver; captures &x
}
```

In Go 1.21 and earlier: `&x` is the same address every iteration (the shared `x`). All method values bind the same pointer.

In Go 1.22+: each iteration has its own `x`, hence its own `&x`. Each method value binds a distinct pointer.

The `go.mod` line `go 1.22` is the toggle. Modules at older versions retain old semantics even when built by a newer toolchain.

---

## 10. Edge Cases from Spec

### Edge Case 1 — Composite literal with explicit `&`

```go
p := &Point{X: 1, Y: 2}    // legal — spec exception
```

Without `&`, the composite literal is not addressable for method calls.

### Edge Case 2 — Slice literal element

```go
type T struct{ n int }
func (t *T) M() {}

[]T{{n: 1}}[0].M()      // legal — slice index is addressable
                        // even when the slice itself is anonymous
```

The slice literal is not addressable, but `[]T{...}[0]` (slice indexing) **is**. Subtle distinction.

### Edge Case 3 — Function returning T

```go
func newT() T { return T{} }
newT().M()    // ❌ if M is *T-receiver — return value not addressable
```

The fix: store in a variable, or change `newT` to return `*T`.

### Edge Case 4 — Type assertion is non-addressable

```go
var i any = T{n: 1}
// i.(T).M()    // ❌ — assertion result not addressable
v := i.(T); v.M()    // OK
```

### Edge Case 5 — `nil` map element of pointer type

```go
m := map[string]*T{}
m["k"].M()    // runtime panic — nil pointer
```

Distinct from compile-time error: here the map *element* is addressable (it's a `*T` value), but the pointer itself is nil. Method call dereferences nil and panics.

### Edge Case 6 — Promoted method through nil embedded pointer

```go
type Inner struct{}
func (i *Inner) M() {}
type Outer struct{ *Inner }

var o Outer
o.M()    // panic — o.Inner is nil, M dereferences
```

### Edge Case 7 — Embedded interface field

```go
type Reader interface{ Read([]byte) (int, error) }
type LoggingReader struct{ Reader }   // embedding an interface value

func (lr LoggingReader) Read(p []byte) (int, error) { /* ... */ }
```

The methodSet of `LoggingReader` includes Reader's methods (here overridden by `Read`).

---

## 11. Spec Compliance Checklist

- [ ] Concrete type method set follows: T = value methods only; *T = both
- [ ] Pointer-receiver methods are NOT in methodSet(T)
- [ ] Auto-address `(&x).m()` only happens when x is addressable
- [ ] Map elements `m[k]` are not addressable — pointer-method calls forbidden
- [ ] Type assertion results are not addressable
- [ ] Function return values are not addressable
- [ ] Composite literal addressability requires explicit `&`
- [ ] Embedded field promotion respects depth-first selector rule
- [ ] Ambiguous selector at the same depth is a compile error
- [ ] Interface satisfaction requires methodSet(I) ⊆ methodSet(value-or-pointer)
- [ ] `go.mod` `go 1.22` enables per-iteration loop variables
- [ ] Method values bind the receiver at expression-evaluation time

---

## Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Method sets | https://go.dev/ref/spec#Method_sets | Core method set rules |
| Address operators | https://go.dev/ref/spec#Address_operators | Addressability list |
| Selectors | https://go.dev/ref/spec#Selectors | Field/method selection, depth, ambiguity |
| Calls | https://go.dev/ref/spec#Calls | Auto-address in method calls |
| Index expressions | https://go.dev/ref/spec#Index_expressions | Map element non-addressability |
| Struct types | https://go.dev/ref/spec#Struct_types | Embedded fields, promotion |
| Interface types | https://go.dev/ref/spec#Interface_types | Interface satisfaction |
| For statements | https://go.dev/ref/spec#For_range | Loop variable semantics (Go 1.22) |
| Composite literals | https://go.dev/ref/spec#Composite_literals | The `&T{...}` exception |
| Type identity | https://go.dev/ref/spec#Type_identity | Defined vs alias and method-set inheritance |
