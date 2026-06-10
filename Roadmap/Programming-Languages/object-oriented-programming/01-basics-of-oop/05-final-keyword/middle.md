# Final Keyword — Middle

> **Why?** `final` is Java's primary tool for *signaling immutability and intent*. It tells future readers (including the compiler) "this is fixed by design" — and the compiler enforces it. Without `final`, every field, method, and class is implicitly mutable / overridable, and you've committed to that flexibility forever.
> **When?** Default to `final` for fields, default to `final` (or sealed) for classes that aren't designed for extension, default to `final` for methods that subclasses must not change. Make mutability or extensibility a *deliberate* decision.

---

## 1. Default-to-final philosophy

Most modern Java style guides (Effective Java, Google Style, the JDK's own internal guidelines) agree:

- **Fields**: default to `final`. Mutability is a deliberate exception.
- **Method parameters**: optional sugar; some teams require it, others don't bother.
- **Classes**: `final` unless you intend the class to be extended (and you've designed for it).
- **Methods**: `final` if subclasses must not override.

The reasoning: every `final` removes a degree of freedom that callers might otherwise rely on. Each removal makes the class *easier* to refactor without breaking external code.

The opposite philosophy ("mark `final` only when you must") leaves all flexibility on the table — but every flexibility is a future commitment.

---

## 2. The JMM safe-publication guarantee

The most important reason to make fields `final`:

> *If a constructor finishes without letting `this` escape, then any thread that observes the constructed object's reference is guaranteed to see all `final` fields fully initialized — without explicit synchronization.*

This is JLS §17.5. It's the foundation of *safe publication* of immutable objects.

Concretely:

```java
public final class Money {
    private final long cents;
    private final Currency currency;
    public Money(long cents, Currency currency) {
        this.cents = cents;
        this.currency = currency;
    }
}

// Thread A:
Money m = new Money(100, USD);
sharedReference = m;     // even if no synchronization, B sees `cents` and `currency` correctly

// Thread B:
Money m = sharedReference;
m.cents();        // guaranteed to read 100, not 0
```

For non-`final` fields, this guarantee does *not* hold. Without synchronization, B could see `cents = 0` (the default) — even after A's constructor finished.

So: **`final` enables thread-safe sharing of immutable objects without locks.**

---

## 3. The "effectively final" rule

Java 8 introduced *effectively final* — a variable that's never reassigned after initialization, even though `final` isn't written.

Lambdas and anonymous classes can capture *either* `final` or *effectively final* variables:

```java
String prefix = "user_";              // effectively final
Runnable r = () -> System.out.println(prefix + name);
prefix = "admin_";                     // ❌ now `prefix` is no longer effectively final
                                        //    the lambda capture above becomes invalid
```

The compiler tracks this at compile time. Some teams write `final` explicitly for documentation; others rely on the rule. Either is fine.

---

## 4. `final` fields ≠ deep immutability

The most common misconception:

```java
public final class Order {
    private final List<OrderLine> lines = new ArrayList<>();
}
```

`Order` is `final` (no subclass), `lines` is `final` (no reassignment). But `lines` is still a mutable `ArrayList` — anyone who can reach it can `add` and `remove`.

For deep immutability:

```java
public final class Order {
    private final List<OrderLine> lines;

    public Order(List<OrderLine> lines) {
        this.lines = List.copyOf(lines);   // immutable copy on the way in
    }

    public List<OrderLine> lines() {
        return lines;                       // already unmodifiable
    }
}
```

Use `List.copyOf`, `Map.copyOf`, `Set.copyOf` for immutable copies. Or use records and immutable types throughout.

---

## 5. `final` parameters — readability vs ceremony

Two camps:

**(a)** "Always mark parameters `final`." Argument: signals intent, the compiler enforces no-reassignment, and makes lambda captures painless.

**(b)** "Don't bother." Argument: noise that doesn't add information; modern Java's effectively-final rule covers lambdas; reassigning a parameter is a smell anyway.

Both are defensible. Most JDK code uses (b). Many enterprise codebases use (a) via Checkstyle rules. **Pick one for the codebase and stop debating.**

---

## 6. `final` on methods — the override-prevention lever

A `final` method cannot be overridden. Use it when:

- The method's behavior is critical to the class's contract — subclasses must not break it.
- You're using the *template method* pattern and the `final` method orchestrates protected hooks.
- You want JIT inlining (slight) and protection against subclass mistakes (more important).

A method that's both `final` and `public` is a clear signal: "this is part of the contract; subclasses must rely on this exact behavior, not their own."

For classes that are themselves `final`, marking methods `final` is redundant.

---

## 7. `final` on classes — the design choice

Marking a class `final`:

- Closes the door to subclassing.
- Lets you refactor internals freely — no subclass dependency.
- Lets the JIT inline more aggressively (no CHA overhead).

Marking a class non-`final`:

- Commits to a stable inheritance contract.
- Requires Liskov substitutability — every override must respect the parent's preconditions, postconditions, and invariants.
- Requires careful design — `protected` hooks, no overridable methods called from `<init>`, documented self-use patterns.

The JDK's `String`, `Integer`, `Long`, `Boolean`, `Math` are all `final`. Frameworks like Spring's `JdbcTemplate` are designed for extension — they document the hooks.

**For domain code**, prefer `final`. Composition is almost always cleaner than inheritance for new classes.

---

## 8. Records: implicit `final`

Java 16's records are *implicitly* `final` — you cannot subclass them:

```java
public record Point(int x, int y) {}

class ColorPoint extends Point { ... }   // ❌ compile error
```

Their components are also `final` (private final fields backing the accessors). So records bake in two of the most important `final` decisions.

For value-shaped types, prefer records — you get all the immutability benefits with less ceremony.

---

## 9. Sealed classes: a middle ground

Java 17's `sealed` is "extensible, but only by these types":

```java
public sealed class Shape permits Circle, Square, Triangle {}
public final class Circle extends Shape { ... }
public final class Square extends Shape { ... }
public final class Triangle extends Shape { ... }
```

Each permitted subclass must declare one of: `final`, `sealed` (with its own permits), or `non-sealed`.

This lets you have inheritance for *modeling* purposes (algebraic data types, state machines) while still controlling who can extend.

`final`, `sealed`, and `non-sealed` are now siblings — three options for declaring "extension policy."

---

## 10. `final` and the builder pattern

A common pattern for immutable types with many fields:

```java
public final class HttpRequest {
    private final URI uri;
    private final String method;
    private final Map<String, String> headers;
    private final byte[] body;

    private HttpRequest(Builder b) {
        this.uri = b.uri;
        this.method = b.method;
        this.headers = Map.copyOf(b.headers);
        this.body = b.body == null ? null : b.body.clone();
    }

    public static Builder newBuilder() { return new Builder(); }

    public static final class Builder {
        URI uri;
        String method = "GET";
        Map<String, String> headers = new LinkedHashMap<>();
        byte[] body;

        public Builder uri(URI u)               { this.uri = u; return this; }
        public Builder header(String k, String v){ headers.put(k, v); return this; }
        public Builder body(byte[] b)            { this.body = b; return this; }

        public HttpRequest build() {
            if (uri == null) throw new IllegalStateException("uri required");
            return new HttpRequest(this);
        }
    }
}
```

The `HttpRequest` is `final` and immutable. The `Builder` is mutable but throwaway. Once `build()` runs, you have a frozen object — and the builder reference can be GC'd.

---

## 11. `final` and inheritance trade-offs

When *should* you allow non-`final`?

- **Frameworks** with documented extension points.
- **Test doubles**: subclassing for tests (though composition is usually better).
- **DI proxies**: Spring, CGLIB, etc., create runtime subclasses for AOP. Marking the class `final` *prevents* this. (Use interfaces + composition to work around.)

When *must* you make it `final`?

- **Value types** (`String`, `Integer`, custom money). Subclassing breaks `equals` symmetry.
- **Security-sensitive classes**. A malicious subclass could break invariants.
- **Public classes whose contract you can't fully document**. Easier to lock and never regret.

---

## 12. `final` and the `equals` contract

Subclassing breaks `equals` symmetry. Consider:

```java
class Point {
    final int x, y;
    @Override public boolean equals(Object o) {
        if (!(o instanceof Point p)) return false;
        return x == p.x && y == p.y;
    }
}

class ColorPoint extends Point {
    final Color color;
    @Override public boolean equals(Object o) {
        if (!(o instanceof ColorPoint cp)) return false;
        return super.equals(o) && color.equals(cp.color);
    }
}

Point p = new Point(1, 2);
ColorPoint cp = new ColorPoint(1, 2, RED);
p.equals(cp);    // true
cp.equals(p);    // false — broken symmetry
```

The fix is `final`: make `Point` `final` so `ColorPoint` cannot exist. Or use composition.

For value-shaped types, `final class` is the only safe choice.

---

## 13. `final` and the JIT

Marking a method or class `final` removes a class-hierarchy-analysis dependency from the JIT. The compiled code can inline directly without speculation.

Practically:

- For monomorphic call sites, the JIT inlines either way (with CHA tracking on non-`final` methods).
- For methods that *might* become polymorphic later, `final` is a small, free hint to the JIT.
- For "hot path on a stable class" code, `final` is good practice.

The performance win is small — measured in nanoseconds per call. The *stability* win is bigger: you don't get JIT deoptimizations when a new subclass appears.

---

## 14. Pragmatic adoption strategy

If you're starting a new codebase:

- Default fields to `final`.
- Default classes to `final` (or use records).
- Use `static final` for constants.
- Use `final` parameters by team convention (consistency more than ceremony).

If you're modernizing legacy code:

- Add `final` to fields incrementally (IDE refactoring tools help).
- Convert mutable value classes to records or `final` with `final` fields.
- Add `final` to leaf classes that have no current subclasses.
- Run static analyzers (Error Prone, SpotBugs) to flag mutable-where-it-could-be-final.

The diff is usually small; the regression risk is essentially zero (you can always remove `final` if a real need appears).

---

## 15. The middle-level checklist

For each declaration:

1. **Field**: is this set once at construction? → `final`. Default yes.
2. **Method**: should subclasses be able to change this? → if no, `final`.
3. **Class**: do you have a concrete subclass need? → if no, `final` (or `sealed`).
4. **Parameter**: convention-driven; pick once for the team.
5. **Local variable**: rarely needed; use `final` only if reassignment is a real concern.

For the class as a whole:

6. Is this immutable? `final` class + all `final` fields + defensive copies + no mutators.
7. Is this a value type? Consider `record` for the canonical immutable shape.
8. Is this designed for extension? Document the contract; provide `protected` hooks; mark non-extension methods `final`.

The discipline: `final` is the default; mutability and extensibility require justification. Most codebases that adopt this style report cleaner code, easier refactoring, and fewer concurrency bugs.
