# Generics vs Interfaces — Middle Level

## Table of Contents
1. [Two kinds of polymorphism](#two-kinds-of-polymorphism)
2. [Static vs dynamic dispatch](#static-vs-dynamic-dispatch)
3. [Type-level vs value-level abstraction](#type-level-vs-value-level-abstraction)
4. [Compile-time errors vs runtime errors](#compile-time-errors-vs-runtime-errors)
5. [Memory layout: type parameter vs interface](#memory-layout-type-parameter-vs-interface)
6. [The hidden v-table](#the-hidden-v-table)
7. [Inlining and devirtualization](#inlining-and-devirtualization)
8. [Boxing, escape, and the heap](#boxing-escape-and-the-heap)
9. [Mixed designs: interface as constraint](#mixed-designs-interface-as-constraint)
10. [Summary](#summary)

---

## Two kinds of polymorphism

Computer science distinguishes **parametric polymorphism** from **subtype polymorphism**. Go's two tools map directly onto this split:

| Polymorphism | Go tool | Decided | Heterogeneous? |
|--------------|---------|---------|----------------|
| Parametric | Generics | Compile time | No |
| Subtype | Interfaces | Runtime | Yes |

Parametric means: **the code does not care what the type is**. The same body runs for `int`, `string`, `*User`. The body is **type-agnostic**.

Subtype means: **many concrete types share a name**. Each concrete type behaves differently behind that name. The body is **dispatch-aware**.

A senior interviewer might ask: "Which kind of polymorphism is `slices.Sort`? Which is `io.Reader`?" The answers are parametric and subtype, respectively. Knowing the names helps you reason about why each tool exists.

---

## Static vs dynamic dispatch

### Static dispatch (generics)

```go
func Max[T cmp.Ordered](a, b T) T {
    if a > b { return a }
    return b
}

x := Max(3, 5) // resolved to Max[int] at compile time
```

The compiler picks the body. There is no runtime decision. The CPU executes a direct call into a stenciled body. No table lookups, no type tags.

### Dynamic dispatch (interfaces)

```go
type Notifier interface { Notify(string) error }

func Alert(n Notifier, msg string) error {
    return n.Notify(msg) // resolved at runtime
}

Alert(Email{}, "hi") // runtime: look up Email.Notify in v-table
Alert(Slack{}, "hi") // runtime: look up Slack.Notify in v-table
```

The same line `n.Notify(msg)` runs different code each call. The dispatch happens through a hidden v-table on the interface value.

### Why the distinction matters

| Property | Static (generic) | Dynamic (interface) |
|----------|------------------|---------------------|
| Inline-able | Often yes | Rarely |
| Branch predictable | Yes | Misses common |
| CPU cache | Friendly | Hostile (indirect call) |
| Reflection-needed | Sometimes | Almost never |
| Hot loops | Preferred | Slow |

A function called millions of times per second prefers static dispatch. A function called once per request to pick a backend prefers dynamic dispatch. Both styles are correct in their place.

---

## Type-level vs value-level abstraction

### Type-level (generics)

The abstraction lives at the **type** layer. After instantiation, the function works on a concrete type as if it had been written by hand:

```go
func Find[T comparable](s []T, target T) int { ... }
Find([]int{1,2,3}, 2) // becomes Find[int](...)
```

There is no value-level "interface" carrying the type. The type was substituted, end of story.

### Value-level (interfaces)

The abstraction lives at the **value** layer. The interface value itself remembers what it is:

```go
var r io.Reader = file
r.Read(buf) // r still knows it is *os.File at runtime
```

The runtime cost is real but small. The flexibility is huge — you can store interface values in slices, maps, channels, return them from functions, store them in fields. None of that is possible with a type parameter that has been substituted away.

### Practical consequence

If your design needs to **store** the abstract thing somewhere — a slice, a config field, a registry, a plugin map — interfaces are the only option. Generics cannot do that, because by the time the value is stored, the type has been concretised.

```go
// You cannot do this:
var registry []func[T any](T)  // illegal — generics are not first-class values

// You can do this:
var registry []func(any)        // works, but `any` boxes
var registry []SomeInterface    // best when each element has methods
```

---

## Compile-time errors vs runtime errors

### Wrong-type call: generic vs interface

```go
// Generic: caught at compile time
func Contains[T comparable](s []T, target T) bool { ... }
Contains([]int{1,2,3}, "1") // compile error

// Interface (any): caught at runtime — sometimes never
func Contains(s []any, target any) bool { ... }
Contains([]any{1,2,3}, "1")  // returns false silently — bug
```

### Missing method: generic vs interface

```go
// Generic with a method constraint
type Stringer interface { String() string }
func Format[T Stringer](v T) string { return v.String() }

type Plain struct{}
Format(Plain{}) // compile error: Plain does not implement Stringer

// Interface with the same method
func Format(v Stringer) string { return v.String() }
Format(Plain{}) // also compile error in this direction — Plain assignment to Stringer fails
```

Both styles catch missing methods at compile time when the input type is known statically. The difference shows up when the input arrives as `any`:

```go
// Hidden runtime check
var v any = Plain{}
s := v.(Stringer) // panics at runtime
```

Generics avoid this dance because there is no `any` step in the middle.

### Constraint mismatches

A senior reads constraints like a contract. The constraint says exactly what operations the body needs:

```go
func Sum[T ~int | ~float64](s []T) T  // body uses +
func Min[T cmp.Ordered](a, b T) T      // body uses <
func Eq[T comparable](a, b T) bool     // body uses ==
```

A mismatch between constraint and body operation is a compile error. With interfaces, a type that "almost" satisfies the interface fails to assign — also a compile error. Both styles win on this axis.

---

## Memory layout: type parameter vs interface

### Interface value layout

```
+----------------+----------------+
|   *iface table |   *data        |
+----------------+----------------+
        16 bytes on 64-bit
```

The first word points to a type descriptor and method table. The second points to the value (or holds the value if it fits in a word). For pre-1.17 layouts, `interface{}` was slightly different; modern Go uses `iface` and `eface` headers under the hood.

### Generic value layout

After instantiation, a value of type `T` has the **exact** layout of the concrete type. No header, no descriptor:

```
T = int:
+----------------+
|     int        |
+----------------+
       8 bytes
```

The implication: a slice of one million `T = int` is 8 MB. A slice of one million `interface{}` of `int` is 16 MB plus heap allocations for each box on machines where `int` does not fit in a word — and even when it does, the iface layout doubles the size.

### Method dispatch cost

```
Generic:
   call F[int]              // direct call
   ~1 ns

Interface:
   load type pointer        // 1 indirect read
   load method pointer      // 1 indirect read
   indirect call            // branch predictor miss likely
   ~3-5 ns
```

A few nanoseconds is irrelevant per call. It matters when the call is in an inner loop millions of times per second.

---

## The hidden v-table

Each interface value carries a pointer to an **interface table** (sometimes abbreviated **itab**) with three pieces:

1. The dynamic type's descriptor
2. A method table — function pointers in the order the interface declares them
3. A hash for quick equality of itabs

The compiler generates one itab per `(InterfaceType, ConcreteType)` pair and caches it. The cost of the itab is amortised, but the **indirect call** it enables remains a runtime expense.

Generics have **no** itab in the common case. The dictionary used by GC shape stenciling is similar in spirit but limited to a few operations (equality, hashing, type-specific size). It is also looked up only for operations that depend on the concrete type — most of the body never touches it.

---

## Inlining and devirtualization

### Generic inlining

The Go compiler can inline a generic function just like a normal function, provided the body is simple enough. After inlining, the generic call vanishes:

```go
func Inc[T int | int64](x T) T { return x + 1 }
y := Inc(3) // compiler can fold to: y := 4
```

### Interface inlining

Interface calls are **harder** to inline because the target is decided at runtime. The compiler can devirtualize when the type is provably constant at the call site:

```go
var n Notifier = Email{} // compiler proves Email; can devirtualize
n.Notify("hi")
```

But in practice most interface variables come from somewhere (a function argument, a struct field, a slice element). Devirtualization fails and the indirect call stays.

### Profile-guided optimization (PGO)

Go 1.21+ PGO can devirtualize hot interface calls when the profile shows the same concrete type dominates. This shifts some of the historical "interfaces are slow" balance toward "interfaces are fast in practice if your hot path is monomorphic at runtime".

For most teams, PGO removes the last performance reason to prefer generics over interfaces. The remaining reason is **static guarantees** — the compiler always catches generic-call-with-wrong-type, but only catches the interface version when the type is statically known.

---

## Boxing, escape, and the heap

### When interfaces box

Assigning a non-pointer value to an interface variable causes the value to be **boxed**: stored on the heap and pointed to by the interface header. For small values this is cheap; for many values in a hot loop it is expensive:

```go
var sum int64
for _, v := range []any{1, 2, 3, /* ... a million ints ... */} {
    sum += v.(int64) // each iteration also has a runtime type check
}
```

A million-element `[]any` of `int64` requires a million heap allocations to populate.

### When generics avoid boxing

A `[]int64` is a flat array. No headers, no heap allocations. The generic `Sum[T ~int64](s []T)` runs over this flat memory:

```go
sum := Sum(big) // big is []int64
```

This is the single biggest performance argument for generics: they let you keep flat memory layouts that interfaces force you to abandon.

### Escape analysis surprises

A generic function can sometimes cause values to **escape** to the heap that would not otherwise. This happens when the GC shape grouping forces the compiler to be pessimistic. We covered this in `07-generic-performance`. The short version: profile if it matters; do not blindly assume generics are always faster.

---

## Mixed designs: interface as constraint

The most powerful Go idiom in the post-1.18 world is using an **interface as a generic constraint**. You get the type safety of generics and the polymorphism of interfaces in the same function.

### Pattern: generic function over interface constraint

```go
type Stringer interface { String() string }

func Join[T Stringer](items []T, sep string) string {
    parts := make([]string, len(items))
    for i, v := range items { parts[i] = v.String() }
    return strings.Join(parts, sep)
}
```

Why is this better than the non-generic `func Join(items []Stringer, sep string)`?

- **No boxing** — `items` is a typed slice, not `[]Stringer`.
- **Static dispatch is possible** — the compiler may inline `v.String()` when the concrete type is known.
- **Better error messages** — the slice type appears in errors as the concrete type.

It is not better when:
- The caller naturally has a `[]Stringer` (heterogeneous slice).
- The caller wants to mix concrete types in one slice — then the interface form wins.

### Pattern: generic accepting both

```go
type Reader interface { Read([]byte) (int, error) }

func ReadAll[R Reader](r R) ([]byte, error) {
    var buf [4096]byte
    var out []byte
    for {
        n, err := r.Read(buf[:])
        out = append(out, buf[:n]...)
        if err != nil {
            if err == io.EOF { return out, nil }
            return out, err
        }
    }
}
```

Compared to `io.ReadAll` (which takes `io.Reader`), this version avoids the interface header per call when the caller has a concrete `*os.File`. The actual stdlib stuck with the interface version because the cost is invisible in practice and the API is more convenient.

The lesson: even when the generic-over-interface form is technically faster, the team-level question is "is the win worth the API complexity?" Often it is not.

---

## Summary

Generics and interfaces sit on opposite sides of a fundamental design axis:

- **Generics** are **type-level** abstraction — they parametrize the code over types and resolve at compile time.
- **Interfaces** are **value-level** abstraction — they parametrize the value over methods and resolve at runtime.

Concretely:

- Static dispatch beats dynamic dispatch on hot paths but loses at architectural seams.
- Generic memory layout is flat; interface memory layout is two-word headers plus possible heap allocation.
- Generics catch wrong-type calls at compile time; interfaces catch them only when the type is statically known.
- The two tools combine well: an interface used as a generic constraint gives compile-time safety **and** access to per-type behaviour.

A middle-level engineer chooses the right tool for the job and is no longer impressed by either feature in isolation. Move on to `senior.md` to see how these tradeoffs reshape architecture.
