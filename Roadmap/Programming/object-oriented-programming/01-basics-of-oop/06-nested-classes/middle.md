# Nested Classes — Middle

> **Why?** Nesting groups types that exist *together* in a meaningful relationship — a builder for a class, a node for a tree, an entry for a map. Done right, nested classes raise readability and tighten encapsulation. Done wrong, they cause memory leaks and bewildering call paths.
> **When?** Use nesting when the inner type is *only meaningful in the context of the outer*. Default to `static` nested. Drop `static` only when you genuinely need access to an enclosing instance.

---

## 1. The decision tree

When you have a class to declare, ask:

1. **Is it useful from anywhere in the codebase?** → top-level class.
2. **Is it logically tied to one outer class?** → nested.
3. **Does it need access to an outer instance's state?** → inner (non-static).
4. **Otherwise** → static nested.
5. **Will it be implemented just once, very locally?** → anonymous class or (better) lambda.
6. **Will it use enclosing-method local variables?** → local class or lambda.

90% of nested classes should be static. The 10% that aren't have a *concrete* reason to capture the outer instance.

---

## 2. The "tightly-coupled type" pattern

Static nested classes for types that are part of an outer class's API:

```java
public final class Order {
    public enum Status { DRAFT, PLACED, SHIPPED, CANCELLED }
    public record Line(String sku, int qty, Money price) { }
    public static final class Builder { ... }
}
```

Three nested types, all static:

- `Order.Status` — an enum tightly tied to `Order`.
- `Order.Line` — a value object that only makes sense as part of an order.
- `Order.Builder` — used to construct `Order`s.

External code uses `Order.Status.PLACED`, `new Order.Line(...)`, `Order.Builder`. The nesting communicates "these belong with `Order`."

Compare with the alternative — three separate top-level classes scattered through the package. Less obvious, more imports, more visual noise.

---

## 3. The Iterator pattern: when inner is right

Iterators are the canonical inner-class use case:

```java
public class CustomList<E> {
    private E[] items;
    private int size;

    public Iterator<E> iterator() {
        return new Iterator<>() {                     // inner (anonymous + non-static)
            int cursor = 0;
            public boolean hasNext() { return cursor < size; }
            public E next() { return items[cursor++]; }
        };
    }
}
```

The iterator needs access to `size` and `items` of *this specific* `CustomList`. Making it static would require passing the list as a parameter — clunky and weird.

This is one of the few cases where inner is the right default.

---

## 4. Memory leaks: the enclosing-reference trap

Every non-static nested class instance holds an implicit reference to its enclosing instance. This causes leaks when:

```java
public class Window {
    private byte[] heavyData = new byte[10_000_000];

    public Runnable refreshTask() {
        return new Runnable() {                       // implicit Window.this reference
            public void run() { /* doesn't actually use Window's state */ }
        };
    }
}

ScheduledExecutorService scheduler = ...;
Runnable task = new Window().refreshTask();
scheduler.scheduleAtFixedRate(task, 0, 1, TimeUnit.SECONDS);
// The scheduler holds `task`, which holds the Window, which holds 10 MB.
```

Even though the lambda doesn't use any `Window` field, the implicit reference keeps the `Window` alive.

**Fixes:**

- Static nested class with explicit fields.
- Lambda — captures only what it references (the JIT may even eliminate the capture).
- Extract to a top-level class.

The pattern: **if you don't use enclosing state, don't carry the reference**. `static` is how you say so.

---

## 5. Local classes: rare in modern code

Local classes (declared inside a method) survive in two niches:

**(a)** When you need a class with multiple methods that captures method state:

```java
public Iterator<Integer> evensUpTo(int n) {
    class EvensIterator implements Iterator<Integer> {
        int current = 0;
        public boolean hasNext() { return current < n; }
        public Integer next() { current += 2; return current; }
    }
    return new EvensIterator();
}
```

**(b)** When the class needs to extend an abstract class (lambdas can't):

```java
public Reader bufferedReader(String src) {
    class CountingReader extends StringReader {
        long count = 0;
        CountingReader() { super(src); }
        @Override public int read() throws IOException {
            int r = super.read();
            if (r != -1) count++;
            return r;
        }
    }
    return new CountingReader();
}
```

For most other cases — single-method interfaces, simple callbacks — lambdas are cleaner.

---

## 6. Anonymous classes: when lambdas don't fit

Lambdas implement *single-abstract-method* (functional) interfaces. Anonymous classes can implement multi-method interfaces or extend classes:

```java
// Lambda — single-method interface
Runnable r = () -> System.out.println("run");

// Anonymous class — extending a class
Thread t = new Thread() {
    @Override public void run() { ... }
    @Override public void interrupt() { ... }       // multiple overrides
};
```

But for the *single-method* case, always prefer lambdas:

```java
// Don't:
Runnable r = new Runnable() {
    @Override public void run() { ... }
};

// Do:
Runnable r = () -> { ... };
```

Lambdas are typically inlined and scalar-replaced by the JIT — they often have *zero* runtime cost. Anonymous classes always allocate.

---

## 7. The "static factory + builder" combo

A common pattern:

```java
public final class HttpRequest {
    private final URI uri;
    private final Map<String, String> headers;

    private HttpRequest(Builder b) {
        this.uri = b.uri;
        this.headers = Map.copyOf(b.headers);
    }

    public static Builder newBuilder() { return new Builder(); }

    public static final class Builder {
        URI uri;
        Map<String, String> headers = new LinkedHashMap<>();
        public Builder uri(URI u) { this.uri = u; return this; }
        public Builder header(String k, String v) { headers.put(k, v); return this; }
        public HttpRequest build() { return new HttpRequest(this); }
    }
}
```

Three encapsulation moves:

- `HttpRequest` constructor is `private` — only the builder constructs it.
- `Builder` is `public static` — instantiable without an `HttpRequest`.
- `newBuilder()` is the entry point — gives the API a single, named starting place.

The builder is `static` because it doesn't need a "current" `HttpRequest`. Each builder is independent.

---

## 8. Nested vs top-level: when to flatten

If a nested class:

- Has uses outside the outer class.
- Doesn't logically belong "with" the outer.
- Becomes large enough to obscure the outer's structure.

…it's probably time to extract to a top-level class. Inverse: if a top-level class has only one user, scoped tightly to it, consider nesting.

The *visual* boundary helps: a 50-line `Order` followed by a 200-line nested `LineParser` reads as "Order is dwarfed by LineParser." Extract.

---

## 9. Records as nested types

Records are implicitly `static` when nested:

```java
public class Order {
    public record Line(String sku, int qty) { }      // static nested record
}
```

You don't need to write `static`; records cannot capture enclosing instances. This is good — records model values, not entities tied to other instances.

For lightweight value-shaped nested types, prefer records over hand-rolled classes.

---

## 10. Sealed nested hierarchies

Sealed classes work beautifully with nesting:

```java
public sealed interface PaymentResult
    permits PaymentResult.Approved, PaymentResult.Declined, PaymentResult.Pending {

    record Approved(String txId) implements PaymentResult { }
    record Declined(String reason) implements PaymentResult { }
    record Pending(Duration eta) implements PaymentResult { }
}
```

The hierarchy is fully scoped to `PaymentResult`. External code uses `PaymentResult.Approved`, `PaymentResult.Pending`, etc. The compiler enforces exhaustive `switch` over the three.

This is the modern algebraic-data-type pattern in Java. Use it for closed sets of variants.

---

## 11. Access modifiers on nested types

Each nested type has its own access modifier:

```java
public class Outer {
    public  static class PublicNested { }
    static  class PackagePrivate { }                  // visible within package
    private static class PrivateNested { }             // visible only inside Outer
}
```

The outer class's modifier doesn't constrain the nested. A `public` nested in a package-private outer is accessible only when the outer is — but you *can* declare it.

Use `private` nested for genuinely internal types. Outsiders can't reference them at all.

---

## 12. Same-nest private access

Java 11+ introduced *nest mates*. Classes that share a `NestHost` (typically the outer class and its nested types) can directly access each other's `private` members:

```java
public class Outer {
    private int x = 10;
    public static class Helper {
        public int read(Outer o) { return o.x; }      // ✓ direct private access
    }
}
```

Pre-11 this required synthetic bridge methods (visible in `javap` as `access$000`). Post-11, the bytecode reads the field directly.

This makes nesting truly "share encapsulation" — the outer and its nested types are one logical unit.

---

## 13. Lambda capture vs anonymous class capture

Both capture *effectively final* locals:

```java
String prefix = "user_";

Runnable lambda = () -> System.out.println(prefix);
Runnable anon = new Runnable() {
    public void run() { System.out.println(prefix); }
};
```

Differences:

- **Lambda**: implemented via `invokedynamic` + `LambdaMetafactory`. The JIT often scalar-replaces the capture object — no allocation.
- **Anonymous class**: a real class with a constructor that takes the captured values. Always allocates an instance per capture.

In a hot loop, lambdas are *much* cheaper. For a small number of long-lived listeners, the difference is negligible.

---

## 14. The middle-level checklist

For each nested class:

1. **Why is it nested?** Tightly coupled to the outer? Doesn't make sense alone? Otherwise, extract.
2. **`static`?** Default yes. Drop only with concrete need.
3. **Memory profile?** No accidental enclosing capture? No long-lived references via anonymous-class instances?
4. **Modern alternatives?** Lambda for single-method, record for value, sealed for closed hierarchies.
5. **Access?** Use `private` if internal; `public` only if external API.
6. **Size?** If the nested class is bigger than the outer, you may have inverted the relationship.

For the outer class:

7. **Are nested types organized at the top of the file?** Convention: nested classes/enums first, then fields, then methods.
8. **Are the nested types `final` or `sealed`?** Closed hierarchies are easier to reason about.
9. **Is the file getting long?** Extract nested types to peers if they grow independent.

---

## 15. Idiomatic patterns

| Pattern                              | Form                                                                                       |
|--------------------------------------|--------------------------------------------------------------------------------------------|
| Builder                              | Static nested class                                                                        |
| Iterator                             | Anonymous inner class (or top-level for complex iterators)                                |
| Algebraic data type                  | `sealed interface` with nested `record` permits                                            |
| Helper data type tied to outer       | Static nested class or record                                                               |
| Lazy holder singleton                | Private static nested class                                                                 |
| Strategy / Listener (single-method)  | Lambda — not nested class                                                                   |
| Strategy / Listener (multi-method)   | Anonymous class (rare) or named top-level                                                   |

The shared theme: **default to static**, **prefer lambdas** where they fit, **use sealed** for closed sets, **use records** for values. Modern Java's nested-class story is concise and ergonomic — you don't need much beyond these patterns.
