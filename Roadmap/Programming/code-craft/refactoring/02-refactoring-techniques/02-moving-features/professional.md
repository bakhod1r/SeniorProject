# Moving Features Between Objects — Professional Level

> Runtime cost of object boundaries: dispatch, cache locality, escape analysis, allocation pressure. **What does Move Method actually cost the JIT?**

---

## Table of Contents

1. [Move Method: dispatch and inlining](#move-method-dispatch-and-inlining)
2. [Move Field: cache locality and false sharing](#move-field-cache-locality-and-false-sharing)
3. [Extract Class and object headers](#extract-class-and-object-headers)
4. [Hide Delegate: free at runtime](#hide-delegate-free-at-runtime)
5. [Inline Class and Project Valhalla](#inline-class-and-project-valhalla)
6. [Foreign Method / Local Extension and devirtualization](#foreign-method-local-extension-and-devirtualization)
7. [Go: composition, embedding, struct layout](#go-composition-embedding-struct-layout)
8. [Python: method resolution order and dispatch overhead](#python-method-resolution-order-and-dispatch-overhead)
9. [Profile-guided moves](#profile-guided-moves)
10. [Review questions](#review-questions)

---

## Move Method: dispatch and inlining

When you Move Method from `Account` to `AccountType`, the call site changes from:

```java
account.overdraftCharge();   // direct call on `this`
```

to:

```java
account.type.overdraftCharge(daysOverdrawn);   // through a field, then virtual call
```

### Bytecode

Before: `aload_0 invokevirtual #overdraftCharge`.

After:
```
aload_0
getfield #type
dload_1
invokevirtual #overdraftCharge
```

Two extra ops. Practically free in interpreted mode; **fully optimized away** in JIT-compiled mode if:

- `type` is final (or effectively final per JIT analysis).
- `AccountType.overdraftCharge` is small enough to inline.
- The receiver type is monomorphic.

### Watchout: megamorphic targets

If `AccountType` has 6 subclasses and the call site sees all of them, the JIT installs a polymorphic inline cache (PIC) — slower than a monomorphic call but faster than a vtable lookup. Move Method into a polymorphic hierarchy may cost ~3× the original direct call.

In practice: **for non-hot code, ignore. For hot code, profile.**

> Verify: `-XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining` shows whether the moved method got inlined at the call site.

---

## Move Field: cache locality and false sharing

Moving a field from `Account` to `AccountType` changes memory layout:

**Before:**
```
[ Account header | balance | interestRate | type-ref | ... ]
```

**After:**
```
[ Account header | balance | type-ref | ... ]
[ AccountType header | interestRate | ... ]
```

The interest rate is now one extra dereference away. For hot reads inside a loop iterating millions of accounts, this can show in the cache hit rate.

### When this matters

- Hot loops over many objects.
- Tight numerics where every memory access matters.

### When it doesn't

- Object dereferences are batched per call (the JVM prefetches).
- The accessed fields are small (fit in one cache line — 64 bytes).
- The application is not memory-bound.

### False sharing

If two threads write to two unrelated fields that happen to share a cache line, performance falls off a cliff (one core's write invalidates the other's cache). Java's `@Contended` (JDK 8+, jdk.internal package) pads a field to its own cache line:

```java
@jdk.internal.vm.annotation.Contended
private volatile long counter;
```

When Move Field puts a hot-write field on the same class as another hot-write field, false sharing can appear. Watch for it in profilers (perf, VTune).

### Project Valhalla

Future Java will have **value classes** — instances stored inline (no header, no dereference) like primitives. When that lands, Move Field for value classes won't add indirection. Until then, Java pays a pointer hop for every field access on a non-primitive.

---

## Extract Class and object headers

Each Java object has an **object header** — typically 12 bytes (compressed oops) or 16 bytes (full pointers). Splitting one class into two means:

- Two headers instead of one.
- Two allocations per request.
- One additional reference field.

For 1M extracted instances, that's ~28 MB of overhead.

### Mitigations

- **Object pooling** for very hot extractions (rarely needed).
- **Records** (Java 16+) are not lighter than classes in memory but are lighter cognitively.
- **Project Valhalla** (future) — value classes have no header.
- **Lombok @Data** does *not* reduce memory; it's compile-time only.

### When to care

- Allocation rate already pressuring the GC. Profile with JFR.
- Embedded / mobile contexts with tight memory.
- Per-element overhead in giant collections.

For a typical web service handling 10K req/s with 100 extracted classes per request, the GC cost is invisible.

---

## Hide Delegate: free at runtime

```java
// Before: a.getB().getC().doIt()
// After:  a.doIt()  -->  internally: getB().getC().doIt()
```

The JIT inlines the chain back. After warmup, both versions compile to the same machine code.

**Hide Delegate is a pure clarity refactoring with zero runtime cost.**

The exception: if the chain crossed an interface boundary, Hide Delegate may *change* dispatch behavior — adding a virtual call on `this`. But typically the wrapper is a `private` method on the same class — fully monomorphic, fully inlined.

---

## Inline Class and Project Valhalla

Inline Class collapses a wrapper, removing one dereference and one header.

For a `class Email { String value; }` wrapping a String:

**Before:** `Person -> Email -> String` (two hops, two headers).

**After Inline Class:** `Person -> String` (one hop, one header).

### Memory savings

For 10M `Person` instances, inlining a wrapper saves roughly:
- 16 bytes (Email header) × 10M = 160 MB.
- 4–8 bytes (Email reference) × 10M = 40–80 MB.

That's enough to matter for large-scale services.

### Valhalla preview

```java
value class Email {
    String value;
    void validate() { ... }
}
```

Once Valhalla ships, you can have the encapsulation of `Email` *without* the heap-allocated wrapper cost. Inline Class will become less necessary as a perf refactoring.

---

## Foreign Method / Local Extension and devirtualization

A wrapper class around a third-party type:

```java
class MfDate {
    private final Date date;
    public Date nextDay() { return new Date(date.getTime() + 86_400_000L); }
}
```

Each call:
1. Heap allocates the wrapper (or inlines via escape analysis if not retained).
2. Calls `nextDay`, which dereferences `date`, calls `getTime`, etc.

JIT typically inlines `nextDay` and the wrapper allocation is scalar-replaced. **Net cost: zero in steady state.**

The exception: when the wrapper is stored or returned (escapes), the allocation is real.

### Kotlin extension functions vs. Java wrappers

Kotlin `fun Date.nextDay()` compiles to a static method `DateExtKt.nextDay(Date)`. **No allocation, no wrapper.** Strictly cheaper than the Java wrapper approach.

This is one of the rare cases where modern language features ship with measurably lower runtime cost.

---

## Go: composition, embedding, struct layout

Go uses struct **embedding** to compose:

```go
type Stamp struct { time.Time }
func (s Stamp) NextDay() Stamp { return Stamp{s.Time.AddDate(0, 0, 1)} }
```

`Stamp` embeds `time.Time`. Methods on `time.Time` are promoted to `Stamp`. Memory layout: `Stamp` is exactly the size of `time.Time` plus zero overhead (assuming alignment).

### Field layout matters in Go

Go's compiler doesn't reorder fields. Putting an `int8` between two `int64`s wastes 14 bytes per struct due to alignment.

```go
type Bad struct {  // 24 bytes
    a int64
    b int8
    c int64
}

type Good struct { // 16 bytes
    a int64
    c int64
    b int8
}
```

When Move Field across structs, watch your alignment. For 10M instances, the difference is 80 MB.

### Pointer methods vs. value methods

Move Method between Go types: the receiver type matters. `func (s *Stamp) X()` vs `func (s Stamp) X()`:

- Value receiver: the struct is copied on each call. For a 64-byte struct, that's a 64-byte memcpy per call.
- Pointer receiver: just a pointer pass.

Generally use pointer receivers for structs with state, value receivers for small immutable types. Move Method should preserve the existing receiver style.

---

## Python: method resolution order and dispatch overhead

Every method call in CPython does:
1. Look up `obj.method` — searches MRO (Method Resolution Order) until found.
2. Bind: creates a bound method object.
3. Call: invokes via `CALL_FUNCTION`.

**Every step costs.** Move Method between classes typically doesn't change costs because both old and new classes go through the same MRO machinery.

### `__slots__` matters

A class with `__slots__ = ("name", "age")` uses fixed-offset attribute access instead of dict lookup. Roughly 2× faster attribute reads.

```python
class Person:
    __slots__ = ("name", "age")
```

When Extracting a small data-only class, **always** use `__slots__` (or `@dataclass(slots=True)` in 3.10+). Otherwise each instance has its own dict — significant memory overhead at scale.

### Free function vs. method

A method call has more overhead than a free function:
- Method: bound method creation, MRO lookup.
- Free function: direct lookup, no binding.

Inline Class that demotes a method to a free function can be a small Python perf win for hot code. (PyPy collapses these.)

---

## Profile-guided moves

For Composing Methods, profile-guided refactoring is well-established. For Moving Features, the calculus is similar but the units are different:

- Profile by class — which classes are allocation-hot.
- Profile by call site — which method calls dominate the wall clock.
- Profile by GC — which classes drive GC pauses.

### Tools

- **JFR (Java Flight Recorder)** — built into the JVM. Per-class allocation, per-method CPU.
- **async-profiler** — flame graphs, less overhead than JFR for some workloads.
- **VisualVM** — quick interactive view.
- **pprof** (Go) — `pprof -alloc_objects`, `pprof -inuse_space`, `pprof -cpu`.
- **scalene** (Python) — line-level CPU + memory.

When you see one class dominating allocations, that's a candidate for either Inline Class (remove a wrapper) or pooling. When you see one method dominating CPU, Move Method probably won't help — Composing Methods (extract & specialize) might.

---

## Review questions

1. What's the bytecode cost of Move Method in the JVM? In steady state?
2. How does Move Field affect cache locality?
3. What is `@Contended` and when do you use it?
4. How do object headers factor into the cost of Extract Class?
5. Why is Hide Delegate free at runtime?
6. How does Project Valhalla change the Inline Class calculus?
7. What's the runtime cost of a Kotlin extension function vs. a Java wrapper?
8. How does Go struct field layout affect Move Field decisions?
9. Why does Python `__slots__` matter when Extracting a class?
10. Which profilers do you reach for to validate a Moving Features refactor?
