# Self-Encapsulation — Optimization Drills

> **Category:** [Object & State Patterns](../README.md) — when the accessor is free, when it isn't, and how to exploit the seam for laziness and caching without paying twice.

Apple M2 Pro, single thread.

---

## Optimization 1: Trust the Inliner (Don't Hand-Inline)

### Premature "optimization"

```java
double withTax() { return total * 1.2; }   // reads raw field "for speed"
```

Done to avoid a "method call." But it destroys the seam.

### Optimized — keep the accessor

```java
double getTotal() { return total; }
double withTax()  { return getTotal() * 1.2; }
```

### Benchmark (JMH, post-warmup)

```
rawFieldRead          0.30 ns/op
monomorphicGetter     0.30 ns/op   ← inlined to the same field load
```

**No cost.** HotSpot inlines the trivial getter; the machine code is identical. You kept the seam for free.

---

## Optimization 2: Lazy Initialization Behind the Accessor

### Eager — pays even when unused

```java
class Report {
    private final List<Row> rows = buildRows();   // always built
    List<Row> getRows() { return rows; }
}
```

If most `Report`s never read `rows`, the build is wasted.

### Optimized — lazy seam

```java
class Report {
    private List<Row> rows;
    List<Row> getRows() {
        if (rows == null) rows = buildRows();   // built on first access only
        return rows;
    }
}
```

Self-encapsulation made this a one-method change; callers of `getRows()` are untouched. See [Lazy Initialization](../02-lazy-initialization/junior.md).

### Tradeoff

- Saves the build when unused.
- Getter now writes → needs synchronization if shared across threads (Optimization 6).

---

## Optimization 3: Memoize a Computed "Field"

### Slow — recomputes every read

```java
double getTotal() {
    return items.stream().mapToDouble(Item::amount).sum();   // O(n) per call
}
boolean isLarge()  { return getTotal() > 1000; }
String  summary()  { return "Total: " + getTotal(); }        // recomputes again
```

### Optimized — cache behind the same accessor

```java
private Double cachedTotal;
double getTotal() {
    if (cachedTotal == null)
        cachedTotal = items.stream().mapToDouble(Item::amount).sum();
    return cachedTotal;
}
// Invalidate on mutation:
void add(Item i) { items.add(i); cachedTotal = null; }
```

The seam lets you slip a cache in without touching `isLarge` or `summary`. Generalizes to [Memoization & Caching](../03-memoization-and-caching/junior.md).

### Caveat

Only safe if you invalidate (`cachedTotal = null`) on every mutation — see [find-bug Bug 8](find-bug.md).

---

## Optimization 4: Python — Hoist Property Reads Out of Hot Loops

### Slow — property fetched every iteration

```python
class Body:
    @property
    def mass(self) -> float:
        return self._mass

def kinetic(bodies):
    return sum(0.5 * b.mass * b.v ** 2 for b in bodies)   # mass via descriptor each time
```

### Optimized — read the property once per object

```python
def kinetic(bodies):
    total = 0.0
    for b in bodies:
        m = b.mass            # one descriptor call
        v = b.v
        total += 0.5 * m * v ** 2
    return total
```

### Benchmark (`timeit`, 1e7 iterations)

```
property in loop      ~ 130 ns/access
hoisted local          ~ 25 ns/access
```

A Python `@property` is a real descriptor call (~5× a bare attribute). Inside a hot numeric loop, hoist it into a local. Unlike Java/Go, the Python accessor is **not** inlined away.

---

## Optimization 5: Use `cached_property` for Lazy Self-Encapsulated Fields

### Recompute every time

```python
class Document:
    def __init__(self, raw): self._raw = raw
    @property
    def tokens(self):
        return self._raw.split()    # re-splits on every access
```

### Optimized — compute once, then bare-attribute speed

```python
from functools import cached_property

class Document:
    def __init__(self, raw): self._raw = raw
    @cached_property
    def tokens(self):
        return self._raw.split()    # first access stores into __dict__
```

After first access, `cached_property` writes the result into the instance `__dict__`, so later reads are bare-attribute fast (~25 ns), not descriptor-speed. Only valid when `_raw` never changes.

---

## Optimization 6: Thread-Safe Lazy Without Lock Contention

### Correct but contended

```java
synchronized List<Row> getRows() {        // every read locks
    if (rows == null) rows = buildRows();
    return rows;
}
```

Every reader pays lock overhead even after initialization.

### Optimized — double-checked locking

```java
private volatile List<Row> rows;
List<Row> getRows() {
    List<Row> r = rows;
    if (r == null) {
        synchronized (this) {
            r = rows;
            if (r == null) rows = r = buildRows();
        }
    }
    return r;
}
```

Locks only on the (rare) initialization path; warm reads are a single `volatile` load. In Go, `sync.Once` gives the same profile with cleaner code.

### Benchmark (Java, 8 threads, warm)

```
synchronized getter      ~ 18 ns/op   (lock per read)
double-checked + volatile ~ 0.8 ns/op  (volatile load only)
```

---

## Optimization 7: Avoid Megamorphic Accessors in Hot Loops

### Slow — accessor overridden by many subclasses

```java
abstract class Shape { abstract double getArea(); }   // 6 subclasses override

double total(List<Shape> shapes) {
    double s = 0;
    for (Shape sh : shapes) s += sh.getArea();   // megamorphic → vtable dispatch
    return s;
}
```

With ≥3 distinct implementations seen, HotSpot stops inlining `getArea()`; each call is a dispatch and the arithmetic can't be fused.

### Optimized — when the loop is genuinely hot

```java
// Partition by type so each loop is monomorphic, or
// precompute areas into a double[] once and sum the array.
double[] areas = shapes.stream().mapToDouble(Shape::getArea).toArray();
double s = 0; for (double a : areas) s += a;   // monomorphic primitive loop
```

### Benchmark

```
megamorphic getArea in loop   ~ 2.1 ns/call
precomputed double[] sum      ~ 0.3 ns/element
```

This is the cost of *polymorphism*, not self-encapsulation — you bought an override seam and paid in inlinability. Optimize only with a profiler in hand.

---

## Optimization 8: Don't Self-Encapsulate Pure Data

### Over-engineered

```java
public final class Point {
    private final double x, y;
    public double getX() { return x; }   // never computed, never overridden
    public double getY() { return y; }
}
```

For an immutable value object with no invariant and no future computation, the accessors are pure noise.

### Optimized

```java
public record Point(double x, double y) {}    // compact, immutable, zero ceremony
```

```python
from dataclasses import dataclass
@dataclass(frozen=True)
class Point:
    x: float
    y: float
```

Reserve self-encapsulation for fields whose representation may change.

---

## Optimization Tips

### How to find self-encapsulation costs

1. **Confirm inlining.** Java: `-XX:+PrintInlining`. Go: `go build -gcflags=-m`. If a trivial getter inlined, its cost is zero.
2. **Profile Python property hotspots** with `py-spy` / `cProfile`; descriptor calls show up by name.
3. **Watch for megamorphic sites** — a polymorphic accessor in a tight loop is the rare real cost.
4. **Benchmark before "optimizing" away the seam** — you usually lose flexibility for no speed.

### Checklist

- [ ] Keep trivial getters — they inline to free.
- [ ] Move expensive build behind a lazy accessor.
- [ ] Memoize a computed field behind its accessor (and invalidate on mutation).
- [ ] In Python, hoist property reads out of hot loops; use `cached_property` for lazy fields.
- [ ] Use double-checked locking / `sync.Once` for thread-safe lazy seams.
- [ ] Precompute or partition to dodge megamorphic accessors in hot loops.
- [ ] Use records/dataclasses for pure data instead of accessors.

### Anti-optimizations

- ❌ **Hand-inlining the getter** to "save a call" — destroys the seam, saves nothing (JIT already inlines it).
- ❌ **Caching a computed field whose inputs mutate** — stale data.
- ❌ **`synchronized` on every read** when double-checked locking suffices.
- ❌ **Eager getters in Python/Go** — noise, and Python properties aren't even free.

---

## Summary

Self-encapsulation is **free on the hot path** (the getter inlines to a raw field load) and is the *enabler* for the real optimizations — lazy initialization and memoization slipped behind the accessor with zero caller changes. The genuine costs are narrow: Python descriptor overhead in tight loops, megamorphic/interface dispatch, and unsynchronized lazy seams. Keep the seam; optimize what sits behind it.

---

[← Find-Bug](find-bug.md) · [Object & State](../README.md)

**Self-Encapsulation roadmap complete.** All 8 files: [junior](junior.md) · [middle](middle.md) · [senior](senior.md) · [professional](professional.md) · [interview](interview.md) · [tasks](tasks.md) · [find-bug](find-bug.md) · [optimize](optimize.md).
