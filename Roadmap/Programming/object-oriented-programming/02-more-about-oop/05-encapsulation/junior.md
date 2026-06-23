# Encapsulation — Junior

> **What?** *Encapsulation* is the principle of hiding an object's internal state behind a small, controlled public surface. State changes happen only through methods that the class itself defines, allowing the class to enforce invariants and validate every modification.
> **How?** With Java's access modifiers (`private`, `protected`, package-private, `public`), `final` fields for immutability, and the discipline of exposing methods, not fields.

---

## 1. The mental model

Think of an object as a small machine with knobs (public methods) and gears (private fields). The user turns the knobs; the gears are invisible. The machine guarantees that no matter what knob is turned, the gears stay in a consistent configuration.

```java
public class BankAccount {
    private long balanceCents;     // gears

    public void deposit(long amount) {     // knob
        if (amount <= 0) throw new IllegalArgumentException();
        balanceCents += amount;
    }

    public long balanceCents() { return balanceCents; }
}
```

The user can't write `account.balanceCents = -1_000_000`. They can only `deposit` with non-negative amounts. The class enforces "balance is non-negative" because it owns every modification.

---

## 2. Why encapsulation matters

**Invariants.** A bank account's balance shouldn't go negative (or should go negative only by a small overdraft). If `balance` is public, any code anywhere can break that rule. With encapsulation, only the class's own methods modify it.

**Refactoring freedom.** Public fields are part of the API. Changing them breaks all callers. Private fields can be renamed, retyped, or replaced without anyone noticing.

**Thread safety.** If only the class touches its state, you can synchronize one place. Public fields can be read/written from anywhere, making locking impossible.

**Testability.** Methods are observable in tests; they have inputs, outputs, and side effects you can mock or assert. Direct field access is harder to verify.

---

## 3. The four access modifiers

| Modifier        | Same class | Same package | Subclass | World |
|-----------------|-----------|--------------|----------|-------|
| `public`        | Y         | Y            | Y        | Y     |
| `protected`     | Y         | Y            | Y        | N     |
| (default)       | Y         | Y            | N        | N     |
| `private`       | Y         | N            | N        | N     |

**Default rule:** make every field `private` until proven otherwise. Make methods `private` unless they're part of the API. Public is a *commitment*: once you publish a member, callers depend on it.

---

## 4. Getters and setters

The traditional Java idiom for encapsulating a field:

```java
public class Person {
    private String name;
    private int age;

    public String name() { return name; }
    public void setName(String name) {
        if (name == null) throw new IllegalArgumentException();
        this.name = name;
    }
    public int age() { return age; }
    public void setAge(int age) {
        if (age < 0) throw new IllegalArgumentException();
        this.age = age;
    }
}
```

Each setter validates. The class guarantees `name` is never null, `age` is never negative.

Modern Java has alternatives:
- **Records** auto-generate accessors but no setters (immutable).
- **Builders** + immutable target type — set once at construction.
- **Method-based mutation** like `withdraw(long amount)` instead of `setBalance(long)`.

---

## 5. Hide what you can

```java
public class TodoList {
    private final List<String> items = new ArrayList<>();

    public void add(String item) { items.add(item); }
    public List<String> items() { return Collections.unmodifiableList(items); }
}
```

The internal list is hidden. The accessor returns a view that callers can read but not mutate. They can't accidentally clear the list, replace it, or hold a reference that mutates state behind your back.

---

## 6. Defensive copying

```java
public class Polygon {
    private final List<Point> points;

    public Polygon(List<Point> points) {
        this.points = List.copyOf(points);   // defensive copy
    }
}
```

The constructor copies the input. Even if the caller mutates their list afterwards, the polygon's `points` is unaffected. With `List.copyOf`, you also get an immutable list — the polygon itself can't accidentally mutate it.

---

## 7. Getters are not always necessary

A common mistake: writing a getter for *every* field, on the assumption that something might need it. This negates encapsulation.

```java
public class Counter {
    private int count;
    private long lastChanged;
    public int count() { return count; }      // OK
    public long lastChanged() { return lastChanged; }   // really needed?
    public void setCount(int c) { this.count = c; }     // bypass invariants
}
```

If `lastChanged` is internal bookkeeping, don't expose it. Each getter you add becomes part of the contract — clients may rely on it, and you've lost flexibility.

**Rule:** start with no getters. Add them when callers genuinely need to read.

---

## 8. Tell, don't ask

Encapsulation suggests: *tell* the object what to do, don't *ask* for its data and decide externally.

**Asking:**
```java
if (account.balance() > 100) {
    account.setBalance(account.balance() - 100);
}
```

**Telling:**
```java
account.withdraw(100);   // account decides if it can
```

The "telling" version puts the rule inside the object. Other code doesn't have to remember "always check balance first."

---

## 9. Encapsulation vs information hiding vs abstraction

These are related ideas:

- **Encapsulation** — bundle data and behavior; control mutation through methods.
- **Information hiding** — keep implementation details private so they can change without breaking callers.
- **Abstraction** — present a simple model that hides complexity.

In practice they overlap. Encapsulation is the *mechanism* (private fields, methods); information hiding is the *practice* (deciding what to hide); abstraction is the *result* (simple public API).

---

## 10. Records: the modern shortcut

```java
public record Point(double x, double y) {
    public double distance(Point other) {
        double dx = x - other.x;
        double dy = y - other.y;
        return Math.hypot(dx, dy);
    }
}
```

Records:
- Auto-generate `x()` and `y()` accessors
- Are implicitly final (no extension)
- Auto-generate `equals`, `hashCode`, `toString`
- Have no setters (immutable)

For data carriers, records replace ~50 lines of getter/equals/hashCode boilerplate. Use them where they fit.

---

## 11. Common newcomer mistakes

**Mistake 1: public fields**

```java
public class User {
    public String name;
    public int age;
}
```

Now any code can set `user.age = -100`. Use private fields with controlled mutators.

**Mistake 2: leaking internal collection**

```java
public List<String> items() { return items; }
```

Callers can mutate the internal list. Return `List.copyOf(items)` or `Collections.unmodifiableList(items)`.

**Mistake 3: setter that doesn't validate**

```java
public void setAge(int age) { this.age = age; }
```

Why have a setter at all if it doesn't enforce anything? Either validate or use a record.

**Mistake 4: getter for every field by reflex**

```java
private int counter;        // implementation detail
public int counter() { return counter; }   // now part of the API forever
```

If a field is implementation detail, hide it.

---

## 12. Quick rules

- [ ] All fields default to `private`.
- [ ] Mutating methods validate inputs.
- [ ] Don't expose internal mutable state.
- [ ] Prefer records for pure data.
- [ ] Use immutable types where possible.
- [ ] Don't write a getter unless needed.
- [ ] Tell, don't ask.

---

## 13. What's next

| Topic                                          | File              |
|------------------------------------------------|-------------------|
| Immutability, defensive copying                | `middle.md`        |
| JIT view of `private` fields, hidden classes   | `senior.md`        |
| Bytecode of access modifiers                   | `professional.md`  |
| JLS on access control                          | `specification.md` |

---

**Memorize this**: encapsulation = small public surface, private state, controlled mutation. Default to `private`. Records replace many encapsulated data carriers. Don't expose what you don't have to. Tell, don't ask.
