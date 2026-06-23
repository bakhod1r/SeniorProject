# Abstraction — Optimization

Twelve before/after exercises focused on when abstraction layers cost you and when they don't.

---

## Optimization 1 — Concrete type in hot path

**Before:**
```java
public List<Item> top10() {
    List<Item> result = inventory.getAll();
    Collections.sort(result, comparator);
    return result.subList(0, 10);
}
```

**After (when only one List impl is ever used):**
```java
public ArrayList<Item> top10() { ... }
```

**Why:** if every caller is internal and uses `ArrayList`-specific methods, you save a vtable lookup per call. Trade-off: harder to swap impl. Apply only when profile shows benefit.

---

## Optimization 2 — Sealed types for monomorphic dispatch

**Before:** open `Shape` interface, dozens of implementations across the codebase, megamorphic call sites.

**After:**
```java
sealed interface Shape permits Circle, Square, Triangle { }
```

**Why:** with a closed list, the JIT may emit a typeSwitch dispatch instead of vtable lookup. Combined with pattern matching, gives bounded polymorphism.

---

## Optimization 3 — Inline simple wrappers

**Before:**
```java
class TimedService implements Service {
    private final Service delegate;
    public Result call(Request r) {
        long t0 = System.nanoTime();
        try { return delegate.call(r); }
        finally { metrics.record(System.nanoTime() - t0); }
    }
}
```

**After:** no change is needed if `delegate.call` is monomorphic — JIT inlines it. But mark `TimedService` as `final` to assist devirtualization at outer call sites:

```java
public final class TimedService implements Service { ... }
```

---

## Optimization 4 — Lambdas for callbacks

**Before:**
```java
new Thread(new Runnable() {
    public void run() { doWork(); }
}).start();
```

**After:**
```java
new Thread(() -> doWork()).start();
```

**Why:** lambdas use `invokedynamic` + lazy hidden-class generation. After warmup, ≈ same cost as anonymous class. But anonymous classes always allocate per use; lambdas can be cached.

For non-capturing lambdas:
```java
private static final Runnable WORK = () -> doWork();
```

`WORK` is allocated once.

---

## Optimization 5 — Avoid megamorphic dispatch

**Before:**
```java
interface Handler { void handle(Event e); }

// 30 implementations across the codebase, all called via this list:
for (Handler h : handlers) h.handle(event);
```

**After:** if dispatch type is statically known, specialize:

```java
class HandlerDispatcher {
    private final List<TypedHandler> handlers;
    void dispatch(Event e) {
        TypedHandler h = handlers.get(e.type().ordinal());
        h.handle(e);    // monomorphic per event type
    }
}
```

Or use sealed types + pattern matching to avoid the interface entirely.

---

## Optimization 6 — Default methods over utility classes

**Before:**
```java
public class StringUtils {
    public static String capitalize(String s) { ... }
    public static String snake(String s) { ... }
}
StringUtils.capitalize("hello");
```

**After:**
```java
public interface StringOps {
    static String capitalize(String s) { ... }
    static String snake(String s) { ... }
}
StringOps.capitalize("hello");
```

**Why:** functionally equivalent, but the interface declaration makes intent clearer (no instance is needed). Also enables future addition of default methods if behavior is needed on instances.

---

## Optimization 7 — Records instead of class+interface pair

**Before:**
```java
public interface User { String name(); int age(); }
public class UserImpl implements User { ... 30 lines ... }
```

**After:**
```java
public record User(String name, int age) { }
```

**Why:** records auto-generate equals/hashCode/toString and are final by default, enabling JIT optimizations. Less code, fewer bugs.

---

## Optimization 8 — Eliminate proxy layers

**Before:**
```java
@Service
public class UserServiceImpl implements UserService { ... }

// Spring wraps in transactional proxy (CGLIB)
// → every call goes through dynamic proxy + reflection
```

**After:** for hot paths, manage transactions explicitly with the Spring `TransactionTemplate` rather than `@Transactional`. Removes the proxy layer.

```java
public class UserService {
    private final TransactionTemplate tx;
    public User findById(long id) {
        return tx.execute(status -> em.find(User.class, id));
    }
}
```

**Why:** proxies add ~100 ns per call on top of the method itself. Cold paths: irrelevant. Hot paths: matters.

---

## Optimization 9 — Use functional interfaces for SAM types

**Before:**
```java
interface Validator { boolean validate(String s); }

class NonEmpty implements Validator {
    public boolean validate(String s) { return !s.isEmpty(); }
}
class Short implements Validator {
    public boolean validate(String s) { return s.length() < 100; }
}
```

**After:**
```java
@FunctionalInterface
interface Validator { boolean validate(String s); }

Validator nonEmpty = s -> !s.isEmpty();
Validator shorter = s -> s.length() < 100;
```

Saves boilerplate and enables composition. Same JIT performance after warmup.

---

## Optimization 10 — Avoid `Stream` for tight inner loops

**Before:**
```java
return list.stream().mapToInt(Item::price).sum();
```

**After (when list is large and this is hot):**
```java
int sum = 0;
for (int i = 0; i < list.size(); i++) sum += list.get(i).price();
return sum;
```

**Why:** stream pipelines have per-element abstraction (functional interfaces). Hand loops can be 2-10× faster on `int`-heavy work. Use streams everywhere else; loops in inner kernels.

---

## Optimization 11 — Cache abstraction wrappers

**Before:**
```java
public Decimal toDecimal() {
    return new Decimal(this.cents, this.currency);
}
```

If called millions of times for the same instance, allocates millions of `Decimal` objects.

**After:**
```java
public Decimal toDecimal() {
    if (decimal == null) decimal = new Decimal(this.cents, this.currency);
    return decimal;
}
```

Or, better, make the source class itself immutable so callers can hold the abstraction reference forever.

---

## Optimization 12 — `MethodHandle` over reflection

**Before:**
```java
Method m = clazz.getMethod("compute");
m.invoke(instance);                 // ~100× slower than direct call
```

**After (for hot paths needing late binding):**
```java
MethodHandle mh = MethodHandles.lookup()
    .findVirtual(clazz, "compute", MethodType.methodType(int.class));
int result = (int) mh.invokeExact(instance);     // can be JIT-inlined
```

**Why:** the JIT can specialize `MethodHandle.invokeExact` and remove the indirection. Reflection cannot be inlined the same way.

---

## When abstraction-related optimization is worth it

- Profile shows megamorphic dispatch in hot path.
- Abstraction adds proxy layers (Spring, Hibernate) used in tight loops.
- Lambda allocation appears in allocation flame graph.
- Object pooling for abstraction wrappers reduces churn.

---

## When it isn't

- Cold paths (config loading, startup).
- Refactoring would break public API.
- Profile shows other bottlenecks dominate.
- Abstraction's evolution benefit outweighs runtime cost.

---

## Tools cheat sheet

| Tool                                          | Purpose                                |
|-----------------------------------------------|----------------------------------------|
| `-XX:+PrintInlining`                          | Inlining decisions                     |
| `-XX:CompileCommand=print,X.method`           | Disassemble                             |
| `async-profiler -e cycles`                    | CPU flame graph                        |
| `async-profiler -e alloc`                     | Allocation flame graph                 |
| `jol-cli`                                     | Object layout                          |
| JFR + JMC                                     | Method profiling, GC, JIT              |
| `jmh`                                         | Microbenchmarks                        |

---

**Memorize this**: well-designed abstractions cost almost nothing in modern JVMs *when monomorphic*. The real costs are: (1) per-call dispatch when megamorphic; (2) lambda allocation when capturing; (3) proxy/reflection layers; (4) developer cognitive load. Profile first; optimize abstraction only when it's actually a bottleneck.
