# Static Keyword — Find the Bug

> 12 buggy snippets where the bug is `static`-related. Read each, identify why it bites, when it bites, and the fix.

---

## Bug 1 — Shared static `SimpleDateFormat`

```java
public class DateUtils {
    private static final SimpleDateFormat FMT = new SimpleDateFormat("yyyy-MM-dd");
    public static String format(Date d) { return FMT.format(d); }
}
```

Two threads call `DateUtils.format(...)` concurrently.

**Bug.** `SimpleDateFormat` is *not* thread-safe. Concurrent `format` calls corrupt internal state — wrong dates, NPEs, `ArrayIndexOutOfBoundsException`.

**Fix.** Use the immutable `DateTimeFormatter` from `java.time`:

```java
private static final DateTimeFormatter FMT = DateTimeFormatter.ofPattern("yyyy-MM-dd");
public static String format(LocalDate d) { return d.format(FMT); }
```

If `Date` is required: `ThreadLocal<SimpleDateFormat>`.

**Lesson.** Static fields are shared by every thread. Mutable static state must be thread-safe.

---

## Bug 2 — Forward reference reads default

```java
public class Constants {
    public static final int A = B + 1;
    public static final int B = 10;
}

System.out.println(Constants.A);    // prints 1, not 11
```

**Bug.** Static initializers run in textual order. When `A` is being assigned, `B` still has its default value `0`.

**Fix.** Reorder declarations or use a `static {}` block.

**Lesson.** Static initialization is sequential. Forward references read defaults silently.

---

## Bug 3 — Static counter race

```java
public class Counter {
    private static int count = 0;
    public static void increment() { count++; }
    public static int get() { return count; }
}
```

100 threads each call `increment()` 1000 times. Final `get()` returns ~98,000 — not 100,000.

**Bug.** `count++` is read-modify-write, not atomic. Threads race; updates are lost.

**Fix.** `AtomicInteger`:

```java
private static final AtomicInteger count = new AtomicInteger();
public static void increment() { count.incrementAndGet(); }
public static int get() { return count.get(); }
```

**Lesson.** Concurrent increments need atomicity, not just visibility.

---

## Bug 4 — Static cache memory leak

```java
public class Cache {
    private static final Map<String, byte[]> cache = new HashMap<>();
    public static void put(String k, byte[] v) { cache.put(k, v); }
}
```

Application runs for hours, OOMs.

**Bug.** Entries are never removed. The static field is a GC root; everything reachable is pinned.

**Fix.** Bounded cache with eviction (Caffeine, Guava), `WeakHashMap`, or — better — convert to a DI-managed instance with explicit lifecycle.

**Lesson.** A static `Map` that only grows is a memory leak. Always have an eviction policy.

---

## Bug 5 — Calling overridable from static factory

```java
public class Order {
    private static final Order DEFAULT = new Order();

    public Order() {
        register();                      // overridable!
    }
    protected void register() { /* ... */ }
}

public class SpecialOrder extends Order {
    private final List<String> tags = new ArrayList<>();
    @Override protected void register() {
        tags.add("special");             // NPE — tags isn't initialized yet
    }
}
```

**Bug.** When `SpecialOrder` is being constructed, the parent's `<init>` runs `register()` *before* `SpecialOrder`'s field initializers run. `tags` is still `null`.

**Fix.** Don't call overridable methods from constructors. Use `private` or `final` helpers.

**Lesson.** This is unrelated to `static` per se — it's the constructor + overridable trap. But the static `DEFAULT` field triggers the bug at class init time, surprising the reader.

---

## Bug 6 — `static final` constant changed across jars

```java
// lib.jar
public class Limits {
    public static final int MAX = 100;
}

// app.jar (compiled against lib v1)
if (count > Limits.MAX) ...
```

You ship `lib.jar` v2 with `MAX = 200`. Replace the jar without rebuilding `app.jar`. App still uses 100.

**Bug.** Compile-time constants are inlined at the call site. The app jar's bytecode contains literal `100`.

**Fix.** For values that may change between releases, use a method:

```java
public static int max() { return 100; }
```

Or document the recompile requirement.

**Lesson.** `static final` primitives/strings are inlined. Cross-jar changes require recompilation.

---

## Bug 7 — Static block with checked exception

```java
public class Loader {
    private static final Properties PROPS;

    static {
        PROPS = new Properties();
        PROPS.load(new FileInputStream("config.properties"));   // throws IOException
    }
}
```

**Bug.** `<clinit>` cannot declare or propagate checked exceptions. Compile error.

**Fix.** Wrap in `try/catch` and rethrow as unchecked, or accept the file might be missing:

```java
static {
    try {
        Properties p = new Properties();
        p.load(new FileInputStream("config.properties"));
        PROPS = p;
    } catch (IOException e) {
        throw new ExceptionInInitializerError(e);
    }
}
```

**Lesson.** Static initializers must wrap checked exceptions in unchecked (typically `ExceptionInInitializerError` or a `RuntimeException`).

---

## Bug 8 — Class init deadlock

```java
class A {
    static final int X = B.Y + 1;        // depends on B.Y
}
class B {
    static final int Y = A.X + 1;        // depends on A.X
}

// Thread T1: triggers A's init.
// Thread T2: triggers B's init simultaneously.
```

Deadlock.

**Bug.** T1 holds A's class init lock and waits for B (which it needs to read B.Y). T2 holds B's lock and waits for A. Stuck.

**Fix.** Break the cycle:

```java
class A {
    static int X;
    static int initX() { return B.Y + 1; }   // computed lazily
}
```

Or compute both values in one place.

**Lesson.** Cyclic static dependencies + multi-threaded class loading = deadlock. Use `jstack` to confirm; refactor to break the cycle.

---

## Bug 9 — Inner class instead of static nested

```java
public class Container {
    public class Builder {              // ⚠ NOT static
        public Container build() { ... }
    }
}

new Container.Builder();                // ❌ compile error: Builder needs an enclosing Container
```

**Bug.** A non-static inner class requires an enclosing instance. The `new Container.Builder()` syntax doesn't provide one.

**Fix.** Make it `static`:

```java
public static class Builder { ... }
```

Or instantiate via an outer instance: `new Container().new Builder()`.

**Lesson.** Builders should be `static` nested classes. Forgetting `static` makes them harder to instantiate and adds a hidden enclosing-instance reference (memory leak risk).

---

## Bug 10 — Calling static method through instance

```java
Logger logger = null;
logger.info("hello");            // info is static
```

Surprisingly, this *doesn't* throw NPE. It silently calls `Logger.info(...)`.

**Bug.** Less of a runtime bug than a maintenance hazard: future readers think `info` is an instance method and `logger` cannot be null. Refactoring `info` to instance breaks every such call.

**Fix.** Always invoke static methods via the class name: `Logger.info("hello")`. IDE warnings highlight the misuse.

**Lesson.** Static dispatch ignores the receiver. Don't call statics through instances — it misleads readers and traps refactoring.

---

## Bug 11 — Forgotten `static` on a singleton field

```java
public class App {
    public final ConfigLoader CONFIG = new ConfigLoader();    // missing static!
}
```

Two `new App()` calls → two `ConfigLoader`s. Singleton broken.

**Bug.** Without `static`, the field is per-instance. Each `App` gets its own `CONFIG`. The "singleton" gives multiple instances.

**Fix.** Add `static`:

```java
public static final ConfigLoader CONFIG = new ConfigLoader();
```

Or make `ConfigLoader` itself an enum singleton.

**Lesson.** A typo that omits `static` on a "constant" silently changes its scope. Code review and tests should catch it.

---

## Bug 12 — `<clinit>` exception masks the cause

```java
public class Service {
    private static final Map<String, Object> SETUP = setup();

    private static Map<String, Object> setup() {
        // ... throws NullPointerException somewhere deep
    }
}

// In application code:
new Service();   // throws ExceptionInInitializerError caused by NoClassDefFoundError
```

The first attempt to initialize the class throws `ExceptionInInitializerError`. Subsequent uses of `Service` throw `NoClassDefFoundError` — which doesn't mention the original cause.

**Bug.** Once a class fails initialization, it's marked as **erroneous**. Every subsequent attempt to use it throws `NoClassDefFoundError`. The original `ExceptionInInitializerError` is only visible on the *first* attempt.

**Fix.** Always log the *first* exception when initialization fails. Don't swallow it. If you see `NoClassDefFoundError` for a class, scan logs for the earlier `ExceptionInInitializerError` to find the root cause.

**Lesson.** Class initialization fails *atomically* and *permanently*. Diagnose by capturing the first error, not the cascading ones.

---

## Pattern summary

| Bug type                                | Watch for                                                |
|-----------------------------------------|----------------------------------------------------------|
| Shared mutable static (1, 3, 4)         | `static` + mutability + concurrency                      |
| Initialization order (2, 8)             | Forward refs; cyclic deps                                 |
| Constructor + static interaction (5)    | Static fields constructed via `new` calling overridables |
| Compile-time constants (6)              | `static final` cross-jar change                           |
| Class-init mechanics (7, 12)            | Checked exceptions; first-error capture                   |
| Static nested vs inner (9, 11)          | Forgetting `static`                                       |
| Static dispatch (10)                    | Instance-style calls to static methods                    |

These are the most common static-related bugs in real codebases. Most are caught by static analysis (Error Prone, SpotBugs, IntelliJ inspections); the rest by code review and careful concurrency testing.
