# Generic Performance — Senior Level

## Table of Contents
1. [The decision matrix: generic vs interface vs concrete](#the-decision-matrix-generic-vs-interface-vs-concrete)
2. [Cross-language comparison](#cross-language-comparison)
3. [Compile time, binary size, and other axes](#compile-time-binary-size-and-other-axes)
4. [When generics are slower than interfaces](#when-generics-are-slower-than-interfaces)
5. [When generics are faster than interfaces](#when-generics-are-faster-than-interfaces)
6. [Architectural implications](#architectural-implications)
7. [The "performance budget" mindset](#the-performance-budget-mindset)
8. [Anti-patterns that hurt performance](#anti-patterns-that-hurt-performance)
9. [Summary](#summary)

---

## The decision matrix: generic vs interface vs concrete

A senior engineer must routinely choose among three implementations of the same idea. The decision matrix:

| Scenario | Likely best |
|----------|-------------|
| Tight numeric loop, single type | Concrete or generic — equivalent |
| Hot path, many call sites, one concrete type | Concrete |
| Same body, different types, runtime selection | Interface |
| Same body, different types, compile-time selection | Generic |
| Deeply diverse pointer-shaped types (10+) on a hot path | Concrete (specialised) |
| Replacing `interface{}` boxing in a container | Generic |
| Comparing tiny numbers of items | Either; difference invisible |

The senior insight: **the right answer depends on call-site diversity and shape diversity, not just on lines saved**.

---

## Cross-language comparison

Understanding Go's choice requires seeing the alternatives.

### C++ templates — pure monomorphization

```cpp
template <typename T>
T max_of(T a, T b) { return a > b ? a : b; }

max_of<int>(...);    // body A
max_of<float>(...);  // body B
max_of<MyType>(...); // body C
```

Each instantiation is a fully specialised function — no dispatch, no dictionary. The compiler can inline aggressively, vectorize, and remove every type-related branch.

| Property | Outcome |
|----------|---------|
| Runtime speed | Best possible |
| Binary size | Worst — N bodies for N types |
| Compile time | Slow, especially for nested templates |
| Error messages | Notoriously cryptic |

C++ pays the price of binary bloat and cryptic errors for absolute peak speed.

### Rust generics — monomorphization with traits

```rust
fn max<T: Ord>(a: T, b: T) -> T {
    if a > b { a } else { b }
}
```

Rust monomorphizes per type, like C++, but adds **trait bounds** (`T: Ord`) for compile-time checking. Errors are clearer than C++; performance is similar.

### Java generics — type erasure

```java
public static <T extends Comparable<T>> T max(T a, T b) {
    return a.compareTo(b) > 0 ? a : b;
}
```

Java erases types at compile time. At runtime, every `T` is `Object`, every primitive boxed (`int` becomes `Integer`). One body in the bytecode, but every operation may pay boxing/unboxing.

| Property | Outcome |
|----------|---------|
| Runtime speed | Slowest — boxing on every primitive |
| Binary size | Smallest — one body |
| Compile time | Fast |
| Type info at runtime | Lost (without `Class<T>` tricks) |

### Swift — pure dictionary passing

Swift generics ship one body and pass a "witness table" (dictionary) per call. Always indirect. Predictable but slow on hot paths. The Swift team has experimented with whole-program specialization to recover speed.

### Go — GC shape stenciling

```go
func Max[T cmp.Ordered](a, b T) T {
    if a > b { return a }
    return b
}
```

One body per **shape** (pointer-shape, 8-byte scalar, etc.). Per-type dictionary holds the operations. The compiler tries to inline and devirtualize when it can.

### Side-by-side

| Language | Strategy | Binary size | Runtime cost | Compile time |
|----------|----------|-------------|--------------|--------------|
| C++ | Per-type body | Largest | Zero | Slow |
| Rust | Per-type body | Large | Zero | Slow-ish |
| Java | Erasure | Smallest | Boxing on primitives | Fast |
| Swift | Dictionary | Small | Always indirect | Fast |
| **Go** | **Shape + dict** | **Modest** | **Often free, sometimes indirect** | **Modest** |

Go's design is distinct enough to be taught as its own model — not "Java but better" and not "C++ lite".

---

## Compile time, binary size, and other axes

Performance is more than runtime nanoseconds.

### Compile time

Generic code costs the compiler:

1. Parse the type parameter list
2. Type-check the body against the constraint
3. Stencil per shape used in the program
4. Generate per-type dictionaries

In practice, a heavy generic codebase compiles **5-15% slower** than its non-generic equivalent in Go 1.18 — the gap shrinks each release. For a 5-minute build, that is 15-45 seconds.

### Binary size

Real numbers (Go 1.21):

| Project | Without generics | With generics | Delta |
|---------|------------------|---------------|-------|
| `go` itself | 14.8 MB | 15.0 MB | +1.5% |
| `kubectl` | 47.0 MB | 47.3 MB | +0.6% |
| `gopls` | 35.0 MB | 35.4 MB | +1.1% |

Modest. The shape-grouping keeps the bloat well below C++ levels. A program that instantiates one generic over 50 distinct types adds about 50 dictionaries — kilobytes, not megabytes.

### CI cache behaviour

Touching a generic helper invalidates every package that **instantiates** it, not just direct importers. For monorepos with thousands of packages, this can cause wide rebuilds. Senior engineers structure code so that hot generics live in a stable, leaf-level package.

### Debugging and tooling

| Tool | Generic friendliness |
|------|---------------------|
| `dlv` (debugger) | Stencil mangling can confuse old versions; current `dlv` handles it |
| `pprof` | Names show `[go.shape.X]` — readable with practice |
| `gopls` | Mature; type inference info shown on hover |
| `go vet` | Generic-aware checks added |
| `go tool objdump` | Stencil bodies appear with mangled names |

---

## When generics are slower than interfaces

A senior engineer must know the unintuitive cases.

### Case 1 — Many call sites with diverse types and trivial work

Imagine a generic function `Tag[T any](v T) string` called from 50 places with 50 different types — none doing anything except returning a constant. Each call site pays a dictionary load. The interface version, by contrast, can be a single `func Tag(v any) string` with no dispatch unless the body actually inspects the type.

In **trivial** generics, the dictionary setup can outweigh the saved boxing.

### Case 2 — `comparable` over many shapes with cheap data

```go
type Cache[K comparable, V any] struct { m map[K]V }
```

If you instantiate this with 10 distinct struct keys, each `Get` pays a dictionary call to the per-type hash function. A non-generic `map[interface{}]V` may be **slightly slower** because of boxing, but if the key type is interface-shaped already, the costs converge.

### Case 3 — Very small, allocation-free interface methods

When the interface has a single small method and the implementations are cache-hot, the JIT-style inline-cache pattern (which Go does not have, but the v-table is small and predictable) can outperform a dictionary lookup that goes through extra indirection.

### Case 4 — Code paths that accidentally box `T` into `any`

```go
func Log[T any](v T) {
    fmt.Println(v) // boxes T into any
}
```

The generic looks free; in practice it boxes per call. A non-generic `func Log(v any) { fmt.Println(v) }` does the same boxing exactly once, with less codegen.

---

## When generics are faster than interfaces

Most cases, but specifically:

### Case 1 — Numeric loops

`Sum`, `Product`, `Min`, `Max` over `[]float64` are **15-30×** faster than the `[]interface{}` equivalent. The savings come from not boxing each element.

### Case 2 — Sorting

`slices.Sort` is **~40% faster** than `sort.Slice` because the comparator is inlined into the sort body. The interface-based comparator forces an indirect call per comparison.

### Case 3 — Containers replacing `map[interface{}]interface{}`

A `Cache[string, *User]` saves both the boxing of the key and the assertion on read. Over a million operations, the savings are seconds.

### Case 4 — Iterators

`iter.Seq[T]` (Go 1.23+) yields concrete `T` values without boxing. A pre-1.23 channel-of-`interface{}` was forced to box.

### A simple decision rule

Pre-1.18 `interface{}` code that does any of:
- boxing primitives
- type-asserting on every read
- dispatching through a v-table per element

…is almost always faster as a generic. Replace it.

---

## Architectural implications

Generic performance is not just a loop-level concern — it shapes architecture.

### Hot-path libraries

Libraries on the hot path (sort, hash, JSON, gRPC framing) should be **either**:

- Concrete (best raw speed)
- Generic with a single dominant shape (matches concrete)
- Generic over a small set of shapes (acceptable dictionary cost)

A library that fans out over 20 distinct types in a generic hot path is a smell. Either narrow the type set or specialize.

### Public APIs

A senior engineer treats generic public APIs as **stickier than interface ones**:

- Adding a generic API commits to every shape callers throw at it.
- Removing a type parameter is a breaking change.
- Replacing a generic with an interface (or vice versa) breaks ABI.

A pattern that ages well: **interface in the public API, generic helpers internally**. The interface gives flexibility; the generic gives speed where it counts.

### Memory profile

Generics over many shapes inflate the **dictionary table** in `.rodata`. For embedded systems and serverless cold-starts, this matters. Profile binary sections (`go tool nm` or `objdump -h`) when the binary size budget is tight.

### Profile-guided optimization (PGO)

Since Go 1.21, PGO can devirtualize and inline more aggressively when given a CPU profile. Senior engineers running production services should:

1. Capture a representative CPU profile.
2. Feed it back to the compiler with `-pgo=profile.pprof`.
3. Re-benchmark.

Generic hot paths benefit disproportionately from PGO.

---

## The "performance budget" mindset

A senior engineer thinks in terms of **budgets**:

- p99 latency budget for a request
- CPU budget per QPS
- GC pause budget per minute
- Binary size budget

Each generic decision spends or saves a portion of each budget.

### Worked example

A web service handles 50k QPS. Each request goes through a typed cache lookup. Two designs:

- **Generic** `Cache[string, *Resp]` — 8 ns/op, 0 allocations
- **Interface** `Cache` returning `interface{}` — 60 ns/op, 1 allocation per lookup

50,000 × 60 = 3 ms/sec on the interface version, plus 50,000 allocations/sec stressing GC. Generic saves a measurable slice of CPU and a meaningful chunk of GC pressure.

### The other direction

A small CLI tool handles a few hundred operations per run. The same difference (60 ns vs 8 ns) is invisible — the user cannot perceive it. Generic-vs-interface decisions in the CLI matter for code clarity, not speed.

**Conclusion:** the same performance difference can be load-bearing or invisible depending on workload. Decide accordingly.

---

## Anti-patterns that hurt performance

### Anti-pattern 1 — Generic façade over a non-generic core

```go
func Save[T any](db *sql.DB, t T) error {
    return db.Exec("...", t) // db.Exec takes any anyway
}
```

The generic adds nothing — the underlying call still boxes. Drop the generic if it is not preventing boxing.

### Anti-pattern 2 — Generic god type

```go
type Cache[K comparable, V any, F func(K) V, R Result[V]] struct { ... }
```

Five type parameters means five dictionaries per instantiation. Plus the cognitive cost. Split the responsibilities.

### Anti-pattern 3 — Generic on the wrong axis

```go
type Repo[T Entity] interface {
    Find(id ID) (T, error)
    Save(T) error
    SpecialQueryForUsers() []T // makes sense only for User
}
```

The "special query" is per-entity. Generic forced you to either add a useless method to every entity or break the abstraction. Either two interfaces or no generic.

### Anti-pattern 4 — Microbenchmark cargo cult

A benchmark on `go test -bench=.` that runs `Sum[int]([]int{1,2,3})` shows a 0.3 ns/op result that is meaningless. Real workloads are bigger. Always benchmark with realistic input sizes (≥1000 elements for slices, ≥10k operations for maps).

### Anti-pattern 5 — Forgetting `b.ResetTimer()`

```go
func BenchmarkX(b *testing.B) {
    s := makeBigInput()        // not part of work being measured
    for i := 0; i < b.N; i++ {
        Sum(s)
    }
}
```

The setup time pollutes the measurement. Always:

```go
func BenchmarkX(b *testing.B) {
    s := makeBigInput()
    b.ResetTimer()
    for i := 0; i < b.N; i++ { Sum(s) }
}
```

### Anti-pattern 6 — Comparing across compiler versions

A "generics are slow" claim from Go 1.18 is largely obsolete. Re-run benchmarks on the version your service actually uses.

---

## Summary

A senior engineer evaluates generic performance against **three** alternatives — concrete, interface, and other generic shapes — and on **multiple axes** — runtime speed, binary size, compile time, GC pressure, and ergonomic cost.

The cross-language map is useful: Go is not C++, not Java, not Swift. It picked GC shape stenciling because **small binaries and fast compiles** matter for Go's identity. The runtime cost is the price.

In practice:

- **Generics replacing `interface{}`** — big win on hot paths.
- **Generics on numeric loops** — equivalent to hand-written.
- **Generics over many pointer-shaped types** — measurable tax.
- **Generics on cold paths** — invisible.

A senior engineer measures, reads `-gcflags=-m`, profiles with `pprof`, and chooses the right tool per situation. The blanket statement "generics are fast" is junior. The senior version is "generics are usually fast, sometimes not, and you must benchmark to know which."

Move on to `professional.md` for the production playbook — pprof workflows, real migrations, and decision frameworks.
