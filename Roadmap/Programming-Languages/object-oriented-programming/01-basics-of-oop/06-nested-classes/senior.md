# Nested Classes — Senior

> **How to optimize?** Static nested classes for almost everything; lambdas where they fit; sealed hierarchies for closed sets. The wins from nested-class discipline are mostly architectural — clearer types, fewer leaks, smaller files.
> **How to architect?** Use nesting to express *type cohesion* — types that exist only in the context of another. The outer class is the organizing principle; the nested types are pieces of its API. Use top-level types for everything else.

---

## 1. Nesting expresses ownership

A class declared inside another *belongs* to it conceptually. The nesting tells readers:

- "This type is meaningful only with that one."
- "These pieces are designed together."
- "Touching one piece may need awareness of the others."

If your nested class has callers in five other packages and is independent of its outer, it's mis-nested. Extract.

The senior eye spots this quickly: scan the imports of the outer class's package. If `Outer.Inner` appears in many places without `Outer` itself, the relationship is broken.

---

## 2. The Builder + private constructor pattern

```java
public final class HttpRequest {
    private final URI uri;
    private final Map<String, String> headers;

    private HttpRequest(Builder b) {
        this.uri = Objects.requireNonNull(b.uri);
        this.headers = Map.copyOf(b.headers);
    }

    public static Builder newBuilder() { return new Builder(); }

    public static final class Builder {
        URI uri;
        Map<String, String> headers = new LinkedHashMap<>();

        public Builder uri(URI u) { this.uri = u; return this; }
        public Builder header(String k, String v) { headers.put(k, v); return this; }
        public HttpRequest build() {
            if (uri == null) throw new IllegalStateException("uri required");
            return new HttpRequest(this);
        }
    }
}
```

Architectural moves:

- `HttpRequest` is `final` — no subclassing.
- Constructor is `private` — only the builder can create instances.
- `Builder` is `public static final` — instantiable, but not extensible.
- `newBuilder()` is the named entry point.

This is one of the most common architectural patterns in modern Java APIs. It works because of nesting + access control + finality, all together.

---

## 3. Algebraic data types via sealed + nested records

```java
public sealed interface Result<T, E>
    permits Result.Ok, Result.Err {

    record Ok<T, E>(T value) implements Result<T, E> { }
    record Err<T, E>(E error) implements Result<T, E> { }

    default <U> Result<U, E> map(Function<T, U> f) {
        return switch (this) {
            case Ok<T, E> ok   -> new Ok<>(f.apply(ok.value));
            case Err<T, E> err -> new Err<>(err.error);
        };
    }
}
```

The hierarchy is *closed* and self-contained. Adding a new variant requires updating `permits` (and every `switch`). External code uses `Result.Ok`, `Result.Err` — fully scoped.

This is the modern, idiomatic way to model algebraic types in Java. Use it for state machines, parser AST nodes, error/result types, network protocol messages.

---

## 4. Sealed nested classes for state machines

```java
public sealed interface OrderStatus
    permits OrderStatus.Draft, OrderStatus.Placed, OrderStatus.Shipped, OrderStatus.Cancelled {

    record Draft(Instant since) implements OrderStatus { }
    record Placed(Instant placedAt) implements OrderStatus { }
    record Shipped(TrackingNumber tracking) implements OrderStatus { }
    record Cancelled(Instant cancelledAt, String reason) implements OrderStatus { }
}
```

Each state carries the data relevant to it. The compiler enforces exhaustive `switch`. Every transition is checkable in the type system — you can't have a `Shipped` order without a `tracking`, and you can't have a `Cancelled` order without a `reason`.

This is dramatically more expressive than `enum OrderStatus { DRAFT, PLACED, SHIPPED, CANCELLED }` plus a separate `Map<OrderStatus, OrderStatusData>`.

---

## 5. Iterator: when inner class is right

```java
public final class CustomList<E> implements Iterable<E> {
    private E[] items;
    private int size;

    @Override
    public Iterator<E> iterator() {
        return new Iter();        // anonymous: implicit `CustomList.this`
    }

    private final class Iter implements Iterator<E> {
        int cursor = 0;
        public boolean hasNext() { return cursor < size; }
        public E next() { return items[cursor++]; }
    }
}
```

The inner `Iter` accesses `size` and `items` via the implicit `CustomList.this`. Making it `static` would require passing `CustomList<E>` as a constructor parameter — clunkier.

The trade-off: each iteration creates a new `Iter` instance, which carries a hidden enclosing reference. For short-lived iterations (a single loop), this is fine. For iterators stored in long-lived state, prefer static + explicit fields.

---

## 6. Lambda vs anonymous class — the JIT story

Modern lambdas (Java 8+) are implemented via `invokedynamic`. The JIT typically:

1. Generates a tight implementation class on first use.
2. Inlines the lambda body at the call site.
3. **Scalar-replaces** the capture object — no heap allocation.

Anonymous classes always allocate. Even a simple `new Runnable() { public void run() { ... } }` produces a real class file and a real instance.

For high-throughput code, this matters. A million lambda calls in a tight loop may produce zero allocations (escape analysis succeeds); a million anonymous-class calls produce a million instances.

So: **prefer lambdas wherever they fit**.

---

## 7. The "package-by-feature" alternative

Some codebases use heavy nesting — `Order` with `Order.Builder`, `Order.Line`, `Order.Status` all in one file.

Other codebases use *package-by-feature* — a `com.example.order` package with `Order`, `OrderBuilder`, `OrderLine`, `OrderStatus` as siblings.

Trade-offs:

- **Nesting**: tighter visual cohesion; less namespace pollution; cleaner imports.
- **Package-by-feature**: easier to grow each type independently; better for IDE outline view; no "huge file" problem.

There's no universal answer. Most modern Java prefers moderate nesting (2-3 nested types max per outer); large utility hierarchies go to package-by-feature.

---

## 8. Anonymous classes in modern Java

When are anonymous classes still right?

- **Multi-method interfaces**: `WindowAdapter` overrides multiple methods.
- **Initialization blocks**: rare, but used for "double-brace initialization" of collections (anti-pattern, but exists).
- **Type capture**: `new TypeReference<List<String>>() { }` is the canonical way to capture a generic type for runtime reflection (Jackson, Guice).

For everything else, lambdas. Anonymous classes are largely a Java-7-era pattern.

---

## 9. Nested classes in records

Records can have nested types:

```java
public record Order(OrderId id, List<OrderLine> lines, OrderStatus status) {
    public record OrderId(UUID value) { }
    public record OrderLine(String sku, int qty) { }
    public sealed interface OrderStatus permits Draft, Placed { ... }
}
```

The nested types are implicitly `static` (records can't have inner). They're typed as `Order.OrderId`, `Order.OrderLine`, etc.

This is the canonical modern pattern for value-shaped types — group everything in one file when the relationship is tight.

---

## 10. The "callback object" antipattern

```java
button.addListener(new MouseListener() {
    @Override public void mouseClicked(MouseEvent e) { ... }
    @Override public void mousePressed(MouseEvent e) { }
    @Override public void mouseReleased(MouseEvent e) { }
    @Override public void mouseEntered(MouseEvent e) { }
    @Override public void mouseExited(MouseEvent e) { }
});
```

Five empty methods to override one. The fix is **adapter classes** in the JDK (`MouseAdapter` provides empty defaults) or **interface segregation** (use a single-method interface like `Consumer<MouseEvent>`).

For new APIs, design **single-method interfaces** so lambdas work directly. The JDK's `Consumer`, `Function`, `Predicate`, `Supplier` are the canonical examples.

---

## 11. Nested types and serialization

JSON serializers (Jackson, Gson, Moshi) handle nested types fine — they're just regular classes. But:

- **Inner classes** (non-static) carry a hidden reference to the outer; serializers may try to serialize the outer too. Workaround: make the inner static, or use `@JsonIgnore`.
- **Anonymous classes** are nameless at the bytecode level (compilers generate names like `Outer$1`) — serialization formats that include type names break.
- **Local classes** are usually not serialized at all.

For data exchange, prefer top-level classes or `static` nested classes. Anonymous and local classes are for behavior, not data.

---

## 12. The `private` nested class for module-internal helpers

When you want a class that's truly internal:

```java
public class Outer {
    private static final class CacheEntry {
        final long expiresAt;
        final Object value;
        CacheEntry(long e, Object v) { ... }
    }

    private final Map<String, CacheEntry> cache = new HashMap<>();
}
```

`CacheEntry` is unreachable from outside `Outer`. No external code can even *type* `Outer.CacheEntry`. Internal refactors are entirely free.

This is a tighter encapsulation than package-private — even classes in the same package can't see `CacheEntry`.

---

## 13. Memory profile of nested classes

| Kind                | Per-instance overhead vs top-level                |
|---------------------|---------------------------------------------------|
| Static nested       | Same as top-level                                  |
| Inner (non-static)  | +4-8 bytes for `this$0` reference                 |
| Anonymous           | Same as inner; plus per-capture fields            |
| Local class         | Same as inner; plus captured-locals fields        |
| Lambda              | Often 0 (scalar-replaced); else same as anonymous |

For high-allocation-rate code, the difference between "inner class instances" and "lambdas" can be significant. Profile with JFR's allocation profiler.

---

## 14. The "interface with nested types" pattern

Java interfaces can have nested types — and they're implicitly `static`:

```java
public interface Map<K, V> {
    interface Entry<K, V> {                    // implicitly static
        K getKey();
        V getValue();
    }

    static <K, V> Map<K, V> of() { ... }       // implicitly static, public
}
```

This is the JDK's pattern: `Map.Entry`, `Map.Entry<K,V>`, `Map.of(...)`. The interface is the API; nested types are part of it.

For new public APIs, this is often cleaner than a top-level type plus separate factory class.

---

## 15. The senior architecture decisions

When designing a new module:

1. **Default `static`** for all nested types.
2. **Lambdas** for single-method interfaces — design APIs to support them.
3. **Sealed + nested records** for algebraic data types.
4. **Builders** as `static` nested classes with private outer constructor.
5. **`private` nested** for module-internal helpers.
6. **Top-level extraction** when the nested type grows independent.
7. **No anonymous classes** for single-method cases.
8. **No local classes** in modern code (use lambdas or extract).

When refactoring legacy code:

- Add `static` to inner classes that don't need outer access.
- Convert anonymous + single-method to lambdas.
- Extract local classes to private static nested or top-level.
- Convert inner-class iterators that don't need outer state to static.

---

## 16. The senior checklist

For each nested type:

1. **Conceptual fit**: tightly coupled to outer, or candidate for extraction?
2. **Static or inner**: any concrete reason to capture the outer?
3. **Memory profile**: any unexpected retention? Heap dumps clean?
4. **Modern alternative**: record, sealed, lambda?
5. **Access**: appropriate for the audience — `private`, package-private, `public`?
6. **Size**: outer dominates the file? Otherwise consider extraction.
7. **Builder pattern**: static, named entry point on the outer?
8. **Sealed hierarchy**: exhaustive switches in callers?
9. **Lambdas**: single-method interfaces designed for them?
10. **Reflection / serialization**: serializer-friendly shape?

Senior nested-class discipline is *quiet*: types are organized into outer/inner relationships that mirror the conceptual model; static is the default; lambdas replace anonymous classes; sealed gives you exhaustive checking. The result is code that reads cleanly and refactors easily.
