# Final Keyword — Optimize the Code

> 12 exercises showing how `final` choices affect performance and correctness. Numbers illustrative; confirm in your environment with JMH.

---

## Optimization 1 — Mark hot leaf methods `final` for JIT

**Slow:**

```java
public class StringUtils {
    public boolean isEmpty(String s) { return s == null || s.isEmpty(); }
}
```

In a tight loop with this method, the JIT inlines via CHA — but if a subclass appears later, the compiled code is invalidated.

**Better:**

```java
public final class StringUtils {
    public boolean isEmpty(String s) { ... }
}
```

Or mark the method `final`.

**Why.** No CHA dependency, no deopt risk. Free win when subclassing isn't needed.

---

## Optimization 2 — Use `final` fields for safe publication

**Slow:**

```java
public class Config {
    private String name;            // not final
    public Config(String name) { this.name = name; }
}

// Thread A:
sharedConfig = new Config("prod");

// Thread B:
sharedConfig.name;     // may be null without synchronization
```

Without `final` or `volatile`, thread B may see `name` at default value.

**Better:**

```java
public final class Config {
    private final String name;
    public Config(String name) { this.name = name; }
}
```

Now JLS §17.5 guarantees thread B sees `name` correctly after observing the reference.

**Why.** No synchronization needed for immutable publication. Faster than `volatile` or `synchronized`.

---

## Optimization 3 — Records over hand-rolled value classes

**Slow (in code maintenance):**

```java
public final class Point {
    private final int x, y;
    public Point(int x, int y) { this.x = x; this.y = y; }
    public int x() { return x; }
    public int y() { return y; }
    @Override public boolean equals(Object o) { ... }
    @Override public int hashCode() { ... }
    @Override public String toString() { ... }
}
```

35 lines of boilerplate.

**Better:**

```java
public record Point(int x, int y) {}
```

1 line. Records also benefit from `invokedynamic`-based `equals`/`hashCode` that the JIT can specialize.

**Why.** Less code to maintain, fewer chances for boilerplate bugs (typos in `equals`/`hashCode`), JIT-friendlier dispatch.

---

## Optimization 4 — Use `final` on parameters captured by lambdas

**Slow (compilation friction):**

```java
String prefix = "user_";
Runnable r = () -> System.out.println(prefix + name);
prefix = "admin_";          // breaks the lambda capture — compile error
```

**Better:**

Either declare `final`:

```java
final String prefix = "user_";
Runnable r = () -> System.out.println(prefix + name);
```

Or just don't reassign:

```java
String prefix = "user_";    // effectively final
Runnable r = () -> System.out.println(prefix + name);
```

**Why.** Minor performance difference; main benefit is *clarity* — readers see "this is captured" intent.

---

## Optimization 5 — `static final` constants for compile-time inlining

**Slow:**

```java
public static int max() { return 100; }

if (count > Config.max()) ...
```

Each check is a method call. JIT usually inlines, but adds CHA dependencies and depends on warmup.

**Better:**

```java
public static final int MAX = 100;

if (count > Config.MAX) ...
```

`javac` inlines the value `100` at compile time. No method call. Zero runtime cost.

**Why.** Compile-time inlining is the cheapest possible operation. Caveat: cross-jar consumers must recompile to pick up changes.

---

## Optimization 6 — Final fields enable JIT constant-folding

**Slow:**

```java
public class Config {
    public int retryCount = 3;
}

Config c = new Config();
for (int i = 0; i < c.retryCount; i++) { ... }
```

The JIT must re-read `c.retryCount` each iteration (it could change).

**Better:**

```java
public final class Config {
    public final int retryCount = 3;
}
```

With `-XX:+TrustFinalNonStaticFields` (or in trusted contexts), the JIT may fold the loop bound to a constant, enabling unrolling and other optimizations.

**Why.** Final fields communicate to the JIT that the value won't change, enabling more aggressive optimization. The win is small but real on hot paths.

---

## Optimization 7 — Sealed + final exhaustiveness over instanceof chain

**Slow:**

```java
public Object handle(Event e) {
    if (e instanceof StartEvent)  return handleStart((StartEvent) e);
    if (e instanceof StopEvent)   return handleStop((StopEvent) e);
    if (e instanceof ErrorEvent)  return handleError((ErrorEvent) e);
    throw new IllegalStateException();
}
```

Multiple type checks; runtime.

**Better:**

```java
public sealed interface Event permits StartEvent, StopEvent, ErrorEvent {}

public Object handle(Event e) {
    return switch (e) {
        case StartEvent s -> handleStart(s);
        case StopEvent  s -> handleStop(s);
        case ErrorEvent err -> handleError(err);
    };
}
```

Pattern matching is slightly faster (single dispatch); compiler enforces exhaustiveness.

**Why.** Compile-time guarantee + runtime efficiency. Adding a new variant breaks the switch *at compile time*, not at runtime.

---

## Optimization 8 — Final reference + immutable type for thread-safe sharing

**Slow:**

```java
public class Config {
    private Map<String, String> settings;
    public Config(Map<String, String> s) { this.settings = s; }
    public synchronized Map<String, String> settings() { return settings; }
}
```

Synchronization on every read.

**Better:**

```java
public final class Config {
    private final Map<String, String> settings;
    public Config(Map<String, String> s) { this.settings = Map.copyOf(s); }
    public Map<String, String> settings() { return settings; }   // no sync needed
}
```

Final reference + immutable map = inherently thread-safe. No locks.

**Why.** Eliminates synchronization overhead. JMM freeze rule guarantees safe publication.

---

## Optimization 9 — Avoid `final` static of mutable types

**Slow:**

```java
public static final List<String> ALLOWED = new ArrayList<>(List.of("a", "b"));
```

The `final` is misleading — callers can `ALLOWED.add(...)` and corrupt the constant.

**Better:**

```java
public static final List<String> ALLOWED = List.of("a", "b");
```

`List.of` returns an immutable list. Now `ALLOWED.add(...)` throws `UnsupportedOperationException`.

**Why.** True immutability. Plus, `List.of` allocates a specialized small-list implementation that's slightly more memory-efficient than `ArrayList`.

---

## Optimization 10 — `final` in subclass constructor avoids partial init

**Slow (subtle):**

```java
public class Parent {
    private int initialized;
    public Parent() {
        init();                       // overridable!
    }
    protected void init() { initialized = 1; }
}

public class Child extends Parent {
    private final int childField = 42;
    @Override protected void init() {
        // childField is still 0 here — parent's ctor runs first
        process(childField);          // uses 0, not 42
    }
}
```

**Better:**

Don't call overridable methods from constructor. Mark `init` `private` or `final`:

```java
public class Parent {
    public Parent() { initInternal(); }
    private void initInternal() { ... }
}
```

Or move initialization out of the constructor entirely.

**Why.** Subclass `final` fields aren't initialized until *after* the parent's constructor runs. Parent calling overridable methods sees them at default values.

---

## Optimization 11 — Cache hashCode in `final` value type

**Slow:**

```java
public final class CompoundKey {
    private final String a, b, c;
    @Override public int hashCode() {
        return Objects.hash(a, b, c);    // boxing + array allocation per call
    }
}
```

In a hot `HashMap.get` path, this allocates per call.

**Better:**

```java
public final class CompoundKey {
    private final String a, b, c;
    private final int cachedHash;

    public CompoundKey(String a, String b, String c) {
        this.a = a; this.b = b; this.c = c;
        int h = a.hashCode();
        h = 31 * h + b.hashCode();
        h = 31 * h + c.hashCode();
        this.cachedHash = h;
    }

    @Override public int hashCode() { return cachedHash; }
}
```

Hash computed once at construction; subsequent calls are field reads.

**Why.** Eliminates per-call boxing and varargs allocation. Works because the class is `final` and immutable — the hash is stable.

---

## Optimization 12 — Use `final` to enable record migration

**Slow (process):**

```java
public class User {                    // not final
    private final long id;
    private final String name;
    // ... 35 lines of boilerplate
}
```

To migrate to a record later, you'd need to ensure no subclasses exist. Hard to verify.

**Better:**

Mark `final` from day one:

```java
public final class User { ... }
```

Now you know there are no subclasses. Migrating to a record is just a syntactic refactor:

```java
public record User(long id, String name) { ... }
```

**Why.** `final` from the start preserves the option to migrate to records (or simpler representations) later. Marking `final` is reversible (relax later if needed); adding `final` after subclasses exist requires migration work.

---

## Methodology recap

For every change:

1. **Profile first.** Use `async-profiler` for hot paths; JFR for allocation; JIT logs (`-XX:+PrintInlining`) for optimization decisions.
2. **Measure with JMH.** Most `final`-related wins are micro (1-10%). Measure to confirm.
3. **Measure JMM impact.** For concurrent code, `final` saves explicit synchronization — a much bigger win than per-call optimization.
4. **Trust records and immutability.** Cleaner code, JIT-friendlier dispatch, fewer bugs.

The biggest wins from `final` are *architectural*: cleaner reasoning, safer concurrency, and easier future refactoring. Per-call performance is a side benefit.
