# Generic Performance — Middle Level

## Table of Contents
1. [What the compiler actually does](#what-the-compiler-actually-does)
2. [GC shape stenciling — the formal model](#gc-shape-stenciling-the-formal-model)
3. [The dictionary, in detail](#the-dictionary-in-detail)
4. [What gets shared vs specialized](#what-gets-shared-vs-specialized)
5. [Escape analysis under generics](#escape-analysis-under-generics)
6. [Inlining and devirtualization](#inlining-and-devirtualization)
7. [The cost of `comparable` operations](#the-cost-of-comparable-operations)
8. [Inspecting generated code](#inspecting-generated-code)
9. [Summary](#summary)

---

## What the compiler actually does

Generics in Go (1.18 and onward) are implemented in the `cmd/compile` toolchain as a hybrid of two textbook strategies:

- **Stenciling** — generate a body specialised by some property of the type
- **Dictionary passing** — pass type-specific data (descriptors, comparison routines) at runtime

Concretely, when the compiler sees a generic function call like `Sum[int](s)`:

1. It picks the **GC shape** of `int` — in this case "scalar 8-byte, no pointers".
2. It looks up (or creates) the stencil body for that shape.
3. It builds a **dictionary** that describes `int` specifically (type descriptor, equality function, etc.).
4. The call becomes a regular function call to the stencil body, with the dictionary passed as a hidden first argument.

That single mechanism handles every generic call in Go.

### Why a hybrid?

| Strategy | Pros | Cons |
|----------|------|------|
| Pure monomorphization (C++/Rust) | Fastest possible runtime | Binary bloat, slow compiles |
| Pure dictionary (Swift) | Tiny binary | Indirection on every type-dependent op |
| **GC shape stenciling (Go)** | Modest binary, decent runtime | Some indirection on shared shapes |

Go's design is the **middle option**, deliberately. It accepts a small runtime cost on pointer-shape generics to save binary size and keep compile times reasonable.

---

## GC shape stenciling — the formal model

A **GC shape** is the smallest set of properties the **garbage collector** needs to walk a value. It includes:

1. The size in bytes
2. The pointer-bit pattern (which words are pointers and must be scanned)
3. Alignment

Two types share a GC shape if and only if a GC walking memory cannot tell them apart. Examples:

| GC shape | Examples |
|----------|----------|
| 1-byte scalar | `bool`, `int8`, `uint8` |
| 4-byte scalar | `int32`, `float32`, `rune` |
| 8-byte scalar | `int`, `int64`, `float64`, `uint64` |
| pointer-shaped | `*T` (any T), `string`, `[]T`, `map[K]V`, `chan T`, `interface{}` |
| 16-byte struct, no pointers | `struct{ a, b int64 }` |
| 16-byte struct, all-pointer | `struct{ a, b *T }` |

For each **shape** present in the program, the compiler emits **one** stencil body. Inside that body, anywhere the code mentions `T`-specific operations (e.g., `==`, hashing, the size of `T` for a memory copy), it consults the dictionary.

### The naming you see in `pprof`

After Go 1.18 you will see symbols like:

```
github.com/me/pkg.Find[go.shape.int_0]
github.com/me/pkg.Find[go.shape.string]
github.com/me/pkg.Find[go.shape.*github.com/me/pkg.Point]
```

The `go.shape.*` part is the human-readable name for the GC shape. The trailing `_0` is the type parameter index. This is the key to reading flame graphs of generic-heavy code.

### Counting shapes

A simple rule of thumb: every distinct **scalar size + pointer pattern** counts as one shape. Two `*Foo` and `*Bar` count as one. Two structs with identical layouts count as one. A `map[string]int` and a `map[int]string` count as one (both are map header pointers, GC walks them through the runtime).

This is why generic binaries grow much more slowly than C++ template binaries — Go shares stencils aggressively.

---

## The dictionary, in detail

The **dictionary** is the per-type runtime structure passed to a stencil body. It carries everything the body needs but cannot bake in at compile time. Roughly:

```go
type genericDict struct {
    typeDescriptor *runtime._type      // the concrete type
    methods        []unsafe.Pointer    // method table for any methods in the constraint
    equal          func(a, b unsafe.Pointer) bool
    hash           func(p unsafe.Pointer, seed uintptr) uintptr
    sizeof         uintptr
    // ... per-type details
}
```

This is **simplified** — the actual dictionary layout is in `cmd/compile/internal/typecheck/subr.go` and `runtime/dict.go`, and it changes between releases. The general shape is stable.

### Dictionary cost in real terms

Each operation that uses the dictionary is roughly:

- An indirect call (load the function pointer, jump)
- One or two memory loads to fetch the descriptor

On a modern CPU this is tens of nanoseconds per operation when not inlined, ~0 ns when inlined. For a tight loop that calls `==` once per iteration, the cost is non-trivial.

### When you do **not** see the dictionary

The compiler omits the dictionary call when it can:

- Prove the type at the call site (single-instantiation, devirtualization)
- Inline the stencil body into the caller (the dictionary becomes a constant)
- Identify the operation as a primitive (e.g., `int + int`)

Most numeric generics never hit the dictionary path in practice.

---

## What gets shared vs specialized

A useful cheat sheet:

| Operation | Source of truth |
|-----------|-----------------|
| `+`, `-`, `*`, `/` on `T int \| float64` | Specialized by the compiler |
| `==`, `!=` on `T comparable` | Dictionary call (sometimes inlined) |
| `<`, `<=`, `>`, `>=` on `T cmp.Ordered` | Specialized for primitives, dictionary for `string` and pointer shapes |
| `len(s)` for `T ~[]E` | Direct — slice header is the same |
| Method call `t.M()` via constraint | Dictionary lookup |
| `make([]T, n)` | Compiler emits the right alloc using `sizeof` from the dictionary |
| `reflect.TypeOf(t)` | Returns the concrete type — works as expected |

The pattern: **the more your body relies on operations specific to a single type, the more dictionary work you do**.

---

## Escape analysis under generics

Escape analysis is the compiler pass that decides whether a value lives on the **stack** (cheap) or the **heap** (allocates, GC-tracked). Generics interact with it in subtle ways.

### The general rule

The compiler must produce a body that is **safe for all types** of a given shape. If even one possible type would force an escape, all instantiations of that shape pay the cost.

```go
func Process[T any](v T) *T {
    return &v // returns address of local — escapes
}
```

This always allocates on the heap. The non-generic version `func ProcessInt(v int) *int { return &v }` does the same — generics did not introduce the escape, but they cannot remove it either.

### A subtler example

```go
func PrintGen[T any](v T) {
    fmt.Println(v)
}

func PrintInt(v int) {
    fmt.Println(v)
}
```

Both call `fmt.Println(any...)`, which forces `v` to be passed as `any`. For `PrintInt`, the compiler boxes `int` into `any` once. For `PrintGen[int]`, the compiler also boxes — but the body might force the boxing earlier than the concrete version would, leading to an extra allocation in some Go versions.

Run `go build -gcflags="-m"` to see the escape decisions for your specific code.

### How to mitigate

- Pass pointers explicitly when the type is large
- Avoid storing `T` in `any` inside a generic body
- Profile with `go test -benchmem` and look for unexpected allocations
- For hot paths, write a non-generic wrapper

---

## Inlining and devirtualization

The Go compiler tries hard to inline generic calls. Inlining a generic body has two effects:

1. **The dictionary is constant-folded.** All operations that would have gone through the dictionary become direct.
2. **The body's instructions can be optimized in context.** Bounds-check elimination, common subexpression elimination, etc.

When inlining succeeds, generic code is identical to hand-written code.

### When inlining fails

The compiler refuses to inline a function when the body is too large, contains `defer`/`recover`, contains certain runtime calls, or hits a per-package budget. For generic functions, the **shared stencil body** must satisfy the inliner — one too-complex instantiation can disable inlining for everyone.

### Devirtualization

Even when the body cannot be inlined, the compiler may **devirtualize** specific dictionary calls — replacing the indirect call with a direct one when it knows the concrete type. This depends on:

- Whether the function is used at exactly one instantiation in the binary
- Whether profile-guided optimization (PGO) hints are available
- The specific Go release (steadily improving)

### Checking for yourself

```bash
go build -gcflags="-m=2" .
```

Look for:

```
./code.go:7:6: can inline Sum[int]
./code.go:12:14: inlining call to Sum[int]
```

If you see `cannot inline ...`, the dictionary cost stays.

---

## The cost of `comparable` operations

`==` on `T comparable` deserves special attention because it is the operation most often hidden behind a constraint.

### Pre-1.20 vs post-1.20

- **Go 1.18-1.19**: `comparable` excluded interface types. `==` was a single dictionary call to a per-type equality function.
- **Go 1.20+**: `comparable` accepts interfaces. `==` may now panic at runtime if the dynamic types are not comparable. Slightly more code, slightly different optimization.

### A real benchmark

```go
type Point struct { x, y int }

func FindGen[T comparable](s []T, t T) int {
    for i, v := range s { if v == t { return i } }
    return -1
}

func FindPoint(s []Point, t Point) int {
    for i, v := range s { if v == t { return i } }
    return -1
}
```

For 10,000 `Point` lookups:

| Function | ns/op |
|----------|-------|
| `FindPoint` (concrete) | 8,500 |
| `FindGen[Point]` (single instantiation) | 8,800 |
| `FindGen[Point]` (with siblings: `FindGen[Other]` also in the binary) | 14,200 |

The cost is **shared shape**, not "generic vs concrete" per se. If only one type uses the stencil, the compiler often devirtualizes. With multiple types, the dictionary call stays.

---

## Inspecting generated code

A senior Go programmer should be able to look at what the compiler actually produced.

### `go build -gcflags="-S"`

Dumps the assembly for each function. Generic stencils appear with the mangled name:

```
"".Sum[go.shape.int_0] STEXT nosplit size=...
```

### `go tool objdump`

```bash
go build -o app .
go tool objdump -s 'Sum\[' app
```

Shows the actual machine code per stencil — useful for confirming whether a dictionary lookup is in the inner loop.

### `go tool compile -m=2`

The most common tool for everyday investigation. Reports inlining decisions, escape analysis, and devirtualization.

```bash
go build -gcflags="-m=2" ./mypkg/...
```

Output excerpt:

```
./code.go:7:6: can inline Sum[int]
./code.go:7:18: parameter s does not escape
./code.go:9:14: inlining call to Sum[int]
./code.go:12:6: can inline Find[go.shape.*Point]
./code.go:12:6: cannot devirtualize Find[*Point].== — multiple shapes share body
```

### `pprof`

For sustained profiling, the standard toolkit applies. The only generics-specific change is that flame graphs show stencil-mangled names. Group them in your head — `Find[go.shape.int_0]` and `Find[go.shape.string]` are two separate hot spots, not one.

---

## Summary

Go generics are implemented as **GC shape stenciling with dictionary passing**. The compiler emits one body per memory layout and a per-type dictionary that fills in the type-specific bits. The key consequences:

- **Numeric types** have unique shapes and very fast bodies — usually inlined, never hits a dictionary.
- **Pointer-shaped types** share one body. Comparisons, equality, and method calls go through the dictionary unless the compiler can devirtualize them.
- **Escape analysis** must conservatively cover all instantiations of a shape. A few generic patterns force allocations the concrete equivalent would not.
- **Inlining** removes the dictionary cost when it succeeds. Hot small generics inline aggressively; heavy bodies do not.
- **Tooling** (`-gcflags=-m`, `pprof`, `go tool objdump`) is your microscope. Use it.

The middle-level lesson is to read the compiler's output. Once you can predict whether a given generic call will inline, the rest of generic performance is bookkeeping.

Move on to `senior.md` for the trade-off discussion against C++/Rust/Java and the architectural decisions that follow.
