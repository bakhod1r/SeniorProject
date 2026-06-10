# Attributes and Methods — Middle

> **Why?** Methods exist to give callers a *vocabulary* for working with an object that is smaller, stricter, and more meaningful than direct field access. Attributes exist to hold the smallest amount of state that the methods need to compute or remember between calls.
> **When?** Add a method when you need to enforce an invariant, encapsulate a multi-step operation, or give a meaningful name to a pattern of access. Add an attribute only when no method can derive the value cheaply, and only after deciding *who* may change it.

---

## 1. The litmus test for "should this be a method or a field?"

For every piece of data, ask: **does it have to be stored, or can it be computed?**

```java
// stored
private final List<OrderLine> lines;

// computed — derived from `lines`
public Money total() {
    return lines.stream().map(OrderLine::lineTotal).reduce(Money.ZERO, Money::plus);
}
```

If a value is cheap to compute and always derivable from existing state, **don't store it** — make it a method. Stored derived state is a synchronization tax: every mutation of the underlying state must remember to update it, and bugs creep in the moment one path forgets.

When *do* you store derived state? When (and only when):

1. The computation is expensive.
2. It's queried frequently.
3. You can guarantee invalidation on every relevant change.

Even then, a memoized lazy method is usually cleaner than a stored-and-maintained field.

---

## 2. Method naming: the contract is in the name

A method name is the part the caller sees first and most often. Treat it as a contract.

| Style                          | Meaning                                            |
|--------------------------------|----------------------------------------------------|
| `getXxx()` / `xxx()`           | Returns a value, no side effects                   |
| `isXxx()` / `hasXxx()` / `canXxx()` | Returns a boolean, no side effects             |
| `setXxx(...)`                  | Mutates state, returns void                        |
| `addXxx(...)` / `removeXxx(...)` | Modifies a collection                             |
| `findXxx(...)`                 | Search; may return `Optional` / `null` / a list    |
| `loadXxx(...)` / `fetchXxx(...)` | Performs I/O (signal to caller: "this can be slow") |
| `toXxx()` / `asXxx()`          | Converts to another representation                 |
| `withXxx(...)`                 | Returns a copy with one field changed (immutable update) |

Two heuristics:

- **A method that does X and Y should not be called X.** `getOrCreate` is honest; `get` that creates on the side is a trap.
- **A method that throws under common conditions should mention it.** `parseStrict`, `requireNonNull`, `tryParse`.

---

## 3. Command-Query Separation (CQS)

A common discipline: every method is *either* a **query** (returns a value, no side effects) *or* a **command** (mutates state, returns `void` or a status).

```java
// query — pure
public boolean canShip()              { return paid && hasStock(); }

// command — mutates
public void ship()                    { ... }

// avoid this — mixes both
public boolean shipIfPossible() {
    if (!canShip()) return false;
    ship();
    return true;
}
```

The mixed form (`shipIfPossible`) does have legitimate uses, but each one creates a method whose name and return value require explanation. Keep CQS as a default; deviate deliberately.

A side benefit: queries become safe to call from `toString`, logging, debugger watch expressions, assertions. Side-effecting methods don't.

---

## 4. Parameters: how many and how shaped

Number of parameters is *intelligence-rate-limiting*. Each one is a fact the caller must hold in their head.

| Count       | Comfort                                         |
|-------------|-------------------------------------------------|
| 0           | Trivial.                                         |
| 1–2         | Comfortable; usually fine.                      |
| 3           | Acceptable, often improvable.                   |
| 4           | Pause and ask — can two of these be combined?   |
| 5+          | Almost always wrong. Group into a parameter object or builder. |

Specific tactics:

**(a)** Group co-traveling primitives:

```java
// before
public void scheduleMeeting(int year, int month, int day, int hour, int minute) { ... }

// after
public void scheduleMeeting(LocalDateTime when) { ... }
```

**(b)** Resist the boolean parameter trap:

```java
moveTo(point, true);     // true what?
```

Either split into two methods (`moveTo` and `moveToSnapped`) or use an enum:

```java
moveTo(point, Snapping.SNAPPED);
```

**(c)** Prefer the most specific type the method actually needs (Postel's principle, scoped to method design):

```java
// take Iterable, not List, if you only iterate
public int sum(Iterable<Integer> xs) { ... }
```

This makes the method easier to call and easier to test.

---

## 5. Return values: avoid `null` for sentinels

Returning `null` to mean "not found" is a top source of NPEs. Pick one and document it:

```java
// 1. Optional — for at-most-one results
public Optional<User> findById(long id);

// 2. Empty collection — for zero-or-more
public List<Order> ordersFor(User u);   // never null

// 3. Throwing — when absence is exceptional
public User getById(long id);            // throws NotFoundException
```

Each choice fits a different contract:

- `Optional` says "absence is normal; handle it."
- Empty collections say "zero is just a number."
- Exceptions say "if this isn't here, the program is wrong."

A method that returns `null` from one path and a non-null from another, with no documentation, leaves the caller to guess.

---

## 6. Mutable state: who can change what

Every mutable attribute should answer three questions:

1. **Who can read it?** (visibility)
2. **Who can write it?** (visibility of setter, if any)
3. **What invariants must hold after a write?** (the validation)

The default should be tight:

```java
public class Account {
    private long balanceCents;                      // private — only this class

    public long getBalance() { return balanceCents; }   // anyone can read

    void credit(long cents) {                       // package-private — only same package can mutate
        if (cents <= 0) throw new IllegalArgumentException();
        balanceCents = Math.addExact(balanceCents, cents);
    }
}
```

Loosen only when you actually need to. A `public` setter is a contract you have to keep forever — including across refactors.

---

## 7. Static methods: when they're right

`static` is appropriate when:

- The method depends only on its arguments (pure function).
- It's a factory (`Money.of(...)`).
- It's a utility tied to the type but not to a specific instance (`Integer.parseInt`).

`static` is wrong when:

- The method "really" should depend on instance state but is `static` to avoid passing `this`.
- It hides a dependency (`UserService.findById(id)` calling a global database — testable how?).
- It's used for shared mutable state (`static int globalCounter`) — that's just a global variable in disguise.

If you find yourself writing a class with only static methods *and* mutable static state, you've reinvented globals. Inject the dependencies instead.

---

## 8. The `final` discipline

Three places `final` adds value:

- **Fields**: default to `final`. Mutability should be a deliberate choice. Plus the JMM safe-publication guarantee.
- **Methods**: mark `final` when you don't want subclasses to override (security-sensitive logic, template methods that should not be customized).
- **Classes**: see the previous topic — `final` for value types and for classes you don't want extended.

What about `final` parameters? It's pure local hygiene. Some style guides require it for clarity ("this parameter doesn't get reassigned — confirmed by the compiler"), others find the noise hurts readability. Pick one for the codebase and stop debating.

---

## 9. Defensive copies and exposure

Two cardinal sins:

**(a)** Storing a mutable object the caller can keep mutating:

```java
public OrderLine(List<Tag> tags) { this.tags = tags; }   // ❌ caller still has the reference
```

**(b)** Returning the live internal mutable object:

```java
public List<Tag> tags() { return tags; }   // ❌ caller can mutate
```

Both must be defended:

```java
public OrderLine(List<Tag> tags) { this.tags = List.copyOf(tags); }
public List<Tag> tags() { return tags; }       // already unmodifiable from List.copyOf
```

For arrays:

```java
public byte[] data() { return data.clone(); }
```

For pre-`java.time` types (`Date`, `Calendar`):

```java
public Date checkIn() { return new Date(checkIn.getTime()); }
```

The fix for "do I need to defensive-copy this?" is usually "use an immutable type and the question disappears." Migrate to `LocalDate`, `Instant`, `List.of`, records — the moment you can.

---

## 10. Side effects: name them, scope them

A method's *side effect* is anything beyond returning its result: I/O, state mutation, throwing, mutating a parameter.

**Rules of thumb:**

- A query method should have **zero** side effects.
- A command method should have **exactly one** named side effect.
- I/O should be visible in the method name (`load`, `save`, `send`, `publish`) — surprises are bugs.
- Methods that throw common exceptions should advertise them (`requireNonNull`, `parseInt`).

A method named `calculate` that also writes to a database is a code review failure. It will surprise the maintainer who reads only the name.

---

## 11. Validation: at the boundary, once

Invariant validation belongs at the **boundary** — the constructor or the public method that first receives data. After that, internal code should be free to assume the invariant holds.

```java
public final class Money {
    private final long cents;
    private final Currency currency;

    public Money(long cents, Currency currency) {
        this.cents = cents;
        this.currency = Objects.requireNonNull(currency);   // boundary check
    }

    public Money plus(Money other) {
        // no need to re-check currency != null — Money's invariant already says so
        if (!currency.equals(other.currency))
            throw new IllegalArgumentException();
        return new Money(Math.addExact(cents, other.cents), currency);
    }
}
```

Repeating null checks deep inside the call stack is a sign your boundary isn't trusted. Strengthen the boundary instead.

---

## 12. Designing for testability

Two qualities make methods easy to test:

**(a)** **Pure when possible**: same input → same output, no I/O, no clock, no randomness, no global state. Pure methods are trivial to test and trivial to reason about.

**(b)** **Inject dependencies via constructor**: no hidden references to global state.

```java
// hard to test
public class PriceService {
    public Money quote(Cart c) {
        return new TaxClient().tax(c)             // creates dependency inline
                              .applyTo(c.subtotal());
    }
}

// easy to test
public class PriceService {
    private final TaxClient tax;
    public PriceService(TaxClient tax) { this.tax = tax; }
    public Money quote(Cart c) { return tax.applyTo(c); }
}
```

In the testable version you can swap `TaxClient` for a fake or stub. In the un-testable version you can't, without monkey-patching or process-level configuration.

---

## 13. Method length: a (gentle) heuristic

Long methods are not automatically bad — but they correlate strongly with *doing too many things*. A useful gauge:

- Most methods: under 20 lines.
- Anything over 50 lines: read it asking "could this be three methods?"
- Anything over 100 lines: it's three methods.

Extract method when you can name the extracted block. If the natural name is `partOfX` or `helperX`, the seam is wrong — find a real concept to name.

---

## 14. Static vs dynamic dispatch

```java
class Animal       { String sound() { return "..."; } }
class Dog extends Animal { String sound() { return "Woof"; } }

Animal a = new Dog();
a.sound();                              // "Woof" — dispatched on runtime type

// Overloading is static — picks at compile time:
class S {
    static void print(Animal a) { System.out.println("animal"); }
    static void print(Dog d)    { System.out.println("dog"); }
}
S.print(a);                             // "animal" — static type of a is Animal
```

The crucial mental model:

- **Overriding** (instance methods) → resolved by **runtime type**.
- **Overloading** (overloads, static methods) → resolved by **compile-time type**.

Mixing these up causes subtle bugs (especially with overloading).

---

## 15. The middle-level checklist for any method

1. Is the name a precise verb that says exactly what the method does?
2. Is it a *query* or a *command* — and does the name make that obvious?
3. Are parameters minimal, well-typed, and not booleans?
4. Are nullability and exceptions documented (Javadoc, annotations, or both)?
5. Does it validate at the boundary or rely on caller discipline?
6. Are side effects named and scoped, or is the method secretly doing I/O?
7. Is mutable state defensive-copied in and out?
8. Is the method short enough to read in one pass?
9. Is it pure? If not, are dependencies injected rather than reached for globally?
10. Could a `static` method, a `record` accessor, or an enum lookup replace it?

Good attribute and method design reduces every other OOP concern to a smaller problem. Get this layer right and inheritance, polymorphism, and concurrency become almost mechanical.
