# Generic Limitations — Middle Level

## Table of Contents
1. [Methods reuse the receiver's type parameters](#methods-reuse-the-receivers-type-parameters)
2. [Type-switch workarounds in detail](#type-switch-workarounds-in-detail)
3. [No parameterized type aliases before 1.24](#no-parameterized-type-aliases-before-124)
4. [No predeclared functions on a bare `T`](#no-predeclared-functions-on-a-bare-t)
5. [Constraint type inference limits](#constraint-type-inference-limits)
6. [Type identity and instantiation distinctness](#type-identity-and-instantiation-distinctness)
7. [Constraints in interface values](#constraints-in-interface-values)
8. [Interaction with reflection](#interaction-with-reflection)
9. [Summary](#summary)

---

## Methods reuse the receiver's type parameters

The single most-asked question after "why no method type parameters?" is **what is in scope** inside a method on a generic type. Rule:

> Methods on a parameterized type may use the type parameters declared by the **receiver type**, and **no others**.

```go
type Pair[A, B any] struct{ First A; Second B }

// OK — uses A, B from the receiver
func (p Pair[A, B]) Swap() Pair[B, A] {
    return Pair[B, A]{First: p.Second, Second: p.First}
}

// OK — only uses A
func (p Pair[A, B]) FirstOnly() A { return p.First }

// REFUSED — declares new C
func (p Pair[A, B]) WithThird[C any](c C) (A, B, C) { // compile error
    return p.First, p.Second, c
}
```

### Why is this even a limit?

When generics were proposed, the team made a careful trade-off:

1. **Implementation simplicity** — method type parameters force the runtime to track per-method type info, complicating reflection, devirtualization, and the dictionary mechanism.
2. **API stability** — methods are part of an interface's signature; adding type parameters opens the door to interfaces with parameterized methods, which dramatically grows the type system.
3. **Confusion** — "is `Map` a method of `Box` or a method that takes a `Box`?" is easier to answer when methods cannot have their own params.

The accepted proposal (43651) deliberately did not include method type parameters. Proposal **47781** revisited the question and was kept open for years before being closed without action.

### The free-function workaround in practice

```go
type Stack[T any] struct{ data []T }
func (s *Stack[T]) Push(v T)       { s.data = append(s.data, v) }
func (s *Stack[T]) Pop() (T, bool) { /* ... */ }

// Want: s.Map(func(T) U) → Stack[U]
// Cannot. Use a free function:

func MapStack[T, U any](s *Stack[T], f func(T) U) *Stack[U] {
    out := &Stack[U]{data: make([]U, len(s.data))}
    for i, v := range s.data { out.data[i] = f(v) }
    return out
}
```

Call site:

```go
s := &Stack[int]{}
s.Push(1); s.Push(2)
strs := MapStack(s, strconv.Itoa) // *Stack[string]
```

The chain `s.Push(1).Push(2).Map(...)` is impossible. Some teams build a **fluent builder** that returns `interface{}` to keep the chain — but that throws away type safety. The boring free-function form is the idiomatic answer.

### Interface methods cannot have type parameters either

```go
type Mapper[T any] interface {
    Map[U any](f func(T) U) Mapper[U] // ❌
}
```

Same rule from the interface side. Build a free function `Map[T, U any](m Mapper[T], f func(T) U) Mapper[U]` instead.

---

## Type-switch workarounds in detail

The compile error you see when you try `v.(type)` on a generic `T`:

```
cannot use type switch on type parameter value v (variable of type T)
```

### Why the rule exists

A type switch needs a **runtime type tag** — the dynamic type stored alongside an interface value. A bare `T` has no such tag; once instantiated, `T` is just bytes of a known size, with no header.

Funneling through `any` puts the bytes back into a `(type, data)` interface header, which the type switch can then inspect:

```go
func Describe[T any](v T) string {
    switch x := any(v).(type) {
    case int:    return fmt.Sprintf("int %d", x)
    case string: return "str " + x
    default:     return "other"
    }
}
```

### The cost of the workaround

`any(v)` is a conversion to `interface{}`:

| Type of `T` | Cost of `any(v)` |
|-------------|-------------------|
| pointer-shaped | ~1 ns, no allocation |
| `int`, `int64` | ~1-2 ns, possibly inlined to a single store |
| larger struct | possible heap allocation |

For tight loops, this matters. Mitigations:

- Pull the switch out of the loop if you can
- Specialize per type at the call site
- Use an interface with virtual methods if behaviour really differs per type

### When the workaround is the wrong tool

If you are switching on type to do **fundamentally different** work:

```go
func Handle[T any](v T) error {
    switch x := any(v).(type) {
    case *Order:    return processOrder(x)
    case *Refund:   return processRefund(x)
    case *Cancel:   return processCancel(x)
    default:        return fmt.Errorf("unknown")
    }
}
```

You have **polymorphism**, not parameterism. The right shape is:

```go
type Event interface { Process() error }
type Order struct{...}
func (o *Order) Process() error { ... }
type Refund struct{...}
func (r *Refund) Process() error { ... }
// etc.

func Handle(v Event) error { return v.Process() }
```

The interface is shorter, faster (devirtualizable), and self-documenting.

### When the workaround is OK

A common legitimate use is **safe formatting**:

```go
func Quote[T any](v T) string {
    switch x := any(v).(type) {
    case string: return "\"" + x + "\""
    case fmt.Stringer: return x.String()
    default: return fmt.Sprintf("%v", v)
    }
}
```

The function still works for any `T`, with a special case for `string`. The dispatch happens once per call, not per inner-loop iteration.

---

## No parameterized type aliases before 1.24

Until **Go 1.24** (February 2025), this was rejected:

```go
type Vec[T any] = []T // pre-1.24: compile error
```

A type alias (`type A = B`) could not have type parameters. The reason was implementation: aliases share the underlying type's identity, and adding type parameters introduced edge cases in the type system that took multiple releases to design correctly.

The old workaround was a **type definition** instead of an alias:

```go
type Vec[T any] []T // OK in 1.18+
```

But this is a **defined type**, not an alias. Distinct identity, distinct method set. The two are not interchangeable.

### The 1.24 fix

Proposal **46477** ("Generic type aliases") was accepted and shipped in 1.24:

```go
type Vec[T any] = []T // 1.24+: OK

func Sum[T int | float64](v Vec[T]) T { /* ... */ }
```

For the full story of why it took so long and what changed, see [`14-generic-type-aliases`](../14-generic-type-aliases/junior.md).

### What this section is NOT about

We mention generic type aliases here only to **point at** the limit. Detailed treatment lives in chapter 14 to keep this file focused on compile-time refusals that remain in modern Go.

---

## No predeclared functions on a bare `T`

You cannot call `len`, `cap`, `make`, `new` on a value whose type is a bare type parameter:

```go
func Length[T any](v T) int { return len(v) } // ❌
```

The compiler refuses because `T` may be a type for which `len` is not defined (e.g., `int`).

To make `len` legal you need a constraint that **guarantees** the operation:

```go
type HasLen interface { ~string | ~[]byte | ~[]int /* ... */ }
func Length[T HasLen](v T) int { return len(v) } // OK
```

Or the very common slice-element constraint:

```go
func Length[E any, S ~[]E](s S) int { return len(s) }
```

`make` and `new` follow the same rule:

```go
func Box[T any](v T) *T {
    return new(T) // OK — new(T) is allowed for any T
}

func Buffer[T any]() T {
    return make(T) // ❌ — T might not be a slice/map/chan
}
```

`new(T)` is legal because it does not require any per-type knowledge — just allocate sizeof(T) bytes. `make(T)` is rejected because make's behaviour depends on T's kind (slice vs map vs chan).

---

## Constraint type inference limits

The compiler infers type arguments from function arguments. It does **not** infer:

1. **From the return type**:
   ```go
   func Cast[T any](v any) T { return v.(T) }
   x := Cast(7) // T cannot be inferred — must write Cast[int](7)
   ```

2. **From a struct literal alone**:
   ```go
   type Box[T any] struct{ V T }
   b := Box{V: 7} // pre-1.21: refused; 1.21+: inferred
   ```
   Even after 1.21's improvements, complex literals may need explicit instantiation.

3. **From method type parameters** (because they don't exist).

### Practical consequences

If you write a generic function whose only use of `T` is in the return type, callers must always instantiate manually. This pushes the API toward returning concrete types or accepting the manual instantiation as a feature, not a bug.

```go
// Caller-friendly: T appears in arguments
func Pair[T any](a, b T) (T, T) { return a, b }

// Caller-hostile: T only in return
func Zero[T any]() T { var z T; return z }
// Use as: Zero[int]()
```

---

## Type identity and instantiation distinctness

Two instantiations of the same generic type are **distinct types**:

```go
type Box[T any] struct{ V T }

var a Box[int]
var b Box[int32]
// a == b → not a comparison, a compile error
// a = b → not assignable
```

Even when the underlying memory layout would happen to match (e.g., `Box[int]` and `Box[int64]` on a 64-bit system), the type system treats them as unrelated.

This rule makes `*Box[int]` and `*Box[int64]` unrelated too. There is **no implicit conversion**.

### Conversion via explicit constructor

If you need to "rebrand" an instance, write a constructor:

```go
func RetypeBox[T, U any](b Box[T], conv func(T) U) Box[U] {
    return Box[U]{V: conv(b.V)}
}
```

This is once again a free function, not a method.

---

## Constraints in interface values

A constraint is an interface, but **some constraints cannot be used as ordinary interface types**:

```go
type Number interface { ~int | ~float64 }

var n Number = 3 // refused — Number has type elements
```

An interface containing **type elements** (`~int`, `int | string`) can be used **only** as a constraint, not as a runtime variable. The compiler enforces this distinction.

`comparable` is similarly special:

```go
var c comparable = 3 // pre-1.20: refused; 1.20+: allowed but with caveats
```

Pre-1.20 you could not use `comparable` as a regular interface value. Go 1.20 relaxed this — interface types now satisfy `comparable`, with a runtime panic possibility if the dynamic types are not actually comparable.

### Cross-link

For the full story on `comparable`'s evolution, see [`13-comparable-and-ordered`](../13-comparable-and-ordered/junior.md).

---

## Interaction with reflection

Reflection works on the **instantiated** type, not on `T`:

```go
import "reflect"

func TypeName[T any](v T) string {
    return reflect.TypeOf(v).String()
}

TypeName(7)        // "int"
TypeName("hi")     // "string"
TypeName[int](0)   // "int"
```

But this has limits:

1. **A nil typed pointer** still has a type:
   ```go
   var p *int
   TypeName(p) // "*int" — works
   ```
2. **An untyped nil cannot be passed** to a generic of unconstrained `T` because the compiler cannot infer `T`.
3. **`reflect.TypeOf((*T)(nil))`** is the canonical way to get a type without a value:
   ```go
   func ReflectType[T any]() reflect.Type {
       return reflect.TypeOf((*T)(nil)).Elem()
   }
   ```

Reflection is the trapdoor for any generic algorithm that **must** know the type — but it loses the compile-time guarantees generics gave you. Use it sparingly.

---

## Summary

The middle-level view of generic limitations highlights **why** each compile-time refusal exists and **how** to live with it:

1. **Methods reuse only the receiver's type parameters.** Free functions are the idiomatic workaround, with no performance cost.
2. **Type-switch on `T` requires `any(v)`** because `T` has no runtime header. The workaround reintroduces boxing, so use it at boundaries, not inside hot loops.
3. **Generic type aliases** were rejected until Go 1.24. Use type definitions in older code; cross-link to chapter 14 for details.
4. **Predeclared `len`/`cap`/`make`** on bare `T` requires an explicit constraint that guarantees the operation.
5. **Type inference** does not look at return types or method type parameters.
6. **Each instantiation is a distinct type.** Convert explicitly when you need a different element type.
7. **Constraints with type elements** cannot be used as runtime interface values.
8. **Reflection** is the escape hatch when the limits bind, but trades compile-time safety for runtime flexibility.

The senior file (`senior.md`) zooms further out: when the limits push your design toward higher-kinded types, specialization, or SFINAE-style overloading — features Go does not have at all.
