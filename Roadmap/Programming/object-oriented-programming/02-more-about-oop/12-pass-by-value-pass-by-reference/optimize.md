# Pass by Value / Pass by Reference — Optimization

Twelve before/after exercises focused on argument passing performance.

---

## Optimization 1 — Avoid boxing in hot paths

**Before:**
```java
public void process(Integer count) { ... }

for (int i = 0; i < 1_000_000; i++) {
    process(i);    // boxes each iteration (uncached for large i)
}
```

**After:**
```java
public void process(int count) { ... }

for (int i = 0; i < 1_000_000; i++) {
    process(i);    // no boxing
}
```

**Why:** boxing `int` to `Integer` for values outside [-128, 127] allocates. Hot loops can be GC-pressure dominated.

---

## Optimization 2 — Primitive specializations

**Before:**
```java
list.stream().reduce(0, Integer::sum);    // boxes int → Integer
```

**After:**
```java
list.stream().mapToInt(Integer::intValue).sum();    // primitive int
```

**Why:** primitive streams (`IntStream`, `LongStream`, `DoubleStream`) avoid boxing.

---

## Optimization 3 — Records for multiple returns

**Before:**
```java
class Result { int value; String error; }

void compute(int input, Result out) { ... }
```

Awkward + mutable.

**After:**
```java
record Result(int value, String error) {}
Result compute(int input) { ... }
```

JIT-friendly, immutable, escape-analysis-eligible.

---

## Optimization 4 — Defensive copy with `List.copyOf`

**Before:**
```java
this.items = new ArrayList<>(items);
```

**After:**
```java
this.items = List.copyOf(items);
```

**Why:** `List.copyOf` returns the input directly if already immutable. Otherwise creates immutable list. Fewer allocations.

---

## Optimization 5 — Avoid varargs in hot paths

**Before:**
```java
public void log(Object... args) { ... }

for (...) {
    log(a, b, c);    // allocates array each call
}
```

**After:** specific overloads:
```java
public void log(Object a) { ... }
public void log(Object a, Object b) { ... }
public void log(Object a, Object b, Object c) { ... }
public void log(Object... args) { ... }   // fallback
```

JIT picks the fixed-arity overload, no array allocation.

---

## Optimization 6 — Final parameters help readability

**Before:**
```java
void m(List<X> items) {
    items = filter(items);    // confusing — mutates parameter? no, just local
}
```

**After:**
```java
void m(final List<X> items) {
    final var filtered = filter(items);
}
```

`final` prevents reassignment; introduces clarity. No runtime effect.

---

## Optimization 7 — Pass arrays for ABI-friendly data

When passing many primitives, an array can be more ABI-friendly than many separate primitives:

**Before:**
```java
double computeFromMany(double a, double b, double c, double d, double e, double f, double g, double h);
```

8 args may not fit in registers; some spill to stack.

**After (when args are uniform):**
```java
double computeFromMany(double[] inputs);
```

Pass one pointer; the loop can vectorize.

Trade-off: array allocation vs argument register pressure. Profile.

---

## Optimization 8 — Records and escape analysis

```java
public double distance(Point a, Point b) {
    return Math.hypot(a.x() - b.x(), a.y() - b.y());
}

double d = distance(new Point(1, 1), new Point(2, 2));
```

If `Point` is final and the args don't escape, C2 scalarizes — no allocation. The two `new Point` calls become register operations.

Verify with `-XX:+PrintEliminateAllocations`.

---

## Optimization 9 — Avoid mutable inputs as method args

**Before:**
```java
public void process(List<Item> items) {
    items.removeIf(Item::expired);
}
```

Caller's list mutated. Surprising. Hard for JIT to prove non-escape.

**After:**
```java
public List<Item> processed(List<Item> items) {
    return items.stream().filter(i -> !i.expired()).toList();
}
```

Functional, return-based, JIT-friendlier.

---

## Optimization 10 — `MethodHandle` for typed reflection

**Before (reflection):**
```java
Method m = obj.getClass().getMethod("compute", int.class);
m.invoke(obj, 5);    // ~100x slower than direct
```

**After:**
```java
private static final MethodHandle COMPUTE = MethodHandles.lookup()
    .findVirtual(I.class, "compute", MethodType.methodType(int.class, int.class));
int result = (int) COMPUTE.invokeExact((I) obj, 5);
```

`MethodHandle.invokeExact` can be JIT-inlined.

---

## Optimization 11 — Argument-eager evaluation

If an argument is expensive, evaluate it once into a local:

**Before:**
```java
process(loadFromDb(), validate(loadFromDb()));   // loadFromDb called twice
```

**After:**
```java
var data = loadFromDb();
process(data, validate(data));
```

Saves one expensive call.

---

## Optimization 12 — Avoid lambda allocation in hot loops

**Before:**
```java
for (var item : items) {
    list.add(item -> doSomething(item));   // lambda allocated per iteration!
}
```

Wait — that's not right syntactically. The point: capturing lambdas may allocate.

**After:** lift non-changing lambdas out of loops:
```java
Function<X, Y> f = item -> doSomething(item);   // outside loop
for (var item : items) {
    list.add(f.apply(item));
}
```

For non-capturing lambdas, the JIT caches automatically. For capturing, lift if possible.

---

## Tools cheat sheet

| Tool                                          | Purpose                                |
|-----------------------------------------------|----------------------------------------|
| `-XX:+PrintEliminateAllocations`              | EA decisions                            |
| `async-profiler -e alloc`                     | Allocation flame graph                 |
| `-XX:+PrintInlining`                          | Inlining of method calls                |
| `jol-cli`                                     | Object layout                          |
| `jmh`                                         | Microbenchmark argument cost            |

---

## When to apply

- Hot inner loops with many calls
- Allocation profile shows boxing/varargs/lambda allocations
- Tight numeric kernels
- High-throughput services

## When not to

- Cold paths (config loading, startup)
- Code clarity matters more than tiny speedup
- Already JIT-optimized (verify with PrintInlining)

---

**Memorize this**: Java's pass-by-value is fast. The JIT often passes args via registers, eliminates intermediate allocations via escape analysis, and inlines monomorphic calls. Avoid boxing, varargs allocation, and capturing lambdas in hot paths. Use records for multi-return; immutable types for parameters.
