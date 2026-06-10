# Interfaces — Optimization

Twelve before/after exercises focused on dispatch costs, lambda allocation, and JIT-friendly interface design.

---

## Optimization 1 — Sealed interface for monomorphic dispatch

**Before:** open `Shape` interface, megamorphic call sites across the codebase.

**After:**
```java
sealed interface Shape permits Circle, Square, Triangle { }
```

Pattern matching switch generates an efficient classifier; the JIT specializes each branch. Loss of unbounded extensibility, gain in performance.

---

## Optimization 2 — `final` impl classes

**Before:**
```java
public class TreeNodeImpl implements TreeNode { ... }
```

**After:**
```java
public final class TreeNodeImpl implements TreeNode { ... }
```

The JIT can fully devirtualize methods on `TreeNodeImpl` references when known to be `final`.

---

## Optimization 3 — Cache non-capturing lambdas

**Before:**
```java
list.stream().filter(s -> !s.isEmpty()).toList();   // OK — non-capturing, cached
```

vs:

```java
list.stream().filter(s -> s.startsWith(prefix)).toList();   // capturing
```

**After (when capture is in a hot loop):**
```java
String p = this.prefix;
Predicate<String> pred = s -> s.startsWith(p);
for (var batch : batches) batch.stream().filter(pred).count();
```

Captures once, reuses many times.

---

## Optimization 4 — Default method instead of utility class

**Before:**
```java
public class StringUtils {
    public static boolean isPalindrome(String s) { ... }
}
```

**After:**
```java
public interface PalindromeCheckable {
    String value();
    default boolean isPalindrome() {
        var s = value();
        return new StringBuilder(s).reverse().toString().equals(s);
    }
}
```

Trade-off: defaults compose with subjects naturally; utility classes are simpler but require passing the subject.

---

## Optimization 5 — Reduce interface depth

**Before:**
```java
interface A { ... }
interface B extends A { ... }
interface C extends B { ... }
interface D extends C { ... }    // 4 levels
```

**After:** flatten where possible. Each level adds itable lookup work.

```java
interface D { ... }   // includes everything needed
```

---

## Optimization 6 — Static factory on interface

**Before:**
```java
public class CurrencyFactory {
    public static Currency of(String code) { ... }
}
```

**After:**
```java
public interface Currency {
    String code();
    static Currency of(String code) { ... }
}
Currency.of("USD");
```

Less ceremony, no extra utility class.

---

## Optimization 7 — Avoid `var` of interface type in tight loops

**Before:**
```java
List<Integer> list = ...;     // declared as List
for (int i = 0; i < list.size(); i++) ...
```

If `list` is an `ArrayList` and the JIT knows it, calls are direct. With interface declaration, dispatch is virtual (often devirtualized, but not guaranteed).

**After (when warranted):**
```java
ArrayList<Integer> list = ...;     // declared as concrete
```

For library APIs, prefer interfaces. For internal hot paths, prefer concrete types if profiled benefit.

---

## Optimization 8 — Records implementing sealed interfaces

**Before:** abstract class hierarchy with open extension.

**After:**
```java
sealed interface Json permits JNull, JNum, JStr, JArr, JObj { }
record JNull() implements Json { }
record JNum(double value) implements Json { }
// ...
```

Records are final, immutable, JIT-friendly. Sealed gives exhaustive matching. Combo is hard to beat.

---

## Optimization 9 — Avoid widening interface in hot path

**Before:**
```java
Iterable<X> data = list;
for (var x : data) ...
```

If `data` is declared as `Iterable`, the iterator is dispatched virtually.

**After:**
```java
List<X> data = list;
for (int i = 0; i < data.size(); i++) ...
```

Or use `for-each` over `List` — JIT specializes for ArrayList specifically.

---

## Optimization 10 — Use `MethodHandle` for late-bound interface call

**Before (reflection):**
```java
Method m = obj.getClass().getMethod("compute", int.class);
m.invoke(obj, 5);
```

**After (MethodHandle):**
```java
MethodHandle h = MethodHandles.lookup().findVirtual(I.class, "compute", MethodType.methodType(int.class, int.class));
int result = (int) h.invokeExact((I) obj, 5);
```

`MethodHandle.invokeExact` can be JIT-inlined; `Method.invoke` cannot.

---

## Optimization 11 — `Consumer`/`Predicate` over custom interfaces

**Before:**
```java
public interface MyHandler { void handle(Event e); }
list.forEach(new MyHandler() { public void handle(Event e) { ... } });
```

**After:**
```java
list.forEach((Event e) -> { ... });   // uses Consumer<Event>
```

JDK's functional interfaces are recognized by the JIT and benefit from common optimizations. Less code.

---

## Optimization 12 — Lazy interface initialization

When an interface has expensive default-method initialization or static initializers, defer:

```java
public interface Heavy {
    static Helper h() { return Holder.INSTANCE; }
    class Holder { static final Helper INSTANCE = new Helper(); }
}
```

The Holder class is loaded only when `Heavy.h()` is called, not when `Heavy` is referenced.

---

## Tools cheat sheet

| Tool                                      | Purpose                              |
|-------------------------------------------|--------------------------------------|
| `-XX:+PrintInlining`                      | Inlining decisions                   |
| `async-profiler -e cpu`                   | CPU flame graph                      |
| `async-profiler -e alloc`                 | Allocation flame graph               |
| `jol-cli`                                 | Object layout                        |
| `jdeps`                                   | Module dependency analysis           |
| `jmh`                                     | Benchmark sealed vs open dispatch    |

---

## When to apply

- Hot paths with many interface implementations (megamorphic)
- Lambda-heavy code with capture in inner loops
- Closed type hierarchies that benefit from sealed + pattern matching
- Library APIs where evolution matters

## When not to

- Cold paths (config, startup)
- Framework code that needs runtime extensibility
- Code clarity matters more than tiny speedup

---

**Memorize this**: interfaces are JIT-friendly when monomorphic and stable. Sealed interfaces close the world for the optimizer. Functional interfaces with method references avoid lambda capture. Records implementing sealed give the best of both: type safety + JIT-specialization.
