# Why Generics? — Middle Level

## Table of Contents
1. [Why did Go wait until 1.18?](#why-did-go-wait-until-118)
2. [The pre-1.18 toolbox](#the-pre-118-toolbox)
3. [`interface{}` vs generics in depth](#interface-vs-generics-in-depth)
4. [Code generation vs generics](#code-generation-vs-generics)
5. [Comparison with other languages](#comparison-with-other-languages)
6. [Implementation strategy: monomorphization vs dictionary](#implementation-strategy-monomorphization-vs-dictionary)
7. [GC shape stenciling — Go's hybrid](#gc-shape-stenciling-gos-hybrid)
8. [Performance implications](#performance-implications)
9. [Summary](#summary)

---

## Why did Go wait until 1.18?

Go was designed in 2007, open-sourced in 2009, and stayed without generics until **March 15, 2022**. That is **thirteen years** of explicit refusal. Why?

### The original design philosophy

Rob Pike, Robert Griesemer, and Ken Thompson designed Go with a simple slogan: **"Less is exponentially more"**. Their target audience was Google's server engineers, who had been bitten repeatedly by the complexity of C++ templates and the runtime cost of Java generics. Go's founders considered:

- **Templates** — too complex, too easy to abuse, slow to compile
- **Erasure** — sacrifices performance and type info
- **Reified generics with covariance/contravariance** — adds language complexity that slows down learning

They chose to **defer** the question rather than pick a wrong answer. Their reasoning was that interfaces plus the empty interface would cover "most" use cases, and that it was cheaper to add generics later than to remove a bad design.

### What changed

By 2018 Go had been used for:
- Kubernetes (massive `runtime.Object` machinery)
- Docker (lots of `interface{}` glue)
- Prometheus (numeric code that begged for generics)
- Tens of thousands of internal Google services

Common patterns kept emerging:
- `sort.Sort(byAge(people))` — boilerplate type wrappers
- `json.Unmarshal(data, &v)` — reflection-heavy
- `sync.Map` returning `interface{}`

The community had also matured. The team felt they could ship generics **without** repeating the C++/Java mistakes. The result was the **Type Parameters Proposal** (Ian Lance Taylor, Robert Griesemer, August 2021) and Go 1.18 in March 2022.

### Rejected proposals over the years

| Year | Proposal | Why rejected |
|------|----------|--------------|
| 2010 | "Type functions" | Too dynamic |
| 2013 | Generalized types | Syntax disliked |
| 2016 | Contracts (Pike) | Confused users |
| 2018 | Updated contracts | Still too complex |
| 2020 | Type parameters with constraints (Taylor/Griesemer) | **Accepted** |

The accepted design is much simpler than the C++ template system but still type-checked at compile time.

---

## The pre-1.18 toolbox

Before generics, Go programmers had **four** ways to write reusable code:

### 1. `interface{}`

```go
func Map(s []interface{}, f func(interface{}) interface{}) []interface{} {
    out := make([]interface{}, len(s))
    for i, v := range s { out[i] = f(v) }
    return out
}
```

Works, but **every value is boxed**. The caller has to wrap each element manually:

```go
ints := []int{1, 2, 3}
boxed := make([]interface{}, len(ints))
for i, v := range ints { boxed[i] = v }
// now we can call Map(boxed, ...)
```

Painful and slow.

### 2. Reflection

```go
func MapReflect(s, fn interface{}) interface{} {
    sv := reflect.ValueOf(s)
    fv := reflect.ValueOf(fn)
    out := reflect.MakeSlice(sv.Type(), sv.Len(), sv.Len())
    for i := 0; i < sv.Len(); i++ {
        out.Index(i).Set(fv.Call([]reflect.Value{sv.Index(i)})[0])
    }
    return out.Interface()
}
```

Type-flexible at the cost of performance and readability. Reflection is **5-50x slower** than direct calls.

### 3. Code generation

Tools like [genny](https://github.com/cheekybits/genny) and homemade `text/template` scripts generated per-type code:

```go
//go:generate genny -in=set.go -out=set_int.go gen "T=int"
```

The generated `set_int.go` was real, fast, type-safe code. But the developer experience suffered:
- IDE could not jump to the source
- `go vet` complained about generated files
- Build time grew linearly with the number of types

### 4. Hand-rolled per-type duplication

The most common solution: copy-paste. The standard library itself shipped `sort.IntSlice`, `sort.StringSlice`, `sort.Float64Slice` — the same algorithm three times.

### A summary table

| Approach | Type safe | Fast | Readable | Maintainable |
|----------|-----------|------|----------|--------------|
| `interface{}` | ❌ | ❌ | ✓ | ✓ |
| Reflection | ❌ | ❌ | ❌ | ❌ |
| Codegen | ✓ | ✓ | ❌ | ❌ |
| Copy-paste | ✓ | ✓ | ✓ | ❌ |
| **Generics** | **✓** | **~✓** | **~✓** | **✓** |

Generics are the first approach that scores well on **all four axes**.

---

## `interface{}` vs generics in depth

### Memory layout

An `interface{}` value is **two words**: a pointer to the type descriptor and a pointer to the data. Even a single `int` becomes 16 bytes (on a 64-bit machine) plus a possible heap allocation.

```
interface{} layout:
+----------------+----------------+
|   *type info   |   *data        |
+----------------+----------------+
        16 bytes total
```

A generic `T` parameter, after instantiation, is **the type itself** — no extra pointers.

```
T = int layout:
+----------------+
|     int        |
+----------------+
       8 bytes
```

### Performance comparison

Benchmark — summing one million ints:

| Implementation | ns/op | allocations |
|----------------|-------|-------------|
| `func Sum(s []int) int` | 280 ns | 0 |
| `func Sum[T Number](s []T) T` (Go 1.21) | 285 ns | 0 |
| `func Sum(s []interface{}) int` (with assertions) | 4,200 ns | 0 |
| `func Sum(s []interface{}) interface{}` | 9,800 ns | 1,000,001 |

Generics are essentially **free** when used over a single concrete type. `interface{}` adds 15-30x overhead.

### Type assertions vs type parameters

```go
// interface{} version
func first(s []interface{}) interface{} {
    return s[0]
}
v := first([]interface{}{1, 2, 3})
n := v.(int) // assertion — can panic at runtime

// generic version
func First[T any](s []T) T {
    return s[0]
}
n := First([]int{1, 2, 3}) // n is int — no assertion
```

The compile-time guarantee removes the entire class of "wrong-type assertion" bugs.

---

## Code generation vs generics

For years the gold standard for type-safe collections was code generation. Let's compare:

### Codegen workflow

```
1. Write the template
2. Run go generate
3. Commit the generated .go files
4. Repeat on every change
```

### Generics workflow

```
1. Write the generic function
2. Compile
```

### Real-world data points

| Project | Before generics | After generics |
|---------|-----------------|----------------|
| Kubernetes lister/informer | thousands of lines of generated code | shrinking via generics |
| `pkg/errors` and friends | macros and codegen | now generic |
| Database client libraries | `Scan(&v)` everywhere | `Scan[T]` |

Generics did not eliminate codegen — it is still useful for stringer, mock generation, and protocol buffers. But for **collections and algorithms**, generics replaced codegen almost overnight.

---

## Comparison with other languages

### C++ templates

C++ templates use **monomorphization**: every distinct instantiation produces a separate copy in the binary.

```cpp
template <typename T>
T max(T a, T b) { return a > b ? a : b; }

max<int>(...);    // copy A
max<float>(...);  // copy B
max<string>(...); // copy C
```

Pros: zero overhead, very fast.
Cons: huge binaries, cryptic compile errors, infinite metaprogramming complexity.

Go decided **not** to go this route. The compile-time and binary-size cost was deemed unacceptable.

### Java generics

Java uses **type erasure**: at compile time the compiler checks the types, then erases them. At runtime, `List<Integer>` is just `List<Object>`.

```java
List<Integer> ints = new ArrayList<>();
// At runtime: just List of Object, with int boxed to Integer
```

Pros: small binaries, simple JVM.
Cons: every primitive is boxed, runtime type info is lost, you cannot write `new T[n]`.

Go did not want erasure either, because boxing destroys the performance of numeric code.

### Rust traits and generics

Rust uses monomorphization like C++ but with **trait bounds** as constraints. The Rust compiler enforces that `T: Ord` before allowing `<`.

```rust
fn max<T: Ord>(a: T, b: T) -> T {
    if a > b { a } else { b }
}
```

This is the closest design to Go's. Go's `[T cmp.Ordered]` is the spiritual analog of Rust's `<T: Ord>`.

### Swift generics

Swift uses **dictionary passing**: each generic call passes a hidden table of operations. One body in the binary, slightly slower at runtime.

Pros: small binaries.
Cons: indirection on every call.

### Where Go landed

Go chose a **hybrid**: GC shape stenciling. One body per **memory shape** (pointer-sized, integer-sized, string-shaped, etc.) plus a runtime dictionary for the rest. This gives:

- Smaller binaries than C++/Rust
- Faster runtime than Java/Swift
- Slightly more complex implementation

We will see this in detail in the next sections.

---

## Implementation strategy: monomorphization vs dictionary

There are two textbook strategies for compiling generics:

### Pure monomorphization (C++, Rust)

```
Source:
    func F[T any](x T) { ... }
Calls:
    F[int](1)
    F[string]("hi")

Binary:
    F_int      ← full copy specialized for int
    F_string   ← full copy specialized for string
```

- Pros: maximum runtime speed, no indirection
- Cons: binary bloat, longer compile times

### Pure dictionary passing (Swift)

```
Source:
    func F[T any](x T) { ... }
Calls:
    F[int](1) → calls F(1, dict_for_int)
    F[string]("hi") → calls F("hi", dict_for_string)

Binary:
    F          ← single body, takes dict as hidden arg
    dict_int   ← table of operations for int
    dict_str   ← table of operations for string
```

- Pros: tiny binary
- Cons: indirect calls — slower

### Go's hybrid: GC shape stenciling

Go groups types by their **GC shape** — what the garbage collector cares about:

| Shape | Examples |
|-------|----------|
| pointer-shaped | `*T`, `string`, `[]T`, `interface{}`, `map[K]V` |
| 8-byte integer | `int`, `int64`, `uint64` |
| 4-byte integer | `int32`, `uint32`, `float32` |
| ... | ... |

For each **shape**, Go generates one stenciled copy. All `*T` types share one body. Inside that shared body, a runtime **dictionary** holds the per-type details (methods, comparison, etc).

```
Binary:
    F_ptrshape    ← shared by *Foo, *Bar, string, ...
    F_int64       ← shared by int, int64, uint64
    dict_for_*Foo
    dict_for_*Bar
    ...
```

The result:
- Binary size: better than C++ monomorphization
- Speed: slower than pure monomorphization, faster than pure dictionary
- Trade-off: pointer-shaped generics may be **slower than expected** because of dictionary indirection

---

## GC shape stenciling — Go's hybrid

Why "GC shape" and not "memory shape"?

The GC needs to know, for every word of memory, whether it is a pointer or scalar — so it can trace it. So the compiler partitions types by their GC layout:

- **Pointer-shaped** — one machine word that is a pointer
- **Non-pointer scalar** — fixed-size data the GC ignores
- **Compound** — structs are stenciled per layout

For each shape, one **stencil** (template body) is generated. Per type, one **dictionary** is generated:

```go
type dict struct {
    typeDescriptor *_type
    equalFunc      func(unsafe.Pointer, unsafe.Pointer) bool
    methodTable    [n]unsafe.Pointer
    // …
}
```

When generic code does `a == b`, the compiled body looks up `equalFunc` in the dictionary and calls it. For monomorphized cases (a single concrete instantiation), the compiler can often **devirtualize** the dictionary call into a direct call.

### Why this matters

If you write:

```go
func Find[T comparable](s []T, target T) int {
    for i, v := range s {
        if v == target { return i }
    }
    return -1
}
```

…and call it with `Find([]int{...}, 1)` in one place and `Find([]string{...}, "hi")` in another, **two stencils** exist:
- one for 8-byte scalar (int)
- one for pointer-shaped (string is a `(ptr, len)` pair, also pointer-shaped)

Inside each, comparison goes through the dictionary. For `int`, the dictionary entry is the inlined integer compare — fast. For `string`, it goes through `runtime.cmpstring` indirectly — about as fast as before, since strings always required that.

### The performance surprise

The biggest "huh?" moment for new Go-generic users:

```go
func Sum[T int | float64](s []T) T { ... }
```

Calling this with `int` is **as fast as** the hand-written `int` version. Calling with `float64` is also fast. So far so good.

But:

```go
func Find[T comparable](s []T, target T) int { ... }
```

Calling this with a struct containing pointers can be **slightly slower** than the hand-written version because of GC shape grouping and dictionary indirection. We dive deeper in `optimize.md`.

---

## Performance implications

### When generics match hand-written code

- One concrete type used everywhere → compiler often devirtualizes the dictionary
- Numeric types (`int`, `float64`)
- `string` keys

### When generics are slightly slower

- Many distinct pointer-shaped types instantiated → dictionary grows, indirection cost
- Hot paths with `comparable` constraint and complex struct comparisons
- Code that touches many type-dependent operations per iteration

### When generics are faster than `interface{}`

- Almost always. `interface{}` requires runtime type assertion and boxing.
- Numeric loops, map iteration, slice mutation — generics dominate.

### Practical guidance

1. Write the generic version first.
2. Benchmark on the hot path.
3. Only specialize (hand-rolled per-type version) if benchmarks justify the duplication.

---

## Summary

Go waited 13 years for generics because the design team would not ship a complex feature that they could not fully justify. The 1.18 design — **type parameters with interface-shaped constraints**, implemented via **GC shape stenciling** — is a deliberate compromise:

- Smaller binaries than C++ templates
- Faster than Java erasure
- Simpler than full Rust traits with associated types

The big motivations are: replace `interface{}` boxing in collections, replace external code generators, and give Go programmers a real solution to the duplication problem. Each implementation alternative (monomorphization, erasure, dictionary) was carefully considered. Go's hybrid is not the fastest possible design, but it is the one that best fits the language's "less is more" philosophy.

Knowing the implementation strategy is **how** you predict whether generics will help or hurt your code:
- Numeric, single-type instantiations → free.
- Many pointer-shaped instantiations → measurable dictionary cost.
- `interface{}` replacement → almost always a win.

Move on to `senior.md` to see how these tradeoffs reshape architectural decisions.
