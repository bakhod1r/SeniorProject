# Sentinel & Special Values — Optimization Drills

> **Category:** [Resource & Type-Safety Patterns](../README.md) — when a sentinel is the *performance* answer and when a wrapper costs nothing.

8 drills weighing correctness against allocation and branch cost.

Apple M2 Pro, single thread. Numbers indicative, not authoritative.

---

## Table of Contents

1. [Drill 1: Keep `-1` on a Hot Search Path](#drill-1-keep--1-on-a-hot-search-path)
2. [Drill 2: `OptionalInt` over Boxed `Optional<Integer>`](#drill-2-optionalint-over-boxed-optionalinteger)
3. [Drill 3: Let Escape Analysis Erase `Optional`](#drill-3-let-escape-analysis-erase-optional)
4. [Drill 4: `(value, ok)` Instead of an Allocating Wrapper (Go)](#drill-4-value-ok-instead-of-an-allocating-wrapper-go)
5. [Drill 5: Don't Wrap Sentinel Errors in Hot Loops](#drill-5-dont-wrap-sentinel-errors-in-hot-loops)
6. [Drill 6: Sentinel Node to Delete Branches](#drill-6-sentinel-node-to-delete-branches)
7. [Drill 7: Length-Prefix over Null-Terminator Scans](#drill-7-length-prefix-over-null-terminator-scans)
8. [Drill 8: Branchless NaN Filtering](#drill-8-branchless-nan-filtering)

---

## Drill 1: Keep `-1` on a Hot Search Path

### "Safe" but costly

```java
Optional<Integer> find(int[] a, int key) {
    for (int i = 0; i < a.length; i++)
        if (a[i] == key) return Optional.of(i);   // boxes when stored/escaped
    return Optional.empty();
}
```

In a tight inner loop where the result escapes (stored, collected), each hit allocates an `Integer` + `Optional`.

### Optimized — out-of-domain sentinel

```java
int find(int[] a, int key) {
    for (int i = 0; i < a.length; i++)
        if (a[i] == key) return i;
    return -1;   // provably out of the index domain → no ambiguity, no alloc
}
```

**Lesson:** A sentinel is the *correct* optimization precisely when it is out-of-domain and the wrapper allocation is measurable. `-1` for an index qualifies.

---

## Drill 2: `OptionalInt` over Boxed `Optional<Integer>`

### Slow

```java
Optional<Integer> firstLow(int[] xs, int t) { /* Optional<Integer> boxes */ }
```

### Optimized

```java
OptionalInt firstLow(int[] xs, int t) {
    for (int i = 0; i < xs.length; i++)
        if (xs[i] < t) return OptionalInt.of(i);
    return OptionalInt.empty();
}
```

### Benchmark
```
Optional<Integer>   avgt  5.0 ns/op  16 B/op  (Integer box)
OptionalInt         avgt  1.4 ns/op   0 B/op
```

**Lesson:** When you want explicit absence *and* primitives, the primitive Optionals remove the boxing that pushes teams back toward `-1`.

---

## Drill 3: Let Escape Analysis Erase `Optional`

### Belief: "`Optional` always allocates"

```java
int logins = findUser(id)
    .map(User::loginCount)
    .orElse(0);
```

### Reality

The `Optional` is created and consumed in the same scope, so HotSpot scalar-replaces it — **zero heap allocation** post-JIT.

### Benchmark
```
OptionalMapOrElse (escaped scope)   avgt  1.3 ns/op   0 B/op
OptionalStoredInField               avgt  8.0 ns/op  16 B/op
```

**Lesson:** Don't reach for a sentinel to avoid an `Optional` allocation that the JIT already elides. Only `Optional` *stored in fields/collections* truly allocates — and that usage is an anti-pattern anyway.

---

## Drill 4: `(value, ok)` Instead of an Allocating Wrapper (Go)

### Slow — pointer-as-optional

```go
func lookup(m map[string]int, k string) *int {
    if v, ok := m[k]; ok { return &v }  // &v escapes → heap alloc
    return nil
}
```

### Optimized — comma-ok

```go
func lookup(m map[string]int, k string) (int, bool) {
    v, ok := m[k]
    return v, ok   // two registers, no allocation
}
```

### Benchmark
```
BenchmarkPointerOptional-8   200M   6.0 ns/op   8 B/op
BenchmarkCommaOk-8           1000M  0.9 ns/op   0 B/op
```

**Lesson:** In Go, multiple return values are the zero-allocation out-of-band channel; `*T`-as-optional escapes to the heap.

---

## Drill 5: Don't Wrap Sentinel Errors in Hot Loops

### Slow

```go
for _, k := range keys {
    if _, err := get(k); errors.Is(err, ErrMiss) {
        miss++   // get() does fmt.Errorf("...: %w", ErrMiss) → 48 B per miss
    }
}
```

### Optimized — return the bare sentinel on the hot path

```go
func get(k string) (int, error) {
    if v, ok := store[k]; ok { return v, nil }
    return 0, ErrMiss     // no wrapping → no allocation
}
```

### Benchmark
```
BenchmarkWrappedErr-8   20M   60 ns/op  48 B/op
BenchmarkBareSentinel-8 500M   2.0 ns/op  0 B/op
```

**Lesson:** Wrap with `%w` for *context at boundaries*; return the bare sentinel error in hot loops. `errors.Is` works for both.

---

## Drill 6: Sentinel Node to Delete Branches

### Slow — branch per operation

```java
void insertFront(int v) {
    Node n = new Node(v);
    if (head == null) { head = n; }       // first-node special case
    else { n.next = head; head = n; }
}
```

### Optimized — dummy head sentinel

```java
private final Node head = new Node(0);    // sentinel, never null
void insertFront(int v) {
    Node n = new Node(v);
    n.next = head.next;
    head.next = n;                         // unconditional — no branch
}
```

**Lesson:** A sentinel *node* removes the boundary branch from every insert/delete. The win is fewer mispredicted branches in the structure's hottest methods, paid for with one allocation at construction.

---

## Drill 7: Length-Prefix over Null-Terminator Scans

### Slow — `\0` sentinel forces O(n) length

```c
size_t n = strlen(s);   // scans to the '\0' sentinel every call
```

Repeated `strlen` in a loop is quadratic over a growing string.

### Optimized — carry the length out of band

```go
// Go strings are {ptr, len}: length is O(1), no scan, no over-read.
n := len(s)
```

**Lesson:** A null-terminator is an in-band length sentinel with O(n) length and over-read risk. A length-prefixed representation moves the length to a separate channel — O(1) and safe. This is "stop overloading, widen the channel" at the memory layer.

---

## Drill 8: Branchless NaN Filtering

### Slow — `NaN` poisons, or a branch per element

```python
def mean(xs):
    total = sum(xs)            # BUG-prone: one NaN → NaN result
    return total / len(xs)
```

### Optimized — vectorized NaN-aware aggregation

```python
import numpy as np
def mean(xs):
    arr = np.asarray(xs, dtype=float)
    return float(np.nanmean(arr))   # NaN excluded, SIMD, no Python-level branch
```

```java
// Java: stream filter compiles to a tight, predictable loop.
double m = Arrays.stream(xs).filter(x -> !Double.isNaN(x)).average().orElse(Double.NaN);
```

**Lesson:** `NaN` is a sentinel *inside* the numeric domain; it must be filtered explicitly. Vectorized `nan*` functions do it without per-element interpreter branches.

---

## Optimization Tips

### How to decide sentinel vs wrapper

1. **Is the sentinel out-of-domain?** If not, you have no choice — go out-of-band for correctness, performance be damned.
2. **Does the wrapper actually allocate here?** Check escape analysis (Java JFR/`-XX:+PrintInlining`, Go `-gcflags=-m`). Often it doesn't.
3. **Is this path actually hot?** Profile (`async-profiler`, `pprof`, `py-spy`) before trading clarity for a sentinel.

### Checklist
- [ ] Keep out-of-domain sentinels (`-1` index, `EOF`) on proven hot paths.
- [ ] Use `OptionalInt`/`(value, ok)` to avoid boxing without overloading a value.
- [ ] Trust escape analysis to erase non-escaping `Optional`s.
- [ ] Don't wrap sentinel errors in hot loops; wrap at boundaries.
- [ ] Use sentinel *nodes* to delete boundary branches.
- [ ] Prefer length-prefixed over null-terminated for repeated length queries.
- [ ] Filter `NaN` explicitly, ideally vectorized.

### Anti-optimizations
- ❌ Overloading `0`/`""`/`-1`-on-a-signed-int to "save an allocation" — buys a silent-corruption bug.
- ❌ Reaching for a sentinel to dodge an `Optional` the JIT already elides.
- ❌ Pointer-as-optional in Go (`*T`) — it escapes; use `(value, ok)`.
- ❌ Exposing a sentinel node across an API to avoid a check.

---

## Summary

Sentinels are the *right* optimization only when they are **out of the valid domain** and the wrapper cost is **real and on a hot path**. Most of the time the wrapper (`Optional`, `(value, ok)`) is free or near-free — escape analysis, primitive Optionals, and multiple returns remove the cost without the ambiguity. The genuine performance wins live in sentinel *nodes* (branch deletion) and length-prefixed representations (O(1) length), not in overloading valid values.

---

[← Find-Bug](find-bug.md) · [Resource & Type-Safety](../README.md) · [Roadmap](../../../README.md)

**Sentinel & Special Values complete.** All 8 files: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md) · [tasks](tasks.md) · [find-bug](find-bug.md) · [optimize](optimize.md).
