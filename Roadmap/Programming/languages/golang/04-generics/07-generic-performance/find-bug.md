# Generic Performance — Find the Bug

## How to use

Each problem shows a code snippet with a **performance** issue. Read it carefully and answer:
1. What is the perf bug?
2. How would you fix it?
3. How would you verify the fix?

Solutions are at the end. The bugs are realistic — drawn from production code and Go community reports.

---

## Bug 1 — Unnecessary heap allocation in a hot generic

```go
func Process[T any](v T) *T {
    return &v
}

for _, x := range bigSlice {
    p := Process(x)
    use(p)
}
```

**Hint:** Where does `v` live?

---

## Bug 2 — Wrong constraint causing dictionary calls

```go
type ID interface {
    int | int64 | string
}

func Find[T comparable](s []T, target T) int {
    for i, v := range s { if v == target { return i } }
    return -1
}

Find[ID]([]ID{1, 2, 3}, 2)
```

**Hint:** Which constraint hits the dictionary path?

---

## Bug 3 — Hidden boxing through `any`

```go
func Log[T any](v T) {
    fmt.Println(v)
}

for _, x := range millionInts {
    Log(x)
}
```

**Hint:** Look at `fmt.Println`'s signature.

---

## Bug 4 — Generic disabled inlining

```go
func Compute[T int | float64](s []T) T {
    var t T
    for _, v := range s {
        defer recover()
        t += v
    }
    return t
}
```

**Hint:** What does `defer` do to inlining?

---

## Bug 5 — Map allocation per call

```go
func Distinct[T comparable](s []T) []T {
    seen := map[T]struct{}{}
    out := []T{}
    for _, v := range s {
        if _, ok := seen[v]; !ok {
            seen[v] = struct{}{}
            out = append(out, v)
        }
    }
    return out
}

for _, batch := range millionsOfBatches {
    _ = Distinct(batch)
}
```

**Hint:** What is allocated per call?

---

## Bug 6 — `interface{}` slipped back in

```go
type Container[T any] struct {
    items []any   // was []T originally
}

func (c *Container[T]) Add(v T) { c.items = append(c.items, v) }
func (c *Container[T]) Get(i int) T { return c.items[i].(T) }
```

**Hint:** What did the developer accidentally lose?

---

## Bug 7 — Comparator not inlined

```go
sort.Slice(users, func(i, j int) bool {
    return users[i].Age < users[j].Age
})
```

**Hint:** Pre-1.21 idiom on a hot path.

---

## Bug 8 — Generic Stack with poor escape

```go
type Stack[T any] struct{ data []T }

func (s *Stack[T]) Push(v T) {
    s.data = append(s.data, v)
}

func New[T any]() Stack[T] { return Stack[T]{} } // returns by value
```

**Hint:** Why might callers see allocations?

---

## Bug 9 — Reflection inside a generic

```go
func IsZero[T any](v T) bool {
    return reflect.ValueOf(v).IsZero()
}

for _, x := range hot {
    if IsZero(x) { ... }
}
```

**Hint:** Generics did not eliminate reflection.

---

## Bug 10 — Generic over `any` with cmp

```go
func MaxBy[T any](s []T, key func(T) int) T {
    var best T
    bestKey := math.MinInt
    for _, v := range s {
        if k := key(v); k > bestKey {
            bestKey, best = k, v
        }
    }
    return best
}
```

**Hint:** What about an empty slice?

---

## Bug 11 — Forced shape diversity

```go
type Wrapper[T any] struct{ v T }

var (
    a Wrapper[*A]
    b Wrapper[*B]
    c Wrapper[*C]
    d Wrapper[*D]
    e Wrapper[*E]
    f Wrapper[*F]
    // ... 30 more
)

func processAll(things ...any) { /* generic-ish */ }
```

**Hint:** Why does this hurt?

---

## Bug 12 — Cold-start dictionary load

```go
type Codec[T any] struct{ ... }

func (c *Codec[T]) Encode(v T) []byte { ... }

// Used once at process startup with a giant payload
out := codec.Encode(huge)
```

**Hint:** First call cost.

---

## Bug 13 — Benchmark missing `b.ResetTimer()`

```go
func BenchmarkProcess(b *testing.B) {
    s := makeBigSlice() // 10ms
    for i := 0; i < b.N; i++ {
        Process(s)
    }
}
```

**Hint:** What is being measured?

---

## Bug 14 — Generic in a hot recursive function

```go
func Walk[T any](node *Node[T], f func(T)) {
    if node == nil { return }
    f(node.value)
    Walk(node.left, f)
    Walk(node.right, f)
}
```

**Hint:** Each recursive call passes the dictionary again. Sometimes that adds up.

---

## Bug 15 — Generic struct field forcing alignment

```go
type Pair[A, B any] struct {
    A A
    B B
}
```

**Hint:** What if `A` is a `bool` and `B` is an `int64`?

---

## Solutions

### Bug 1 — fix
The address-of-parameter forces `v` to escape to the heap. Allocations per loop iteration crush throughput. Rewrite to avoid the pointer:
```go
func Process[T any](v T) T { return v }
```
Or pass a pointer in and avoid taking new addresses.
**Verify:** `-gcflags="-m"` shows `moved to heap: v` before the fix.

### Bug 2 — fix
`comparable` accepts interface types like `ID` but `==` on an interface goes through `runtime.efaceeq`. Replace `T comparable` with `T int | int64 | string` if you control the call sites. Or compare via a switch on the concrete type. The fix is workload-specific.
**Verify:** Benchmark before / after on representative input.

### Bug 3 — fix
`fmt.Println(v)` takes `...any`. Each call boxes `v`. For a hot path, switch to a typed printer:
```go
func LogInt(v int) { fmt.Println(v) }
```
Or accept that logging is slow and remove it from the hot path.
**Verify:** `-benchmem` shows allocations on the generic version.

### Bug 4 — fix
`defer recover` disables inlining. The generic body becomes a non-inlined function call, with the dictionary cost staying. Remove the `defer` if it is not needed; if it is, the function should not be on a hot path.
**Verify:** `-gcflags="-m=2"` shows `cannot inline ...`.

### Bug 5 — fix
The `map[T]struct{}{}` and `[]T{}` allocations happen on every call. For batch-oriented code, accept a pre-allocated map and slice via parameters. Or use `sync.Pool` to reuse them.
**Verify:** `-benchmem` shows allocations.

### Bug 6 — fix
The developer dropped the type information by storing `any`. Restore it:
```go
items []T
```
Now `Get` does not need an assertion and there is no boxing.
**Verify:** Benchmarks show fewer allocations and faster `Get`.

### Bug 7 — fix
Migrate to `slices.SortFunc`:
```go
slices.SortFunc(users, func(a, b User) int { return cmp.Compare(a.Age, b.Age) })
```
The comparator inlines into the sort body.
**Verify:** Benchmark on 10k+ items shows ~30% improvement.

### Bug 8 — fix
Returning `Stack[T]` by value can copy the slice header if the type is moved between scopes; in some cases the compiler must keep the struct alive on the heap. Return a pointer:
```go
func New[T any]() *Stack[T] { return &Stack[T]{} }
```
**Verify:** Escape analysis report.

### Bug 9 — fix
`reflect.ValueOf(v)` allocates for non-trivial types. For hot paths, use a per-type wrapper:
```go
func IsZeroInt(v int) bool { return v == 0 }
```
Or constrain `T` to `comparable` and compare with the zero value:
```go
func IsZero[T comparable](v T) bool { var zero T; return v == zero }
```
**Verify:** Significant ns/op drop in the generic-without-reflect version.

### Bug 10 — fix
Empty input returns the zero value of `T` and `bestKey` initialized to `math.MinInt` — semantic bug, not just performance. Return `(T, bool)`:
```go
func MaxBy[T any](s []T, key func(T) int) (T, bool) {
    var zero T
    if len(s) == 0 { return zero, false }
    ...
    return best, true
}
```
**Verify:** Handles empty slice correctly.

### Bug 11 — fix
Each `*A`, `*B`, etc. is pointer-shaped, so they share one stencil. Method calls go through the dictionary. The cost adds up. Mitigation: collapse the wrappers into one type with an interface field if polymorphism is acceptable, or specialise for the hot types.
**Verify:** Binary size analysis with `nm -size`.

### Bug 12 — explanation
The first call to a generic function may incur a dictionary load that misses the cache. For a process that runs once with a huge input, this is irrelevant. For a service that handles many short requests, **warm up** the generic by calling it on small input during startup.
**Verify:** Warm-up benchmarks vs cold-start.

### Bug 13 — fix
Add `b.ResetTimer()` after setup:
```go
func BenchmarkProcess(b *testing.B) {
    s := makeBigSlice()
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        Process(s)
    }
}
```
**Verify:** ns/op drops dramatically — the setup was being measured.

### Bug 14 — explanation
Each recursive call passes the dictionary as a hidden first argument. For deep trees with millions of nodes, this is one extra register move per call. Almost never significant. If it is, write a non-recursive iterative `WalkInt`. Most of the time, this is a non-issue — flag only when profiling shows it.
**Verify:** Profile and compare with iterative or non-generic version.

### Bug 15 — explanation
`Pair[bool, int64]` may have padding between `A` (1 byte) and `B` (8 bytes). The compiler obeys alignment rules: 8 bytes total layout becomes 16 bytes with padding. If you process millions of these, memory use is 2× expected. Reorder fields: put the larger field first, or pack manually.
**Verify:** `unsafe.Sizeof` on each instantiation.

---

## Lessons

Patterns from these bugs:

1. **Heap escapes are the silent killer** (Bugs 1, 8, 9). Always check `-gcflags="-m"`.
2. **`any` and reflection sneak boxing back in** (Bugs 3, 6, 9). Read every variadic and reflective call.
3. **`defer` and friends disable inlining** (Bug 4). Hot paths must keep bodies inline-friendly.
4. **Migrate to stdlib helpers** (Bug 7). They are aggressively optimised.
5. **Constraint choice changes performance** (Bug 2). `comparable` over interface types is slower than concrete unions.
6. **Per-call allocations dominate hot loops** (Bug 5). Reuse buffers or pools.
7. **Diversity of pointer shapes inflates dictionary cost** (Bug 11). Specialize when measurable.
8. **Benchmarks must measure the right thing** (Bug 13). `b.ResetTimer()` is mandatory after setup.
9. **Cold dictionary loads matter for short-lived processes** (Bug 12). Warm up if relevant.
10. **Generic recursion is rarely the bottleneck** (Bug 14). Profile before optimising.
11. **Layout matters for generic structs** (Bug 15). Reorder fields by size.

A senior engineer reads generic code with one eye on **escape analysis**, one on **inlining**, and one on **dictionary calls**. Mismatch among these three is the root cause of nearly every generic performance bug.
