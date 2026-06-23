# Method Sets Deep — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Addressability Formalised](#addressability-formalised)
3. [Why Map Elements Are Special](#why-map-elements-are-special)
4. [Interface Boxing Strips Addressability](#interface-boxing-strips-addressability)
5. [Type Assertion Returns a Copy](#type-assertion-returns-a-copy)
6. [Composite-Literal Addressing](#composite-literal-addressing)
7. [Embedding — T vs *T](#embedding-t-vs-t)
8. [Promoted Method Sets in Detail](#promoted-method-sets-in-detail)
9. [The Loop Variable Change in Go 1.22](#the-loop-variable-change-in-go-122)
10. [Function Return Values and Method Calls](#function-return-values-and-method-calls)
11. [Patterns and Anti-Patterns](#patterns-and-anti-patterns)
12. [Diagnosing "Does Not Implement" Errors](#diagnosing-does-not-implement-errors)
13. [Code Review Checklist](#code-review-checklist)
14. [Test](#test)
15. [Cheat Sheet](#cheat-sheet)
16. [Summary](#summary)

---

## Introduction

At the junior level you learned **what** the method set rule is and that map elements are not addressable. At the middle level we go deeper:

- The exact list of addressable expressions in the Go spec
- Why the rule for map elements exists (rehashing implications)
- What interface boxing does internally and why it removes addressability
- Embedding by value versus by pointer and the resulting outer method sets
- Go 1.22's per-iteration `for`-loop variable and the behaviour of method values created in loops

Every example in this file compiles and runs. Where two outputs are possible (Go 1.21 vs 1.22), both are shown.

---

## Addressability Formalised

The Go spec defines addressability in §[Address operators](https://go.dev/ref/spec#Address_operators):

> The operand must be **addressable**, that is, either a variable, pointer indirection, or slice indexing operation; or a field selector of an addressable struct operand; or an array indexing operation of an addressable array. As an exception to the addressability requirement, `x` may also be a (possibly parenthesized) **composite literal**.

Translated to a checklist, you may take `&x` when `x` is one of:

| Expression form | Addressable? |
|-----------------|--------------|
| `v` (variable)  | yes |
| `*p` (deref of pointer) | yes |
| `s[i]` (slice index) | yes |
| `a[i]` (array index, if `a` addressable) | yes |
| `s.f` (field, if `s` addressable) | yes |
| `T{...}` (composite literal) | **yes** (special-cased for `&`) |
| `m[k]` (map index) | **no** |
| `f()` (function return) | no |
| `i.(T)` (type assertion result) | no |
| `i.field` when `i` is interface | no |

The same list governs whether the compiler can implicitly take `&` to satisfy a pointer-receiver method call. So `b.Inc()` rewrites to `(&b).Inc()` only when `b` is in one of the "yes" rows above.

---

## Why Map Elements Are Special

Map values are stored in **buckets** by a hash of the key. When the map grows past a load-factor threshold, Go re-allocates the bucket array and re-distributes all entries. Any pointer that pointed to the old bucket would now be stale.

```go
m := map[string]int{}
// p := &m["k"]   // hypothetical — would be invalidated by m["other"] = ...
```

Because the address can move, Go forbids `&m[k]` entirely. Pointer-receiver methods need an address, so:

```go
type C struct{ n int }
func (c *C) Inc() { c.n++ }

m := map[string]C{"a": {}}
m["a"].Inc()        // ❌ cannot take address of m["a"]
```

The three workarounds are:

```go
// 1. Read-modify-write
v := m["a"]; v.Inc(); m["a"] = v

// 2. Store pointers
mp := map[string]*C{"a": new(C)}
mp["a"].Inc()       // OK

// 3. Use sync.Map for shared mutable state (different API)
```

Note: **slice elements are addressable** because the underlying array does not move silently — the slice header's data pointer is fixed for the lifetime of that slice header.

```go
s := []C{{}}
s[0].Inc()          // OK — addressable
```

---

## Interface Boxing Strips Addressability

When you write `var i I = v`, Go performs **interface boxing**: it copies `v` into a heap-allocated cell and stores `(typeDescriptor, *cell)` in `i`'s two-word interface header. The cell itself has an address, but the **language** does not let you reach in:

```go
var i fmt.Stringer = MyType{}
// &i.field        // cannot — i has no fields, just a header
// &(i.(MyType))   // cannot — assertion result is not addressable
```

Therefore:

```go
type X struct{}
func (x *X) String() string { return "x" }

var i fmt.Stringer = X{}    // ❌ — *X.String not in X's method set
var i fmt.Stringer = &X{}   // ✅
```

Even though Go *could* internally allocate an `X` on the heap and call `String()` through its address, the compiler refuses because:
- Subsequent calls would silently mutate the hidden boxed copy, not anything the user can see.
- The interface satisfaction would depend on the box being heap-allocated, which couples the language to the implementation.

So the rule is: **only `T`'s method set may be used to satisfy interfaces from `T` values; `*T`'s method set requires you provide a pointer**.

---

## Type Assertion Returns a Copy

Type assertion `i.(T)` returns a **non-addressable copy**:

```go
type C struct{ n int }
func (c *C) Inc() { c.n++ }

var i any = C{n: 1}
// i.(C).Inc()   // compile error — assertion result not addressable
```

To mutate, use a pointer assertion:

```go
var i any = &C{n: 1}
i.(*C).Inc()      // OK — *C is addressable as a pointer
```

This is why **interfaces should be designed in terms of `*T`** when mutation is required, and concrete values should be stored as pointers when handed to interface-accepting code.

---

## Composite-Literal Addressing

The spec carves out a small **exception**: the address-of operator may be applied to a composite literal even though it isn't a "variable":

```go
p := &Point{X: 1, Y: 2}    // OK — special case in the spec
```

But this exception is **only for the explicit `&`**. The implicit auto-address in method calls does NOT apply to composite literals:

```go
type C struct{ n int }
func (c *C) Inc() { c.n++ }

C{}.Inc()        // ❌ — composite literal not addressable for method call
(&C{}).Inc()     // ✅ — explicit & uses the spec exception
```

So when you have a one-shot temporary that needs a pointer-method call, write `&` explicitly.

---

## Embedding — T vs *T

Given:

```go
type Logger struct{ prefix string }
func (l Logger)  Info(s string)  { fmt.Println(l.prefix, "info:", s) }
func (l *Logger) SetPrefix(p string) { l.prefix = p }
```

### Embedding by value: `struct{ Logger }`

```go
type Service struct{ Logger }
```

Method set of `Service` (value):
- `Info` from `Logger`'s value-receiver methods
- `SetPrefix` from `*Logger`'s methods — **only if** the outer `Service` is addressable (so the compiler can synthesize `&service.Logger`)

Method set of `*Service`:
- `Info` and `SetPrefix` both — pointer always allows reaching the embedded field.

### Embedding by pointer: `struct{ *Logger }`

```go
type Service struct{ *Logger }
```

Method set of `Service` (value):
- `Info` and `SetPrefix` both — because the embedded *Logger is itself a pointer, so `(*Logger).SetPrefix` can be called without taking another address.

So **`struct{ *T }` propagates the full method set even on outer values**. This matters when you return a `Service` value from a function (not addressable in the call site) and want full method-set coverage.

| Embedding | Outer is `T` (value) | Outer is `*T` |
|-----------|----------------------|---------------|
| `struct{ T }` | T's value methods only | T's value methods + *T's methods |
| `struct{ *T }` | T's value methods + *T's methods | same |

### Practical consequence

```go
func newService() Service { return Service{} }

// With struct{ Logger }
newService().SetPrefix("x")    // ❌ return value not addressable

// With struct{ *Logger }
type Service struct{ *Logger }
func newService() Service { return Service{Logger: &Logger{}} }
newService().SetPrefix("x")    // ✅ works
```

---

## Promoted Method Sets in Detail

### Conflict resolution

If two embedded types both supply a method `M`, the outer struct's method set has **no** `M` (ambiguous). You must explicitly pick:

```go
type A struct{}; func (A) M() string { return "A" }
type B struct{}; func (B) M() string { return "B" }

type C struct{ A; B }

var c C
// c.M()       // compile error — ambiguous selector
c.A.M()        // OK
c.B.M()        // OK
```

A method declared on the outer struct itself **shadows** any promoted method:

```go
type C struct{ A; B }
func (c C) M() string { return "C wins" }

var c C
c.M()          // "C wins"
```

### Depth-first promotion

Promotion considers **shallower** embeddings first. If `A` embeds `B` which has `M`, and `C` embeds `A` and also `B` directly, then `C.B.M` is shallower than `C.A.B.M` and wins:

```go
type Inner struct{}
func (Inner) M() string { return "inner" }

type Mid struct{ Inner }

type Outer struct {
    Inner   // depth 1
    Mid     // depth 1, contains Inner at depth 2
}

var o Outer
o.M()        // ambiguous — both at depth 1
```

But:

```go
type Outer struct {
    Mid     // depth 1, Inner at depth 2
}

var o Outer
o.M()        // OK — Inner.M promoted via Mid
```

---

## The Loop Variable Change in Go 1.22

Before Go 1.22, the loop variable was **reused** across iterations:

```go
type T struct{ n int }
func (t *T) Show() { fmt.Println(t.n) }

ts := []T{{1}, {2}, {3}}
fns := []func(){}
for _, t := range ts {     // t is one variable, reused
    fns = append(fns, t.Show)   // method value binds &t
}
for _, f := range fns { f() }
```

**Go 1.21 output:** `3 3 3` (every method value bound to the same `t`, which finished as the last element).

**Go 1.22 output:** `1 2 3` (each iteration creates a fresh `t`, so each method value binds to its own).

This change directly affects method values created inside loops. The fix that worked everywhere — `t := t` to shadow — is no longer needed in 1.22+ but remains harmless. To check your module's behaviour, look at `go.mod`:

```
go 1.22
```

If the line says `go 1.22` or higher, the new semantics apply.

### Implication for method sets

The method value's bound receiver is **the addressable iteration variable**. In Go 1.21 that variable's address survives across iterations (one address, three values written into it sequentially). In Go 1.22 each iteration has its own variable with its own address. The method set rules are identical in both — what changes is *which* specific value the receiver pointer points at when you finally invoke the method.

```go
// Both versions: t.Show is a method value of type func()
// Go 1.21: all three method values share the same &t
// Go 1.22: each method value has its own &t
```

---

## Function Return Values and Method Calls

A return value that has not been assigned is **not addressable**:

```go
func newC() C { return C{} }

newC().Inc()    // ❌ — return value not addressable for pointer method
```

Two fixes:

```go
c := newC(); c.Inc()              // store in a variable

// Or return a pointer
func newC() *C { return &C{} }
newC().Inc()                      // OK — *C
```

Constructors in Go conventionally return `*T` precisely because of this rule.

---

## Patterns and Anti-Patterns

### Pattern: Compile-time interface satisfaction check

```go
var _ Doer = (*Job)(nil)   // satisfies if *Job implements Doer
```

If the assertion fails to compile, you get an early error rather than a runtime surprise.

### Pattern: Pointer storage for shared mutable values

```go
players := map[string]*Player{}
players["alice"] = &Player{}
players["alice"].Score += 10    // OK — *Player is addressable
```

### Anti-pattern: `m[k].M()` followed by silent no-op

```go
type Cell struct{ value int }
func (c *Cell) Set(v int) { c.value = v }

m := map[string]Cell{"a": {}}
// m["a"].Set(5)   // either compile error, or, with map[string]*Cell, would work
```

If you don't see the error and silently use a value receiver, you'll find your "set" had no effect. Always check the receiver kind when designing map-based stores.

### Anti-pattern: Embedding a value type that holds a mutex

```go
type Locker struct{ sync.Mutex }
type Service struct{ Locker }   // ❌ — Service copies will copy the Mutex
```

`go vet` flags this. Embed `*Locker` instead, or store the mutex on the outer struct directly.

---

## Diagnosing "Does Not Implement" Errors

Common diagnostic message:

```
cannot use x (type X) as type I in assignment:
    X does not implement I (M method has pointer receiver)
```

Five-step debug:

1. **Read the diagnostic literally**. The compiler tells you which method is missing and why.
2. **Check the receiver kind** on the offending method. Pointer? Value?
3. **Check what you're assigning**: is it `T` or `*T`?
4. **If it's a map element**: change to `map[K]*V` or use read-modify-write before the assignment.
5. **If it's a function return**: store in a local, then assign.

```go
// Original
var i I = newC()

// Step 1: try storing
c := newC()
var i I = &c
```

---

## Code Review Checklist

- [ ] Receiver kinds are consistent across all methods of a type
- [ ] Mutating methods use pointer receivers
- [ ] Types containing `sync.Mutex`/`atomic.*` use pointer receivers everywhere
- [ ] Map values that need pointer-method calls are stored as `map[K]*V`
- [ ] Constructors return `*T` if any methods on `T` are pointer-receiver
- [ ] `var _ I = (*T)(nil)` assertions guard public interface satisfaction
- [ ] Embedded types holding state use `*T` embedding (not `T`)
- [ ] Loop body that calls method values is reviewed against the module's Go version

---

## Test

### 1. Which of these are addressable?
```go
var v Box
m := map[string]Box{}
s := []Box{{}}
```
- a) only `v`
- b) `v` and `s[0]`
- c) `v`, `m["k"]`, and `s[0]`
- d) all three

**Answer: b**

### 2. What does the compiler do with `b.Inc()` (`Inc` is `*Box`-receiver, `b` is `Box` variable)?
- a) Compile error
- b) Auto-rewrites to `(&b).Inc()`
- c) Auto-rewrites to `(*b).Inc()`
- d) Calls a copy

**Answer: b**

### 3. Why does `var i I = T{}` fail when `I.M` is `*T`-receiver?
- a) Interface assignment is always strict
- b) The boxed value is not addressable
- c) Type assertion would fail
- d) Performance reasons

**Answer: b**

### 4. In Go 1.22, three method values created in a `for _, x := range` loop bind to:
- a) The same `x` (last value)
- b) Three separate `x` variables
- c) The slice header
- d) `nil`

**Answer: b**

### 5. `struct{ *Logger }` embedding propagates `*Logger`'s method set onto:
- a) Only `*Service`
- b) Only `Service` (value)
- c) Both `Service` and `*Service`
- d) Neither

**Answer: c**

---

## Cheat Sheet

```
ADDRESSABLE EXPRESSIONS
─────────────────────────────
v               variable
*p              pointer dereference
s[i]            slice index (NOT array element of non-addressable array)
struct.f        when struct is addressable
&T{...}         composite literal — special spec exception

NOT ADDRESSABLE
─────────────────────────────
m[k]            map element (rehashing)
i.(T)           type assertion result
fn()            function return value
T{}.field       composite literal field (without &)
i.field         field through interface

INTERFACE SATISFACTION
─────────────────────────────
T  satisfies I  iff I's methods ⊆ T's value methods
*T satisfies I  iff I's methods ⊆ {value methods ∪ *T methods}

EMBEDDING
─────────────────────────────
struct{ T  }  outer T value: only T's value methods reachable for *T methods if addressable
struct{ *T }  outer T value: full T+*T method set reachable

GO 1.22 LOOP VARIABLES
─────────────────────────────
for _, x := range ...   // x is per-iteration in 1.22; shared in <=1.21
go.mod's `go 1.22`+ enables new semantics
```

---

## Summary

The middle-level view of method sets is built on **three pillars**:

1. **Addressability**: a precise spec-defined property that determines whether `&` may be taken — and, by extension, whether a pointer-receiver method can be called on a value.
2. **Interface boxing**: assigning a value to an interface copies it into a non-addressable cell, which is why `T{}` cannot satisfy interfaces requiring `*T` methods.
3. **Embedding propagation**: the outer struct's method set depends on whether the embedded field is `T` or `*T`, and on whether the outer is itself addressable.

Add Go 1.22's per-iteration loop variable, and you have all the tools to read and write idiomatic, bug-free code that interacts with interfaces. The senior level applies these tools to architectural decisions: dispatch tables, decorator chains, and large-scale interface contracts.
