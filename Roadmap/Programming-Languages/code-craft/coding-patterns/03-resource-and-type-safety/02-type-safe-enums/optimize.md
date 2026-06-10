# Type-Safe Enums — Optimization Drills

> **Category:** [Resource & Type-Safety Patterns](../README.md) — squeeze correctness *and* performance out of enums: the right collection, no wasted allocations, no fragile coupling.

10 inefficient implementations + benchmarks + optimizations.

Apple M2 Pro, single thread. Indicative numbers.

---

## Optimization 1: `EnumSet` Instead of `HashSet<Enum>`

### Slow

```java
Set<Perm> perms = new HashSet<>();
perms.add(Perm.READ);
perms.contains(Perm.WRITE);   // hash + bucket lookup, boxing
```

### Optimized

```java
EnumSet<Perm> perms = EnumSet.of(Perm.READ);
perms.contains(Perm.WRITE);   // single bit test in a long
```

### Benchmark

```
HashSet<Enum>.contains    8.0 ns/op   ~48 B/op
EnumSet.contains          1.0 ns/op      0 B/op
```

`EnumSet` is a bit vector — ~8× faster and allocation-free.

---

## Optimization 2: `EnumMap` Instead of `HashMap<Enum,V>`

### Slow

```java
Map<Status, Handler> handlers = new HashMap<>();
handlers.get(status);   // hashing + bucket
```

### Optimized

```java
EnumMap<Status, Handler> handlers = new EnumMap<>(Status.class);
handlers.get(status);   // array index by ordinal
```

### Benchmark

```
HashMap<Enum,V>.get   9.0 ns/op
EnumMap.get           1.2 ns/op
```

Array-indexed by ordinal: no hashing, perfect locality, iteration in declaration order.

---

## Optimization 3: Cache `values()`

### Slow

```java
for (int i = 0; i < 1_000_000; i++) {
    Status s = Status.values()[i % Status.values().length];   // clones twice per iter
}
```

`values()` returns a *defensive clone* every call.

### Optimized

```java
private static final Status[] VALUES = Status.values();   // clone once

for (int i = 0; i < 1_000_000; i++) {
    Status s = VALUES[i % VALUES.length];
}
```

### Benchmark

```
Status.values() per call   12.0 ns/op   (+ array allocation)
cached VALUES[i]            0.5 ns/op    0 B/op
```

Cache `values()` once on hot paths.

---

## Optimization 4: `switch` Instead of `if`-chain on Enums

### Slow

```java
if (s == Status.PENDING)      { ... }
else if (s == Status.PAID)    { ... }
else if (s == Status.SHIPPED) { ... }   // linear comparisons
```

### Optimized

```java
switch (s) {                  // compiles to tableswitch (O(1) jump)
    case PENDING -> { ... }
    case PAID    -> { ... }
    case SHIPPED -> { ... }
}
```

The compiler turns enum `switch` into a `tableswitch` on the ordinal — constant-time dispatch *and* it enables exhaustiveness checking.

---

## Optimization 5: Move Lookup to a Static Map (not a linear scan)

### Slow

```java
public static Status fromCode(String code) {
    for (Status s : values())            // O(n) scan, clones values() each call
        if (s.code().equals(code)) return s;
    throw new IllegalArgumentException(code);
}
```

### Optimized

```java
private static final Map<String, Status> BY_CODE = new HashMap<>();
static { for (Status s : values()) BY_CODE.put(s.code(), s); }

public static Status fromCode(String code) {
    Status s = BY_CODE.get(code);
    if (s == null) throw new IllegalArgumentException(code);
    return s;
}
```

O(1) lookup, built once at class init.

---

## Optimization 6: `stringer` Instead of a `switch` String() in Go

### Slow / allocating

```go
func (s Status) String() string {
    return map[Status]string{Pending: "pending", Paid: "paid"}[s]   // builds a map each call!
}
```

### Optimized — `stringer`-generated

```go
//go:generate stringer -type=Status
// generated: single backing string + offset table, zero allocation
```

### Benchmark

```
map-built-per-call String()   120 ns/op   ~200 B/op
stringer String()             3.5 ns/op      0 B/op
```

The generated version is a substring of one constant string — no allocation.

---

## Optimization 7: Avoid Re-parsing Strings in Hot Loops

### Slow

```python
for row in rows:
    if Status(row["status"]) is Status.PAID:   # parse every row, every loop
        ...
```

### Optimized — parse once at ingestion

```python
# At load time:
typed = [(r, Status(r["status"])) for r in rows]

# Hot loop works on typed values:
for r, status in typed:
    if status is Status.PAID:
        ...
```

Parse strings into enums once at the boundary; the hot loop compares singletons (`is`), which is a pointer check.

---

## Optimization 8: Bitset Flags Instead of a Set of Booleans

### Slow / bulky

```java
boolean canRead, canWrite, canExecute, canDelete;   // 4 fields, scattered checks
```

### Optimized

```java
EnumSet<Perm> perms = EnumSet.of(Perm.READ, Perm.WRITE);
boolean canBoth = perms.containsAll(EnumSet.of(Perm.READ, Perm.WRITE));
```

One `long` holds all flags; set algebra (`containsAll`, `removeAll`) is a single bitwise op over the whole set.

---

## Optimization 9: Don't Allocate in Per-Constant Behavior

### Slow

```java
enum State {
    PENDING { Set<State> next() { return new HashSet<>(List.of(PAID)); } };   // allocates each call
    abstract Set<State> next();
}
```

### Optimized

```java
enum State {
    PENDING { Set<State> next() { return EnumSet.of(PAID); } };   // cheap, or...
    abstract Set<State> next();
}
// Better: precompute once.
private static final Map<State, Set<State>> NEXT = new EnumMap<>(State.class);
```

Precompute transition sets into a `static final EnumMap` so per-call behavior reads a constant, not a fresh allocation.

---

## Optimization 10: Use `IntEnum`/`StrEnum` Only When Interop Pays

### Slow boundary churn

```python
class Status(Enum):
    PAID = "paid"

json.dumps({"status": Status.PAID.value})   # manual .value everywhere
```

### Optimized for serialization-heavy paths

```python
from enum import StrEnum

class Status(StrEnum):
    PAID = "paid"

json.dumps({"status": Status.PAID})   # StrEnum IS a str — serializes directly
```

### Tradeoff

`StrEnum`/`IntEnum` remove boundary boilerplate but **weaken the type boundary** (members compare equal to raw `str`/`int`). Use them only where serialization interop is the dominant concern; prefer plain `Enum` for strict domain logic.

---

## Optimization Tips

### How to find enum bottlenecks

1. **Profile** — `async-profiler` / `py-spy` / `pprof` will show `values()` clones and per-call map builds if they're hot.
2. **Check allocations** — `values()`, `map[...]{}` literals, and `new HashSet` in per-constant methods are common allocators.
3. **Prefer `EnumSet`/`EnumMap`** the moment an enum is a collection key/element.

### Optimization checklist

- [ ] `EnumSet` over `HashSet<Enum>`.
- [ ] `EnumMap` over `HashMap<Enum,V>`.
- [ ] Cache `values()` on hot paths.
- [ ] `switch` (tableswitch) over `if`-chains.
- [ ] Static map for code→enum lookup.
- [ ] `stringer` over hand-rolled allocating `String()` in Go.
- [ ] Parse strings to enums once, at the boundary.
- [ ] Precompute per-constant data into a `static final EnumMap`.

### Anti-optimizations

- ❌ **Persisting ordinals to "save space".** Fragile; corrupts on reorder.
- ❌ **`IntEnum`/`StrEnum` for everything** to dodge `.value` — weakens the type boundary.
- ❌ **A `default:` to "skip a branch".** Disables exhaustiveness for a nanosecond saved.
- ❌ **Premature bitset micro-optimization** over `EnumSet`, which is already a bitset.

---

## Summary

Enum optimization is mostly **picking the enum-aware collection** (`EnumSet`/`EnumMap` are bit vectors / ordinal arrays), **avoiding repeated `values()` clones and per-call allocations**, and **parsing strings to enums once at the boundary**. The type-safety win is free; the performance win comes from using the structures the language already optimized for enums — without trading away the correctness guarantees.

---

[← Find-Bug](find-bug.md) · [Resource & Type-Safety](../README.md) · [Roadmap](../../../README.md)

**Type-Safe Enums roadmap complete.** All 8 files: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md) · [tasks](tasks.md) · [find-bug](find-bug.md) · [optimize](optimize.md).

**Next:** [Sentinel & Special Values](../03-sentinel-and-special-values/junior.md).
</content>
