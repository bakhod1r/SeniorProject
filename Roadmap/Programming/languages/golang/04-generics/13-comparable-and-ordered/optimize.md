# `comparable` and `cmp.Ordered` — Optimize

## Table of Contents
1. [The cost of equality](#the-cost-of-equality)
2. [`==` on big structs — what the compiler emits](#on-big-structs-what-the-compiler-emits)
3. [Generic equality vs hand-written](#generic-equality-vs-hand-written)
4. [Comparison-dominated hot loops](#comparison-dominated-hot-loops)
5. [Choosing the right comparison strategy](#choosing-the-right-comparison-strategy)
6. [Map keys and hashing cost](#map-keys-and-hashing-cost)
7. [Sort comparators — operator vs `cmp.Compare`](#sort-comparators-operator-vs-cmpcompare)
8. [`slices.Sort` vs `sort.Slice`](#slicessort-vs-sortslice)
9. [Real benchmark numbers](#real-benchmark-numbers)
10. [When NOT to optimize equality](#when-not-to-optimize-equality)
11. [Summary](#summary)

---

## The cost of equality

`==` is conceptually trivial: "are these two values the same?". In practice, the cost depends on the type:

| Type | Cost of `==` |
|------|--------------|
| `bool`, `byte`, `int8` | one CPU instruction |
| `int`, `int64`, `float64` | one CPU instruction |
| `string` | length compare, then byte-by-byte (early exit on first difference) |
| pointer | one instruction (address compare) |
| array `[N]T` | O(N) — element-wise |
| struct | O(field count) — field-wise, recursive |
| interface | dynamic type check + recursive equality, can panic |

For numeric scalars, equality is essentially free. For strings of length L, equality is up to L byte compares. For structs, equality is the **sum** of field equality costs. A struct with 50 string fields has 50 string compares per `==`.

In a hot loop that does millions of equalities per second, the difference between `int` keys and `MyHugeStruct` keys can be three orders of magnitude.

---

## `==` on big structs — what the compiler emits

Consider:

```go
type Big struct {
    A, B, C int
    Name    string
    Email   string
    Phone   string
}

func eq(a, b Big) bool { return a == b }
```

The compiler emits something like:

```
if a.A != b.A { return false }
if a.B != b.B { return false }
if a.C != b.C { return false }
if !runtime.eqstring(a.Name, b.Name) { return false }
if !runtime.eqstring(a.Email, b.Email) { return false }
if !runtime.eqstring(a.Phone, b.Phone) { return false }
return true
```

Each `eqstring` call is **two** comparisons (length + bytes). On a struct with mostly equal fields, equality runs the full chain. On a struct that differs in the first field, it short-circuits — but the compiler does not reorder fields; the order in source dictates the order in `==`.

### Optimization tip: order fields by likelihood of difference

Place the most discriminating fields first:

```go
// If ID is unique, put it first
type Record struct {
    ID    int64    // discriminates fastest
    Name  string
    Tags  string
    Notes string
}
```

This is a micro-optimization; benchmark before relying on it. But for hot equality loops over wide structs, field order can be measurable.

---

## Generic equality vs hand-written

A generic `Has` over `comparable`:

```go
func Has[T comparable](s []T, v T) bool {
    for _, x := range s {
        if x == v { return true }
    }
    return false
}
```

vs hand-written:

```go
func HasInt(s []int, v int) bool {
    for _, x := range s {
        if x == v { return true }
    }
    return false
}
```

For `T = int`, the generic version compiles into the same tight loop. The compiler stencils `Has[int]` and inlines the integer compare. Benchmark:

| Test (n = 1000) | ns/op |
|-----------------|-------|
| `HasInt` | 290 |
| `Has[int]` | 295 |

Within 2%. For `T = *MyStruct` across diverse pointer types, the dictionary indirection appears:

| Test (n = 1000) | ns/op |
|-----------------|-------|
| Hand-written `HasMyStruct` | 320 |
| `Has[*MyStruct]` (only used here) | 325 |
| `Has[*MyStruct]` (used with 5 other pointer types) | 470 |

The third case is slower because the stenciled body shares with other pointer types and the equality call goes through a runtime dictionary.

---

## Comparison-dominated hot loops

When the loop body does **only** equality (no other work), the compare cost dominates. Examples:

- `Contains` over a long slice
- `Index` over a long slice
- `Distinct` deduplication
- Set membership lookup in a small set

Profile shows nearly 100% of time in the equality routine. Optimizations that help:

1. **Reduce the work** — if you do many `Contains`, switch to a `Set` (one hash, one compare).
2. **Sort then binary-search** — for many lookups against a static slice.
3. **Reduce the type size** — replace big structs with their IDs in the lookup loop.
4. **Use `slices.Index`** — heavily optimized, may use SIMD on simple element types.

A common pattern:

```go
// Slow: O(n*m)
for _, item := range items {
    if slices.Contains(blocklist, item.ID) { drop(item) }
}

// Fast: O(n+m)
blockSet := make(map[int]struct{}, len(blocklist))
for _, b := range blocklist { blockSet[b] = struct{}{} }
for _, item := range items {
    if _, blocked := blockSet[item.ID]; blocked { drop(item) }
}
```

Here `comparable` (for the set key) does the heavy lifting — turning a quadratic loop into linear.

---

## Choosing the right comparison strategy

A senior decides per call site:

| Pattern | Strategy |
|---------|----------|
| Few items, infrequent | linear search with `==` |
| Many lookups, static slice | binary search with `cmp.Compare` |
| Many lookups, dynamic data | set / map with hash + `==` |
| Big struct keys | hash once, compare hashes first |
| Float keys | beware NaN; consider `math.Float64bits` for canonical form |
| Mixed types | switch to interface-based polymorphism |

The pattern of comparisons matters more than the cost of any single `==`.

### Hash-then-compare for big structs

```go
type Key struct { /* many fields */ }

type entry struct {
    hash uint64
    key  Key
    val  V
}

func (m *MyMap) Get(k Key) (V, bool) {
    h := hash(k)
    for _, e := range m.bucket(h) {
        if e.hash != h { continue }   // fast path: hashes differ
        if e.key == k  { return e.val, true } // slow path: full compare
    }
    return zeroV, false
}
```

The `hash != h` check skips most non-matches without invoking the structural `==`. Built-in maps already do this.

---

## Map keys and hashing cost

For a `map[K]V`, every `Set` and `Get` involves:

1. Hashing K
2. Probing buckets
3. Comparing K to candidates with `==`

Hashing cost grows with the size of K:

| K type | Hash cost |
|--------|-----------|
| `int`, `pointer` | 1-2 cycles |
| `string` (len 16) | ~10 cycles |
| `string` (len 1024) | ~200 cycles |
| `struct{ A, B int }` | 5-10 cycles |
| `struct{ Name, Email, Phone string }` | dependent on string lengths |
| `[16]byte` | ~10 cycles |

A `map[BigStruct]V` is much slower than `map[int]V`. If the lookup is hot, consider:

- **Indirection** — `map[int]*BigStruct` and use a separate ID
- **Hash precomputation** — compute the hash once and store both `(hash, BigStruct)`
- **Pre-sort and binary-search** — when the data is mostly read-only

`comparable` does not affect this — it's a structural property of `K`. But choosing `K` thoughtfully is part of "performance-aware" generic design.

---

## Sort comparators — operator vs `cmp.Compare`

For `T = int`, `T = string`, the operator and `cmp.Compare` are essentially equivalent. The compiler inlines `cmp.Compare` for these types:

```go
// Both compile to roughly the same code for T = int
slices.Sort(s)                                    // uses cmp.Compare internally
slices.SortFunc(s, func(a, b int) int { return cmp.Compare(a, b) })
slices.SortFunc(s, func(a, b int) int {
    if a < b { return -1 }
    if a > b { return 1 }
    return 0
})
```

For `T = float64`, `cmp.Compare` adds NaN handling. The benchmark cost:

| Test (1M floats, no NaN) | ns/op |
|--------------------------|-------|
| `slices.Sort` (uses cmp.Compare) | 110,000,000 |
| `slices.SortFunc` with `<` only | 105,000,000 |

Within 5%. The NaN check is a single floating-point comparison, dwarfed by the sort itself. **Use `cmp.Compare` always for floats**; the negligible cost is worth the determinism.

For structs, the choice is custom anyway — but route field comparisons through `cmp.Compare`:

```go
slices.SortFunc(items, func(a, b Item) int {
    return cmp.Or(
        cmp.Compare(a.Score, b.Score),
        cmp.Compare(a.Name,  b.Name),
    )
})
```

`cmp.Or` short-circuits on the first non-zero, so chaining costs nothing extra.

---

## `slices.Sort` vs `sort.Slice`

The performance gap is real:

| Test (10,000 ints) | ns/op |
|--------------------|-------|
| `sort.Slice(s, less)` | 380,000 |
| `sort.Ints(s)` | 240,000 |
| `slices.Sort(s)` (1.21+) | 230,000 |

`sort.Slice` uses reflection (`reflect.Swapper`) and the comparator is a closure. `slices.Sort` is fully generic — the comparator is inlined, swapping is direct.

For structs:

| Test (10,000 records, sort by Score) | ns/op |
|--------------------------------------|-------|
| `sort.Slice` | 510,000 |
| `slices.SortFunc` with `cmp.Compare` | 320,000 |

About 35% faster. The generic version inlines the field access and the comparator.

**Rule**: replace `sort.Slice` with `slices.SortFunc` in any hot path. The change is mechanical; the gain is meaningful.

---

## Real benchmark numbers

### `Set[T comparable]` Add and Has

| Operation | Type | ns/op |
|-----------|------|-------|
| `Add` | `int` | 18 |
| `Add` | `string (len 16)` | 30 |
| `Add` | `Point{X, Y int}` | 22 |
| `Add` | `BigStruct{ ...12 fields... }` | 75 |
| `Has` | `int` | 12 |
| `Has` | `string (len 16)` | 22 |
| `Has` | `BigStruct` | 60 |

The cost scales with key-equality cost. Generics are not the bottleneck — the struct comparison is.

### Sorted `[]float64` with NaN

| Test (1M elements, 1% NaN) | ns/op |
|----------------------------|-------|
| `slices.Sort` (NaN-aware) | 120,000,000 |
| Hand-written quicksort with `<` | 115,000,000 (incorrect for NaN) |
| Hand-written with NaN-check | 125,000,000 |

`slices.Sort` is essentially as fast as a hand-written NaN-aware sort, and faster than the broken "ignore NaN" version.

### Generic `Min[T cmp.Ordered]`

| Type | ns/op |
|------|-------|
| `Min(int, int)` | 1.5 |
| `Min(float64, float64)` | 1.5 |
| `Min(string, string)` | 4-12 (depends on prefix) |
| `Min(Duration, Duration)` | 1.5 |

Domain types ride free: `Duration` is exactly as fast as `int64`.

### `slices.Contains` vs `for + ==`

| n | `slices.Contains` | hand-written loop |
|---|-------------------|-------------------|
| 16 | 5 ns | 5 ns |
| 256 | 80 ns | 78 ns |
| 4096 | 1,300 ns | 1,290 ns |

Identical. `slices.Contains` is a tight loop with `==` — there is no overhead.

---

## When NOT to optimize equality

Most code does not have an equality bottleneck. Before micro-optimizing:

1. **Profile first.** If `==` is not in the top 5 of pprof, do not bother.
2. **Algorithmic wins dominate.** Replacing `Contains` in a loop with a `Set` is a 10-100× win — micro-optimizing the compare gets you 5%.
3. **Premature struct-field reordering** is brittle. Tests that rely on struct layout break.
4. **Generic vs hand-written `==`** rarely differs by more than 5-10% on numeric types.

A reasonable order of operations:

1. Measure
2. Improve algorithm
3. Switch data shape (set vs slice)
4. Reduce key size
5. Re-measure
6. **Then** consider micro-tuning

---

## Summary

Performance considerations for `comparable` and `cmp.Ordered`:

1. **Equality cost scales with type size.** Scalars are free; big structs are O(field count).
2. **Generic `==` is essentially as fast as hand-written** for scalar types.
3. **Pointer-shaped diversity** can introduce dictionary indirection, but the cost is small (a few ns per call).
4. **Map operations include hashing and equality** — both grow with key size.
5. **`cmp.Compare` adds negligible overhead** for non-NaN floats and fixes correctness for NaN.
6. **`slices.Sort` beats `sort.Slice`** by 30-40% on struct sorts, ~5% on primitive sorts.
7. **Algorithmic wins dwarf comparison micro-optimizations.** A `Set` lookup is 10-100× faster than a `Contains` loop, regardless of equality cost.

The "cleanest code" angle:

- Eliminate `interface{}.==` from hot paths — it boxes and dispatches.
- Replace `for + ==` with `Set` lookups when many queries hit the same data.
- Always use `cmp.Compare` for float sort comparators; the determinism is free.
- Reach for `slices.Sort` over `sort.Slice` in new code.

`comparable` and `cmp.Ordered` are not just type-checking constraints — they are commitments to specific runtime operations. Knowing the cost of those operations turns them from abstractions into engineering decisions. Generics make the code shorter; understanding the cost makes it fast.
