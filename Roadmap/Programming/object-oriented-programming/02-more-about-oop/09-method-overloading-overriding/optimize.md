# Method Overloading / Overriding — Optimization

Twelve before/after exercises focused on dispatch performance.

---

## Optimization 1 — `final` on hot-path methods

**Before:**
```java
public class Money {
    public Money plus(Money other) { ... }
}
```

**After:**
```java
public final class Money {
    public Money plus(Money other) { ... }
}
```

**Why:** the JIT can devirtualize calls on `Money` references — direct dispatch instead of vtable lookup.

---

## Optimization 2 — Sealed types over open polymorphism

**Before:**
```java
public abstract class Shape { abstract double area(); }
```

**After:**
```java
public sealed interface Shape permits Circle, Square, Triangle { double area(); }
```

**Why:** the closed set helps the JIT and pattern matching.

---

## Optimization 3 — Avoid megamorphism in tight loops

**Before:** loop dispatching `op.apply(a, b)` over a heterogeneous list of Op implementations.

**After:** sort by op type first, then dispatch in sub-loops:
```java
for (Op op : sortedByType) {
    switch (op) {
        case Plus p -> ...;   // monomorphic
        case Minus m -> ...;
    }
}
```

Or specialize the loop per type if possible.

---

## Optimization 4 — Use `private` for hot helpers

**Before:**
```java
public class Service {
    public void process() { compute(); /* etc */ }
    public int compute() { ... }
}
```

If `compute` doesn't need to be public:

**After:**
```java
public class Service {
    public void process() { compute(); /* etc */ }
    private int compute() { ... }
}
```

**Why:** private methods are non-virtual; direct dispatch (`invokespecial` or `invokevirtual` since Java 11). JIT inlines.

---

## Optimization 5 — Mark overrides with `@Override`

**Before:** override without annotation. Working correctly but no compile-time check.

**After:** add `@Override`. Catches typos and signature mismatches at compile time.

**Why:** zero runtime cost, prevents subtle bugs. Always use it.

---

## Optimization 6 — Avoid bridge method overhead

For generic + override:

```java
class Box<T> { void put(T x) { } }
class StringBox extends Box<String> {
    @Override void put(String x) { }
}
```

The bridge method `put(Object)` indirects through `put(String)`. Most callers using `Box<String>` go through it. The JIT inlines, but cold paths pay the indirection.

Mitigation: use `final` on `StringBox` so JIT knows the dispatch is direct.

---

## Optimization 7 — Pattern match over instanceof chain

**Before:**
```java
if (s instanceof Circle) return Math.PI * ((Circle) s).r() * ((Circle) s).r();
if (s instanceof Square) return ((Square) s).s() * ((Square) s).s();
return 0;
```

**After:**
```java
return switch (s) {
    case Circle c -> Math.PI * c.r() * c.r();
    case Square sq -> sq.s() * sq.s();
    default -> 0;
};
```

The pattern matching switch dispatches via efficient classifier; the JIT inlines.

---

## Optimization 8 — Avoid overload ambiguity at hot paths

If the call site has many overloads, the compiler may pick a slower one (e.g., boxing in phase 2). Be explicit:

```java
m(5);                  // calls m(int) — phase 1
m(Integer.valueOf(5)); // calls m(Integer) directly
```

---

## Optimization 9 — Use specific types in arguments

**Before:**
```java
public void process(List<Item> items) { ... }
```

If `items` is always `ArrayList`:

**After (when warranted):**
```java
public void process(ArrayList<Item> items) { ... }
```

**Why:** JIT can optimize for the specific type; avoid interface dispatch.

But: this couples the API. For internal helpers it's fine; for public APIs, prefer interfaces.

---

## Optimization 10 — Consolidate overloads

**Before:**
```java
void log(String s) { logImpl(s, 0, 0); }
void log(String s, int level) { logImpl(s, level, 0); }
void log(String s, int level, int category) { logImpl(s, level, category); }
private void logImpl(String s, int level, int category) { ... }
```

**After (when not needed):**
```java
void log(String s) { ... }                            // one method
void log(String s, int level) { ... }                  // another method
```

Don't add overloads "just in case." Each adds bytecode and complicates resolution.

---

## Optimization 11 — Check JIT decisions

```bash
java -XX:+UnlockDiagnosticVMOptions -XX:+PrintInlining -XX:+PrintCompilation MyApp 2>&1 | grep -E '(inline|fail)'
```

Look for:
- `inline (hot)` on overrides — JIT did inline
- `failed: callee not inlineable` — likely megamorphic

Fix the megamorphic cases by reducing types or specializing.

---

## Optimization 12 — Records for variant data

For variants that differ in data, records implementing sealed interface are JIT-friendly:

```java
sealed interface Event permits UserCreated, UserUpdated, UserDeleted { }
record UserCreated(long id, String name) implements Event { }
record UserUpdated(long id, String oldName, String newName) implements Event { }
record UserDeleted(long id) implements Event { }
```

Pattern match dispatches efficiently; each record is `final` and JIT-friendly.

---

## Tools cheat sheet

| Tool                                          | Purpose                                |
|-----------------------------------------------|----------------------------------------|
| `-XX:+PrintInlining`                          | Inlining decisions                     |
| `-XX:+PrintCompilation`                       | What got JIT'd                         |
| `async-profiler -e cycles`                    | CPU flame graph                        |
| `jol-cli`                                     | Method dispatch overhead estimates     |
| `jmh`                                         | Benchmark dispatch types               |

---

## When optimization matters

- High-throughput services (1M+ requests/sec)
- Hot inner loops with virtual dispatch
- Profile shows megamorphic call sites
- Bridge methods accumulating in tight code

## When it doesn't

- Cold paths (config, startup)
- Code clarity matters more
- Already monomorphic per profile

---

**Memorize this**: overriding is fast in modern JVMs *when monomorphic*. The JIT inlines well-warmed virtual calls. `final`, sealed types, and `@Override` are your design tools. Overloading has no runtime cost — selection is at compile time. Profile before optimizing; trust the JIT for typical code.
