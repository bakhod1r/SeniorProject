# Final Keyword — Junior

> **What?** `final` means "this cannot change." Applied to variables, it forbids reassignment. Applied to methods, it forbids overriding. Applied to classes, it forbids subclassing.
> **How?** Place `final` before the declaration. The compiler enforces the rule at compile time.

---

## 1. The three uses of `final`

```java
public final class Money { ... }              // 1. final class — no subclasses

public class Person {
    private final String name;                 // 2. final field — assigned once

    public final void doStuff() { ... }        // 3. final method — no override

    public void log(final String message) { ... } // 4. final parameter / local — no reassignment
}
```

Same keyword, four different scopes. Each one says "this commitment is locked in."

---

## 2. `final` variable — assigned once

```java
final int x = 5;
x = 6;          // ❌ compile error — cannot assign a value to final variable

final List<String> list = new ArrayList<>();
list = new ArrayList<>();    // ❌ cannot reassign reference
list.add("hi");              // ✓ legal — mutating the object the reference points to is fine
```

Two crucial points:

**(a)** `final` controls the *variable*, not the object. The reference is locked; the object's internal state is not.

**(b)** A `final` local must be assigned *exactly once* — not necessarily at declaration, but before first use.

```java
final int x;
if (cond) x = 1;
else      x = 2;          // ✓ definite assignment satisfied
System.out.println(x);
```

---

## 3. `final` field — instance constant

```java
public class Person {
    private final String name;

    public Person(String name) {
        this.name = name;          // ✓ assigned in constructor
    }
}
```

A `final` field must be assigned exactly once:

- At its declaration: `private final int max = 100;`
- In an instance initializer block.
- In every constructor (or via constructor chaining).

The compiler enforces *definite assignment* — every constructor path must assign every `final` field, or it's a compile error.

After the constructor returns, the field cannot be reassigned. **Not even by the class itself.**

---

## 4. `final` method — no override

```java
public class Account {
    public final void close() { ... }
}

public class SavingsAccount extends Account {
    @Override public void close() { ... }   // ❌ cannot override final method
}
```

A `final` method cannot be overridden by subclasses. Use it when:

- The method's behavior is critical and subclasses must not change it.
- You're implementing the *template method* pattern — the parent calls `final` orchestration methods that subclasses cannot redirect.

If the *whole class* is `final` (see §6), all its methods are implicitly un-overrideable. You don't need `final` on individual methods.

---

## 5. `final` class — no subclass

```java
public final class Money { ... }

public class FastMoney extends Money { }    // ❌ cannot subclass final class
```

A `final` class prevents inheritance entirely. Use it for:

- Value types (`String`, `Integer`, `Long`, `BigDecimal` — all `final` in the JDK).
- Classes whose `equals` semantics would break under subclassing.
- Classes you don't want to support extension contracts on (most domain classes).

`String` is `final` for security: a malicious subclass could break the string-pool / immutability contract.

---

## 6. `final` parameter — local hygiene

```java
public void process(final List<Order> orders) {
    orders = null;                  // ❌ cannot reassign the parameter
    orders.add(new Order());         // ✓ mutating the list is fine
}
```

`final` on a parameter prevents reassignment *within the method*. It has no effect on the caller. Pure local hygiene.

Java requires *effectively final* parameters/locals to be captured by lambdas:

```java
String prefix = "user_";
Runnable r = () -> System.out.println(prefix + name);   // prefix is effectively final
prefix = "admin_";   // ❌ now prefix isn't effectively final — compile error on the lambda
```

You can either declare `final` explicitly or just not reassign — both work for capture.

---

## 7. `static final` — class constants

```java
public class HttpStatus {
    public static final int OK         = 200;
    public static final int NOT_FOUND  = 404;
    public static final int SERVER_ERR = 500;
}
```

Combining `static` and `final`:

- One copy per class (`static`).
- Cannot be reassigned (`final`).
- For primitives and `String`, the compiler may inline the value at every read site (compile-time constant).

Convention: use `UPPER_SNAKE_CASE` for `static final` constants.

---

## 8. `final` is *not* "deeply immutable"

Common misconception:

```java
public class Cart {
    public final List<Item> items = new ArrayList<>();
}

Cart c = new Cart();
c.items = new ArrayList<>();     // ❌ cannot reassign final reference
c.items.add(new Item());         // ✓ legal — list is mutable
c.items.clear();                  // ✓ also legal
```

`final` locks the reference, not the object. To make the object truly immutable:

- Use immutable types (`List.of(...)`, `record`, `ImmutableMap`).
- Defensive-copy in the constructor.
- Don't expose mutators.

`final` is one ingredient of immutability, not the whole recipe.

---

## 9. The classic immutable class

```java
public final class Money {                  // 1. final class — no subclasses
    private final long cents;                // 2. final fields
    private final Currency currency;

    public Money(long cents, Currency currency) {
        this.cents = cents;
        this.currency = currency;
    }

    public long cents()         { return cents; }
    public Currency currency()  { return currency; }

    public Money plus(Money other) {
        // operations return a new instance — never mutate
        return new Money(cents + other.cents, currency);
    }
}
```

Three uses of `final` here:

- The class is `final` — no subclass can break the contract.
- Both fields are `final` — assigned once, in the constructor.
- The method `plus` returns a new instance instead of mutating.

(Skipping `equals`/`hashCode`/`toString` for brevity — every immutable value class needs them.)

---

## 10. Why prefer `final` fields by default

Default to `final`. Here's why:

**(a)** **Safer concurrency.** The JLS §17.5 freeze rule guarantees that `final` fields are visible to other threads after the constructor finishes — without explicit synchronization.

**(b)** **Catches assignment bugs.** If you accidentally write `account.balance = 0` instead of using a method, the compiler catches it (assuming `balance` is `final` and writes go through `deposit`/`withdraw`).

**(c)** **Simpler reasoning.** Reading code, `final` tells you "this won't change after construction." Less to track.

The cost is essentially zero — `final` is enforced by the compiler, not the JVM at runtime.

---

## 11. Combining `final` with other modifiers

Allowed and useful combinations:

```java
public static final int MAX = 100;          // class constant
private final List<String> items;            // immutable instance field
public final void close() { ... }            // un-overrideable method
```

Forbidden combinations:

```java
abstract final class Foo { }                 // ❌ abstract requires extension; final forbids it
final volatile int counter;                   // ❌ final cannot be reassigned, volatile implies it can
```

---

## 12. Effective Java's rule

Joshua Bloch's *Effective Java* (Item 17): **Minimize mutability**.

Five steps:

1. Don't provide methods that modify the object's state.
2. Ensure the class can't be extended — make it `final`.
3. Make all fields `final`.
4. Make all fields `private`.
5. Ensure exclusive access to any mutable components (defensive copies).

Note: 4 of the 5 steps involve `final` directly. It's the keyword that operationalizes immutability in Java.

---

## 13. Quick rules of thumb

| Question                                  | Answer                              |
|-------------------------------------------|-------------------------------------|
| Is this field set once and never changed? | `final`                             |
| Should subclasses *not* override this?    | `final` method                      |
| Should this class *not* be extended?      | `final` class                        |
| Is this a class-level constant?           | `public static final`                |
| Will a lambda capture this local?         | `final` (or just don't reassign)    |
| Is this an immutable value type?          | `final class`, all `final` fields   |

---

## 14. Common beginner mistakes

| Mistake                                              | Symptom                              | Fix                              |
|------------------------------------------------------|--------------------------------------|----------------------------------|
| `final List` thinking the list is immutable          | Caller mutates the list              | Use `List.of(...)` or `Collections.unmodifiableList` |
| Forgetting to assign a `final` field in the ctor     | Compile error: not initialized       | Assign in declaration, init block, or every ctor |
| Reassigning a `final` reference                      | Compile error                        | Use a fresh local, or remove `final` |
| `final` on a parameter expecting caller to see it    | Caller doesn't notice                | `final` on param is local-only — no caller effect |
| Trying to override a `final` method                  | Compile error                        | Don't override; compose instead |

---

## 15. Cheat sheet

```java
// Variables
final int x = 5;                           // local
private final String name;                  // instance field
public static final int MAX = 100;          // class constant

// Methods
public final void close() { ... }

// Classes
public final class Money { ... }

// Parameters / locals
public void log(final String message) { ... }
```

`final` is one of Java's smallest, cheapest, and most effective keywords. **Use it by default.** Fields, classes, and selected methods all benefit. The cost is one extra word; the benefit is fewer surprises.
