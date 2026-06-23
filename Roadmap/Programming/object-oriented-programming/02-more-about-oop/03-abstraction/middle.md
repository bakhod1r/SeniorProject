# Abstraction — Middle

> **What?** Choosing the right abstraction tool: interface vs abstract class vs sealed types vs records. The classic GoF patterns that emerge naturally from abstraction (Template Method, Strategy, Factory, Bridge). The cost of leaky abstractions.
> **How?** By thinking about *what varies* and *what stays the same*, then encapsulating the variability behind a contract.

---

## 1. The "what varies, what stays the same" framing

Every abstraction answers two questions:

1. What part of the code is **stable** (won't change)?
2. What part is **variable** (will change or has multiple forms)?

The stable part is your concrete code. The variable part goes behind an abstract interface.

```java
// stable: the algorithm is "load → process → save"
// variable: how to load, how to process, how to save

abstract class Pipeline<I, O> {
    protected abstract I load();
    protected abstract O process(I in);
    protected abstract void save(O out);

    public final void run() {
        I in = load();
        O out = process(in);
        save(out);
    }
}
```

This is the **Template Method** pattern — same algorithm shape, varying steps.

---

## 2. Strategy pattern

Same idea but with composition instead of inheritance:

```java
public interface SortStrategy<T> {
    void sort(List<T> data);
}

public class TimSort<T> implements SortStrategy<T> {
    public void sort(List<T> data) { /* ... */ }
}

public class Sorter<T> {
    private final SortStrategy<T> strategy;
    public Sorter(SortStrategy<T> s) { this.strategy = s; }
    public void run(List<T> data) { strategy.sort(data); }
}
```

The variability (sort algorithm) is captured as an interface, swapped at construction time. Cleaner than inheritance for orthogonal concerns.

---

## 3. Bridge pattern

When you have two independent dimensions of variation (e.g., shape × renderer), inheritance forces a Cartesian explosion. Bridge separates them:

```java
interface Renderer {
    void drawCircle(double r);
    void drawSquare(double s);
}

abstract class Shape {
    protected final Renderer renderer;
    Shape(Renderer r) { this.renderer = r; }
    abstract void draw();
}

class Circle extends Shape {
    private final double r;
    Circle(double radius, Renderer renderer) { super(renderer); this.r = radius; }
    @Override void draw() { renderer.drawCircle(r); }
}
```

Now `Circle` × `SVGRenderer`, `Circle` × `RasterRenderer`, etc., are achieved by composition, not inheritance.

---

## 4. When abstract class beats interface

Use `abstract class` when:

- You have *shared mutable state* (instance fields).
- You have *common implementation* that all subclasses use unchanged.
- You want to *enforce* an algorithm (template method pattern with `final` template).
- Lifecycle requires *constructors* (interfaces don't have them).

```java
public abstract class Resource implements AutoCloseable {
    private final String id = UUID.randomUUID().toString();
    private boolean closed;

    protected Resource() { Logger.log("opened " + id); }

    @Override public final void close() {
        if (closed) return;
        doClose();
        closed = true;
        Logger.log("closed " + id);
    }

    protected abstract void doClose();
}
```

Subclasses get the lifecycle for free; they only fill in `doClose`.

---

## 5. When interface beats abstract class

Use an `interface` when:

- You're describing a *capability* (`Comparable`, `AutoCloseable`, `Runnable`).
- The same class might want to *participate in multiple* abstractions.
- There's *no shared state* — only behavior.
- You want to allow lambda implementations (functional interfaces).

```java
@FunctionalInterface
public interface Validator<T> {
    boolean valid(T value);

    default Validator<T> and(Validator<T> other) {
        return v -> valid(v) && other.valid(v);
    }
}

Validator<String> nonEmpty = s -> !s.isEmpty();
Validator<String> notTooLong = s -> s.length() < 100;
Validator<String> combined = nonEmpty.and(notTooLong);
```

---

## 6. Sealed types: bounded abstraction

When the variability is *closed* (a known set of cases), seal the hierarchy:

```java
sealed interface Result<T> permits Success, Failure { }
record Success<T>(T value) implements Result<T> { }
record Failure<T>(String error) implements Result<T> { }
```

Pattern matching gives compiler-checked exhaustiveness:

```java
String describe(Result<Integer> r) {
    return switch (r) {
        case Success<Integer> s -> "got " + s.value();
        case Failure<Integer> f -> "error: " + f.error();
    };
}
```

If you add a `Pending<T>` variant, every switch over `Result` becomes incomplete and the compiler points it out.

---

## 7. The Factory pattern

Abstraction also applies to *object creation*. Instead of exposing constructors, expose a factory method that returns an abstract type:

```java
public interface Connection { /* ... */ }

public class ConnectionFactory {
    public static Connection open(String url) {
        if (url.startsWith("postgres://")) return new PostgresConnection(url);
        if (url.startsWith("mysql://"))    return new MySqlConnection(url);
        throw new IllegalArgumentException();
    }
}
```

Callers don't know the concrete class. The factory hides selection logic and can evolve (add a new dialect) without affecting callers.

---

## 8. Leaky abstractions

Joel Spolsky's law: "All non-trivial abstractions, to some degree, are leaky." Some examples:

- `List.iterator()` returns an `Iterator` — but it's `ConcurrentModificationException` if you modify the list during iteration. The implementation leaks through.
- `Map.put` "abstracts away" the storage, but a hash collision storm makes `O(1)` look like `O(n)`.
- `JDBC` abstracts the DB — except every dialect quirk leaks (`ON CONFLICT` vs `ON DUPLICATE KEY UPDATE`).

**Action:** assume your abstractions will leak. Document the leaks. Test against the leak boundaries.

---

## 9. Returning abstract types from public APIs

```java
// returns ArrayList — leaks impl
public ArrayList<User> findActive() { /* ... */ }

// returns List — caller-friendly, swap impl freely
public List<User> findActive() { /* ... */ }

// returns Stream — caller chooses how to consume
public Stream<User> findActive() { /* ... */ }
```

For collections, prefer the most general type that still meets the contract. `Iterable` if iteration is enough; `Collection` if size matters; `List` if order matters; `Stream` if you want lazy/composable.

---

## 10. The Liskov implication for abstraction

When you abstract, you create a contract. Every implementation must honor it:

- Pre/post-conditions, invariants (LSP).
- Performance characteristics (a Map is "expected to be O(1)" — a TreeMap technically violates this in a hot loop).
- Concurrency guarantees (a `List` from `Collections.synchronizedList(...)` behaves differently from `ArrayList`).

Document these. Otherwise, swappability is fictional.

---

## 11. Abstraction granularity

Too coarse: one big interface that does everything. Hard to implement, hard to mock.

Too fine: dozens of micro-interfaces (`HasName`, `HasId`, `HasCreatedAt`). Cognitive overload.

Just right: interfaces grouped by *role*. The Single Responsibility Principle applied to interfaces.

```java
// fine
public interface UserRepository { ... }
public interface UserService { ... }
public interface UserAuthenticator { ... }

// each is small, focused, mockable
```

Interface Segregation Principle (the "I" in SOLID): don't force clients to depend on methods they don't use. Split fat interfaces.

---

## 12. Anemic abstractions

An anemic abstraction is one that exposes *data* but no *behavior*:

```java
public interface User {
    String name();
    int age();
    LocalDate birthday();
}
```

This is just a record dressed up as an interface. Real abstractions have behavior:

```java
public interface User {
    String displayName();        // behavior — "John D." or "Anon"
    boolean canVote();           // behavior — depends on age
    boolean isAdult();           // behavior — depends on age
}
```

Now there's something to abstract: the *logic*, not the *data*.

---

## 13. Abstract methods can throw

```java
abstract class IO {
    abstract String read() throws IOException;
}
```

Subclasses can throw subset of declared exceptions or none at all. They cannot throw new checked exceptions not declared in the abstract.

---

## 14. Abstraction patterns to know by name

| Pattern         | Idea                                                |
|-----------------|-----------------------------------------------------|
| Template Method | Algorithm in parent; steps in subclass              |
| Strategy        | Algorithm as an interface, swapped at runtime       |
| Bridge          | Two-dimensional variation via composition           |
| Factory         | Hide construction logic behind a static method      |
| Abstract Factory| Family of related products via a factory interface  |
| Adapter         | Wrap one interface to look like another             |
| Decorator       | Wrap to add behavior while preserving the interface |
| Proxy           | Stand-in that controls access to the real object    |
| Facade          | Simpler API hiding a complex subsystem              |

Most of these are abstraction in different costumes. Recognize them by *what they abstract* (algorithm, creation, access, complexity).

---

## 15. Documenting the contract

A good abstract type comes with documented expectations:

```java
/**
 * A {@code Cache} stores key→value mappings with eviction.
 * <p>
 * Implementations must be thread-safe. Methods are O(1) amortized.
 * {@code get} returns null if the key is absent or evicted.
 * {@code put} replaces existing entries.
 * <p>
 * Implementations may evict entries based on size, time, or LRU,
 * but must not silently lose updates that haven't been read yet.
 */
public interface Cache<K, V> { ... }
```

The contract is the abstraction. Without docs, the abstraction is incomplete.

---

## 16. What's next

| Question                                  | File              |
|-------------------------------------------|-------------------|
| Vtables, JIT inlining, abstraction cost   | `senior.md`        |
| Bytecode of abstract methods              | `professional.md`  |
| JLS rules                                  | `specification.md` |
| Common abstraction failures               | `find-bug.md`      |

---

**Memorize this**: abstraction = name and stabilize the *what*; hide the *how*. Use interfaces for capabilities, abstract classes for shared state, sealed types for closed unions, factories for hidden construction. Document contracts; assume they'll leak.
